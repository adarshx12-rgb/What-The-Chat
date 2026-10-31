const { performance } = require("node:perf_hooks");

// One shared budget for this loopback-only, single-process converter. No
// client-controlled IP/header can create a fresh bucket. At most 30 timestamps
// are retained; rejected requests do not extend the cooldown.
function createConversionLimiter({ now = () => performance.now() } = {}) {
  const windows = [
    { limit: 6, ms: 60_000 },
    { limit: 30, ms: 3_600_000 },
  ];
  let attempts = [];

  return (req, res, next) => {
    const time = now();
    attempts = attempts.filter((at) => at > time - windows[1].ms);
    let retryMs = 0;
    for (const { limit, ms } of windows) {
      const recent = attempts.filter((at) => at > time - ms);
      if (recent.length >= limit) {
        retryMs = Math.max(retryMs, recent[recent.length - limit] + ms - time);
      }
    }
    if (retryMs > 0) {
      const retryAfter = Math.max(1, Math.ceil(retryMs / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("Cache-Control", "no-store");
      return res.status(429).json({
        error: "Too many conversion attempts. Please try again later.",
        code: "rate_limit_exceeded",
        retryAfter,
      });
    }
    // Count before parsing uploads, including requests that later fail.
    attempts.push(time);
    next();
  };
}

module.exports = { createConversionLimiter };
