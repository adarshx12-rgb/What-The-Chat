# MP4 backend (optional, but recommended)

## What this is for

The chat recorder tool records video straight out of your browser. Depending on
your browser, the file it saves as "`.mp4`" can secretly contain a video codec
that isn't real H.264 — which some video editors refuse to open or play back
correctly.

This little local program fixes that: it takes whatever the browser recorded
and re-encodes it into a standard MP4 (H.264 video + AAC audio) that every
editor can open. It runs entirely on your own computer — nothing is uploaded
to the internet.

You don't have to use it. If you don't start it, the recorder tool still
works exactly as before, downloading the browser's own recording directly.

## Prerequisite: install Node.js (one-time)

1. Go to **https://nodejs.org**
2. Download and install the **LTS** version (the button labeled "LTS" — any
   reasonably recent LTS release is fine, you don't need a specific version).
3. Click through the installer with the default options.

You only need to do this once, ever, on this computer.

## How to start it

Double-click **`start-server.bat`** in this folder.

A black window will open. The first time you run it, it will spend a minute
or two downloading a few files it needs (you'll see some text scroll by) —
this is normal and only happens once. After that it will start immediately
each time.

## How to know it's working

When it's ready, the window will show a line like:

```
MP4 backend listening on http://127.0.0.1:8787
```

Back in the chat recorder tool (the web page), you should see a small
**"MP4 backend: connected"** indicator appear near the recording controls.
That's it — recordings will now automatically come out as guaranteed,
standard MP4 files.

If you don't start this program, or it isn't running, the recorder tool
still works fine — it just downloads your browser's native recording
directly, the way it always did, and shows a small note saying the MP4
backend isn't running.

## How to stop it

Just close the black window. That's it — there's nothing to "uninstall" or
clean up.

## Important: keep the window open while recording

This program needs to be running **at the moment you click Stop** on a
recording, so it can convert that clip. It's completely fine to close it
between recording sessions and reopen it (double-click `start-server.bat`
again) whenever you come back to record more videos.

## Conversion rate limits

`POST /convert` accepts at most **6 attempts per rolling minute** and **30 per
rolling hour**, shared across this local server. Failed uploads count too.
Excess attempts return HTTP 429 with a `Retry-After` header (seconds) and JSON
`code: "rate_limit_exceeded"` before the upload is parsed or FFmpeg starts.
The recorder downloads the original recording and displays the retry delay.
Health checks and CORS preflight requests do not consume this budget.

The limiter stores at most 30 timestamps in memory; restarting the process
resets it. It ignores forwarded IP headers and remains bound to `127.0.0.1`.
These limits are for the existing single-process local converter. A hosted
service would need authentication, a shared durable limiter, and resource
limits across workers before exposing conversion publicly.

Run `npm test` from `server/` to verify rolling windows, parallel requests,
header spoofing, upload rejection, CORS, and an actual FFmpeg conversion.

## Error responses

Upload errors return a generic HTTP 400 response. Internal failures return the
same generic HTTP 500 response, without exception messages, stack traces,
file paths, or FFmpeg output. Unknown routes return a generic JSON 404.
Error responses are not cached. If a download has already started, a failure
closes the connection rather than appending error details to the video.

Full error objects (including available stack traces) and bounded FFmpeg
diagnostics stay in the server terminal. Use those logs to troubleshoot;
the browser continues to save the original recording when conversion fails.
