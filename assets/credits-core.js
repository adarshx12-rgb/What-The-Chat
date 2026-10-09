/* What The Chat — credit math shared by the studio and the unit tests.
 * Must match public.spend_credits in supabase/migrations (1 credit per
 * started 3 seconds of video, 1 per screenshot). Free videos are clean for
 * at most 60 s; past that (or past the balance) the rest is watermarked. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WTCCreditsCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SECONDS_PER_CREDIT = 3;
  // Free (non-Pro) videos stay clean for at most this long; Pro is unlimited.
  const FREE_CLEAN_SECONDS = 60;
  const LOW_CREDITS = 5;

  function recordingSeconds(ms){
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  function videoCost(seconds){
    return seconds > 0 ? Math.ceil(seconds / SECONDS_PER_CREDIT) : 0;
  }

  function coveredMs(ent){
    if (!ent) return 0;
    if (ent.pro) return Infinity;
    return Math.min(Math.max(0, ent.credits | 0) * SECONDS_PER_CREDIT, FREE_CLEAN_SECONDS) * 1000;
  }

  // True when the 60 s free cap, not the balance, limits a clean recording.
  function hitFreeCap(ent){
    return !!ent && !ent.pro && Math.max(0, ent.credits | 0) * SECONDS_PER_CREDIT > FREE_CLEAN_SECONDS;
  }

  // A one-time nudge when the balance first drops to LOW_CREDITS or below
  // (0 is handled by the out-of-credits prompt instead).
  function lowCreditWarning(prev, next){
    if (!prev || !next || next.pro || next.offline || prev.offline) return null;
    const c = next.credits | 0;
    if (!(prev.credits > LOW_CREDITS && c <= LOW_CREDITS && c > 0)) return null;
    return 'About ' + c * SECONDS_PER_CREDIT + ' s of video left (' + c + (c === 1 ? ' credit).' : ' credits).');
  }

  function watermarkActive(covered, elapsedMs){
    return elapsedMs >= covered;
  }

  function chipLabel(ent){
    if (!ent) return 'Credits…';
    if (ent.admin) return 'Admin';
    if (ent.pro) return 'Pro';
    if (ent.offline) return 'Offline';
    return ent.credits + (ent.credits === 1 ? ' credit' : ' credits');
  }

  return { SECONDS_PER_CREDIT, FREE_CLEAN_SECONDS, recordingSeconds, videoCost, coveredMs, hitFreeCap, lowCreditWarning, watermarkActive, chipLabel };
});
