const messages = {
  400: "Unable to process this upload. Please select a video and try again.",
  404: "Not found.",
  500: "Something went wrong. Please try again later.",
};

// Only fixed public messages belong here. Log the original error separately;
// never serialize exception messages, stack traces, or converter output.
function sendError(res, status = 500) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // A stream may fail after download headers are set but before they are sent.
  res.removeHeader("Content-Length");
  res.removeHeader("Content-Disposition");
  res.removeHeader("Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: messages[status] || messages[500] });
}

function handleError(err, req, res, next) {
  console.error("[server] unhandled error:", err);
  sendError(res);
}

module.exports = { sendError, handleError };
