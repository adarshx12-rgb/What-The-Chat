/* What The Chat — credit math shared by the studio and the unit tests.
 * Must match public.spend_credits in supabase/migrations (1 credit per
 * started 3 seconds of video, 1 per screenshot). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WTCCreditsCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SECONDS_PER_CREDIT = 3;

  function recordingSeconds(ms){
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  function videoCost(seconds){
    return seconds > 0 ? Math.ceil(seconds / SECONDS_PER_CREDIT) : 0;
  }

  function coveredMs(ent){
    if (!ent) return 0;
    if (ent.pro) return Infinity;
    return Math.max(0, ent.credits | 0) * SECONDS_PER_CREDIT * 1000;
  }

  function watermarkActive(covered, elapsedMs){
    return elapsedMs >= covered;
  }

  function chipLabel(ent){
    if (!ent) return 'Credits…';
    if (ent.pro) return 'Pro';
    if (ent.offline) return 'Offline';
    return ent.credits + (ent.credits === 1 ? ' credit' : ' credits');
  }

  return { SECONDS_PER_CREDIT, recordingSeconds, videoCost, coveredMs, watermarkActive, chipLabel };
});
