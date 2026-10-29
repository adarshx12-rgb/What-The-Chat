/* Texting Studio — accounts and credits (Supabase).
 * Every visitor gets an anonymous Supabase session so credits live on the
 * server. If Supabase is unreachable or unconfigured, the studio runs in
 * offline mode: 0 credits, and exports are watermarked (fail closed). */
(function () {
  const core = window.WTCCreditsCore;
  const cfg = window.WTC_CONFIG || {};
  const OFFLINE = Object.freeze({ credits: 0, pro: false, admin: false, proUntil: null, isAnonymous: true, email: null, offline: true });
  // The homepage sets WTC_AUTH_ONLY: it signs people in but never starts a
  // visitor session (those, and their free credits, begin in the studio).
  const AUTH_ONLY = !!window.WTC_AUTH_ONLY;
  const SIGNED_OUT = Object.freeze(Object.assign({}, OFFLINE, { offline: false, signedOut: true }));
  const LINK_FLAG = 'wtc-google-link';
  const PENDING_VIDEO = 'wtc-pending-video-ms'; // charges that failed to reach the server
  const PRO_CACHE = 'wtc-pro-until'; // last confirmed Pro expiry, honoured while offline
  const listeners = new Set();
  let sb = null;
  let entitlement = null;
  let readyPromise = null;

  function emit(){
    listeners.forEach((fn) => { try { fn(entitlement); } catch (e) { console.error(e); } });
  }

  function rememberPro(ent){
    if (ent.offline) return;
    try {
      if (ent.pro) localStorage.setItem(PRO_CACHE, ent.admin ? '9999-12-31T00:00:00Z' : (ent.proUntil || ''));
      else localStorage.removeItem(PRO_CACHE);
    } catch (e) {}
  }

  /* Offline: Pro (or admin) that the server confirmed earlier still counts
   * until its expiry; everyone else gets 0 credits (fail closed). */
  function offlineEntitlement(){
    let until = null;
    try { until = localStorage.getItem(PRO_CACHE); } catch (e) {}
    return until && new Date(until) > new Date()
      ? Object.assign({}, OFFLINE, { pro: true, proUntil: until })
      : OFFLINE;
  }

  function setEntitlement(next){
    rememberPro(next);
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

  /* Cloudflare Turnstile (invisible): Supabase's captcha protection wants a
   * fresh single-use token on anonymous sign-in and magic-link requests.
   * Nothing is shown to the visitor. If Turnstile can't load (blocked, slow,
   * no site key), the request goes out without a token: Supabase accepts it
   * while captcha is off, and with captcha on the studio falls back to
   * offline mode as it would for any other sign-in failure. */
  const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  let turnstileLoad = null;

  function loadTurnstile(){
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoad){
      turnstileLoad = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = TURNSTILE_SRC;
        s.async = true;
        s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
        s.onerror = () => reject(new Error('turnstile blocked'));
        document.head.appendChild(s);
      });
      turnstileLoad.catch(() => { turnstileLoad = null; }); // allow a retry later
    }
    return turnstileLoad;
  }

  async function captchaToken(){
    if (!cfg.turnstileSiteKey) return undefined;
    try {
      const ts = await loadTurnstile();
      return await new Promise((resolve, reject) => {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;';
        document.body.appendChild(box);
        let id = null;
        const finish = (fn, value) => {
          clearTimeout(timer);
          try { if (id !== null) ts.remove(id); } catch (e) {}
          box.remove();
          fn(value);
        };
        const timer = setTimeout(() => finish(reject, new Error('captcha timeout')), 15000);
        id = ts.render(box, {
          sitekey: cfg.turnstileSiteKey,
          action: 'auth',
          callback: (token) => finish(resolve, token),
          'error-callback': () => finish(reject, new Error('captcha failed')),
        });
      });
    } catch (e) {
      console.warn('[credits] captcha unavailable:', e && e.message);
      return undefined;
    }
  }

  async function startAnonymous(){
    const { error } = await sb.auth.signInAnonymously({ options: { captchaToken: await captchaToken() } });
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

  /* The account can change on the server while this browser still holds an
   * old visitor token: Google got linked to the visitor account, but the trip
   * back to the studio failed. Refresh the token so the studio (and the
   * sign-in bonus, which reads the token) see the real account. */
  async function refreshStaleSession(){
    const cached = await sessionUser();
    if (!cached || !cached.is_anonymous) return;
    const { data } = await sb.auth.getUser();
    if (data && data.user && !data.user.is_anonymous) await sb.auth.refreshSession();
  }

  async function boot(){
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return setEntitlement(offlineEntitlement());
    try {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      await handleOAuthReturnError();
      if (AUTH_ONLY && !(await sessionUser())){
        watchAuth();
        return setEntitlement(SIGNED_OUT);
      }
      if (!(await sessionUser())) await startAnonymous();
      else await refreshStaleSession();
      watchAuth();
      const ent = await syncGrants();
      await settlePendingCharge();
      return entitlement || ent;
    } catch (e) {
      console.warn('[credits] offline mode:', e && e.message);
      return setEntitlement(offlineEntitlement());
    }
  }

  // Re-sync after sign-in/upgrade of the session. Deferred: awaiting other
  // Supabase calls inside this callback can deadlock the auth client.
  let watching = false;
  function watchAuth(){
    if (watching) return;
    watching = true;
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED'){
        setTimeout(() => { syncGrants().catch(() => {}); }, 0);
      } else if (event === 'SIGNED_OUT' && AUTH_ONLY){
        setEntitlement(SIGNED_OUT);
      }
    });
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
    try { return await syncGrants(); } catch (e) { return setEntitlement(offlineEntitlement()); }
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
    if (!canSignIn()) throw new Error('Sign-in works on textingstudio.com, not on a local file.');
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
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl(), captchaToken: await captchaToken() } });
    if (error) throw error;
  }

  async function signOut(){
    await ready();
    if (!sb) return entitlement;
    await sb.auth.signOut();
    if (AUTH_ONLY) return setEntitlement(SIGNED_OUT);
    try { await startAnonymous(); return await syncGrants(); }
    catch (e) { return setEntitlement(offlineEntitlement()); }
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

  const BILLING_ERRORS = {
    already_pro: 'You already have Pro.',
    plan_unavailable: 'Yearly billing isn’t available yet. Choose monthly.',
    rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  };

  async function invokeBilling(body){
    await ready();
    if (!sb) throw new Error('Payments need an internet connection.');
    const { data, error } = await sb.functions.invoke('billing', { body });
    if (error){
      let code = '';
      try { code = (await error.context.json()).error; } catch (e) {}
      throw new Error(BILLING_ERRORS[code] || (body.action === 'delete_account' ? 'Could not delete the account. Try again or contact us.' : 'Could not start checkout. Try again.'));
    }
    return data;
  }

  /* One-time credit pack. Credits arrive through the Razorpay webhook, so
   * after payment we poll until the balance goes up. */
  async function buyCreditPack(currency){
    const before = (entitlement && entitlement.credits) | 0;
    const data = await invokeBilling({ action: 'pack', currency });
    await loadCheckout();
    return new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: data.key_id,
        order_id: data.order_id,
        amount: data.amount,
        currency: data.currency,
        name: 'Texting Studio',
        description: (cfg.packCredits || 100) + ' credits',
        prefill: { email: (entitlement && entitlement.email) || '' },
        theme: { color: '#20BC59' },
        handler: async () => {
          for (let i = 0; i < 20; i++){
            const ent = await refresh();
            if (ent.credits > before) break;
            await new Promise((r) => setTimeout(r, 1500));
          }
          resolve('paid');
        },
        modal: { ondismiss: () => resolve('dismissed') },
      });
      rzp.open();
    });
  }

  async function startCheckout(currency, interval){
    const yearly = interval === 'year';
    const data = await invokeBilling({ action: 'create', currency, interval: yearly ? 'year' : 'month' });
    await loadCheckout();
    return new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: data.key_id,
        subscription_id: data.subscription_id,
        name: 'Texting Studio',
        description: yearly ? 'Pro, yearly' : 'Pro, monthly',
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

  /* Deletes the signed-in account on the server (email, credits, history;
   * a live Pro subscription is cancelled), then starts a fresh visitor. */
  async function deleteAccount(){
    await invokeBilling({ action: 'delete_account', confirm: 'DELETE' });
    try { localStorage.removeItem(PRO_CACHE); localStorage.removeItem(PENDING_VIDEO); } catch (e) {}
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    try { await startAnonymous(); return await syncGrants(); }
    catch (e) { return setEntitlement(offlineEntitlement()); }
  }

  function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

  window.WTCCredits = {
    ready, refresh, get: () => entitlement, onChange,
    spendScreenshot, chargeVideo,
    canSignIn, userId, signInWithGoogle, sendMagicLink, signOut,
    startCheckout, buyCreditPack, cancelPlan, deleteAccount,
    client: () => sb,
  };
})();
