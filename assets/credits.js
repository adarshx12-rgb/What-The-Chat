/* What The Chat — accounts and credits (Supabase).
 * Every visitor gets an anonymous Supabase session so credits live on the
 * server. If Supabase is unreachable or unconfigured, the studio runs in
 * offline mode: 0 credits, and exports are watermarked (fail closed). */
(function () {
  const core = window.WTCCreditsCore;
  const cfg = window.WTC_CONFIG || {};
  const OFFLINE = Object.freeze({ credits: 0, pro: false, admin: false, proUntil: null, isAnonymous: true, email: null, offline: true });
  const LINK_FLAG = 'wtc-google-link';
  const PENDING_VIDEO = 'wtc-pending-video-ms'; // charges that failed to reach the server
  const listeners = new Set();
  let sb = null;
  let entitlement = null;
  let readyPromise = null;

  function emit(){
    listeners.forEach((fn) => { try { fn(entitlement); } catch (e) { console.error(e); } });
  }

  function setEntitlement(next){
    entitlement = next;
    emit();
    return next;
  }

  async function sessionUser(){
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.user) || null;
  }

  async function fromRow(row){
    const user = await sessionUser();
    return {
      credits: row.credits | 0,
      pro: !!row.pro,
      admin: !!row.admin,
      proUntil: row.pro_until || null,
      isAnonymous: !user || !!user.is_anonymous,
      email: (user && user.email) || null,
      offline: false,
    };
  }

  async function syncGrants(){
    const { data, error } = await sb.rpc('ensure_grants');
    if (error) throw error;
    return setEntitlement(await fromRow(data));
  }

  async function startAnonymous(){
    const { error } = await sb.auth.signInAnonymously();
    if (error) throw error;
  }

  function redirectUrl(){ return location.origin + location.pathname; }

  function urlErrorCode(){
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    return query.get('error_code') || hash.get('error_code');
  }

  /* linkIdentity fails with identity_already_exists when the Google account
   * already belongs to another user (a returning user on a new device).
   * Then we sign in to that account normally; the visitor credits are left
   * behind, which is fine. */
  async function handleOAuthReturnError(){
    const code = urlErrorCode();
    if (!code) return;
    history.replaceState(null, '', location.pathname);
    let pendingLink = false;
    try { pendingLink = sessionStorage.getItem(LINK_FLAG) === '1'; sessionStorage.removeItem(LINK_FLAG); } catch (e) {}
    if (code === 'identity_already_exists' && pendingLink){
      await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } });
    }
  }

  async function boot(){
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return setEntitlement(OFFLINE);
    try {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      await handleOAuthReturnError();
      if (!(await sessionUser())) await startAnonymous();
      // Re-sync after sign-in/upgrade of the session. Deferred: awaiting other
      // Supabase calls inside this callback can deadlock the auth client.
      sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED'){
          setTimeout(() => { syncGrants().catch(() => {}); }, 0);
        }
      });
      const ent = await syncGrants();
      await settlePendingCharge();
      return entitlement || ent;
    } catch (e) {
      console.warn('[credits] offline mode:', e && e.message);
      return setEntitlement(OFFLINE);
    }
  }

  async function settlePendingCharge(){
    let ms = 0;
    try { ms = +localStorage.getItem(PENDING_VIDEO) || 0; } catch (e) { return; }
    if (!ms) return;
    try {
      await spend('video', core.recordingSeconds(ms));
      localStorage.removeItem(PENDING_VIDEO);
    } catch (e) { /* still offline; try again next visit */ }
  }

  function ready(){ return readyPromise || (readyPromise = boot()); }

  async function refresh(){
    await ready();
    if (!sb || entitlement.offline) return entitlement;
    // Fail closed: if the balance can't be confirmed now, treat it as 0 so a
    // recording started with the network cut is watermarked.
    try { return await syncGrants(); } catch (e) { return setEntitlement(OFFLINE); }
  }

  async function spend(kind, amount){
    const { data, error } = await sb.rpc('spend_credits', { p_kind: kind, p_amount: amount });
    if (error) throw error;
    setEntitlement(await fromRow(data));
    return data;
  }

  async function spendScreenshot(){
    await ready();
    if (!sb || entitlement.offline) return { allowed: false, entitlement };
    try {
      const data = await spend('screenshot', 1);
      return { allowed: !!data.allowed, entitlement };
    } catch (e) {
      return { allowed: false, entitlement };
    }
  }

  async function chargeVideo(ms){
    await ready();
    if (!sb || entitlement.offline) return entitlement;
    try { await spend('video', core.recordingSeconds(ms)); }
    catch (e) {
      console.warn('[credits] charge failed, will retry:', e && e.message);
      try { localStorage.setItem(PENDING_VIDEO, String((+localStorage.getItem(PENDING_VIDEO) || 0) + ms)); } catch (err) {}
    }
    return entitlement;
  }

  function canSignIn(){ return !!sb && /^https?:$/.test(location.protocol); }

  async function userId(){
    await ready();
    const user = await sessionUser();
    return user ? user.id : null;
  }

  function requireSignInAvailable(){
    if (!canSignIn()) throw new Error('Sign-in works on whatthechat.com, not on a local file.');
  }

  async function signInWithGoogle(){
    await ready();
    requireSignInAvailable();
    const user = await sessionUser();
    const options = { redirectTo: redirectUrl() };
    if (user && user.is_anonymous){
      try { sessionStorage.setItem(LINK_FLAG, '1'); } catch (e) {}
      const { error } = await sb.auth.linkIdentity({ provider: 'google', options });
      if (error) throw error;
      return;
    }
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options });
    if (error) throw error;
  }

  /* An anonymous visitor adds an email to the SAME account (credits carry
   * over). If that email already has an account, send a normal sign-in link. */
  async function sendMagicLink(email){
    await ready();
    requireSignInAvailable();
    const user = await sessionUser();
    if (user && user.is_anonymous){
      const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirectUrl() });
      if (!error) return;
      if (!/already|exists|registered/i.test(error.message || '')) throw error;
    }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } });
    if (error) throw error;
  }

  async function signOut(){
    await ready();
    if (!sb) return entitlement;
    await sb.auth.signOut();
    try { await startAnonymous(); return await syncGrants(); }
    catch (e) { return setEntitlement(OFFLINE); }
  }

  let checkoutScript = null;
  function loadCheckout(){
    if (window.Razorpay) return Promise.resolve();
    return checkoutScript || (checkoutScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => { checkoutScript = null; reject(new Error('Could not load Razorpay. Check your connection.')); };
      document.head.appendChild(s);
    }));
  }

  async function waitForPro(){
    for (let i = 0; i < 20; i++){
      const ent = await refresh();
      if (ent.pro) return ent;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return entitlement;
  }

  async function startCheckout(currency){
    await ready();
    if (!sb) throw new Error('Payments need an internet connection.');
    const { data, error } = await sb.functions.invoke('billing', { body: { action: 'create', currency } });
    if (error){
      let code = '';
      try { code = (await error.context.json()).error; } catch (e) {}
      throw new Error(code === 'already_pro' ? 'You already have Pro.' : 'Could not start checkout. Try again.');
    }
    await loadCheckout();
    return new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: data.key_id,
        subscription_id: data.subscription_id,
        name: 'What The Chat',
        description: 'Pro, monthly',
        prefill: { email: (entitlement && entitlement.email) || '' },
        theme: { color: '#20BC59' },
        handler: async () => { await waitForPro(); resolve('paid'); },
        modal: { ondismiss: () => resolve('dismissed') },
      });
      rzp.open();
    });
  }

  async function cancelPlan(){
    await ready();
    const { error } = await sb.functions.invoke('billing', { body: { action: 'cancel' } });
    if (error) throw new Error('Could not cancel. Try again or contact us.');
  }

  function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

  window.WTCCredits = {
    ready, refresh, get: () => entitlement, onChange,
    spendScreenshot, chargeVideo,
    canSignIn, userId, signInWithGoogle, sendMagicLink, signOut,
    startCheckout, cancelPlan,
    client: () => sb,
  };
})();
