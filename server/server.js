/**
 * WhatsApp Chat Story Recorder — local MP4 backend
 * ---------------------------------------------------
 * Purpose: the frontend records video straight from a <canvas> using
 * MediaRecorder. Depending on the browser, the resulting file can be a
 * ".mp4" that actually contains a non-standard codec (e.g. VP9) instead of
 * real H.264 — which many video editors won't open reliably.
 *
 * This server accepts whatever the browser produced (webm or mp4, any
 * codec) at POST /convert, re-encodes it with a bundled ffmpeg binary
 * (via ffmpeg-static — no system-wide ffmpeg install required) into a
 * standard H.264 (video) + AAC (audio) MP4 with faststart, and streams
 * the result back as a download.
 *
 * Runs locally only, bound to 127.0.0.1 — never exposed to the network.
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const { spawn } = require("child_process");

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ffmpegPath = require("ffmpeg-static");
const { createConversionLimiter } = require("./rate-limit");
const { sendError, handleError } = require("./errors");

const PORT = 8787;
const HOST = "127.0.0.1";

const app = express();
app.disable("x-powered-by");

// This tool only ever runs on the user's own machine and is only ever
// reachable from pages the user opened themselves (localhost or a local
// file:// page). There is no sensitive data involved (just chat-story
// video clips), so allowing all origins is fine and keeps setup simple —
// it avoids needing to special-case "file://" (which browsers usually
// send as the literal Origin header "null").
app.use(cors({ origin: true, exposedHeaders: ["Retry-After"] }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB is generous for a short recorded clip
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/convert", createConversionLimiter(), (req, res) => {
  upload.single("video")(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error("[convert] upload error:", uploadErr);
      return sendError(res, 400);
    }

    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      return sendError(res, 400);
    }

    if (!ffmpegPath) {
      console.error("[convert] ffmpeg-static did not resolve a binary path for this platform.");
      return sendError(res);
    }

    const tmpDir = os.tmpdir();
    const jobId = crypto.randomBytes(8).toString("hex");
    const inputPath = path.join(tmpDir, `wcr-in-${jobId}`);
    const outputPath = path.join(tmpDir, `wcr-out-${jobId}.mp4`);

    try {
      await fsp.writeFile(inputPath, file.buffer);
    } catch (writeErr) {
      console.error("[convert] failed to write temp input file:", writeErr);
      return sendError(res);
    }

    const ffmpegArgs = [
      "-y",
      "-i", inputPath,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "veryfast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outputPath,
    ];

    let stderrOutput = "";
    const ffmpeg = spawn(ffmpegPath, ffmpegArgs);

    ffmpeg.stderr.on("data", (chunk) => {
      stderrOutput += chunk.toString();
      // keep only the tail so a runaway log can't blow up memory
      if (stderrOutput.length > 20000) {
        stderrOutput = stderrOutput.slice(-20000);
      }
    });

    ffmpeg.on("error", async (spawnErr) => {
      console.error("[convert] failed to start ffmpeg:", spawnErr);
      await cleanup(inputPath, outputPath);
      if (!res.headersSent) {
        sendError(res);
      }
    });

    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        console.error(`[convert] ffmpeg exited with code ${code}\n${stderrOutput}`);
        await cleanup(inputPath, outputPath);
        if (!res.headersSent) {
          sendError(res);
        }
        return;
      }

      let stat;
      try {
        stat = await fsp.stat(outputPath);
      } catch (statErr) {
        console.error("[convert] output file missing after ffmpeg reported success:", statErr);
        await cleanup(inputPath, outputPath);
        if (!res.headersSent) {
          sendError(res);
        }
        return;
      }

      if (!stat.size) {
        console.error("[convert] output file is empty");
        await cleanup(inputPath, outputPath);
        if (!res.headersSent) {
          sendError(res);
        }
        return;
      }

      const filename = `whatsapp-chat-${Date.now()}.mp4`;
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", stat.size);

      const readStream = fs.createReadStream(outputPath);
      readStream.on("error", async (streamErr) => {
        console.error("[convert] error streaming output file:", streamErr);
        sendError(res);
      });
      readStream.on("close", () => {
        cleanup(inputPath, outputPath);
      });
      readStream.pipe(res);
    });
  });
});

async function cleanup(...paths) {
  for (const p of paths) {
    try {
      await fsp.unlink(p);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`[cleanup] could not remove ${p}:`, err);
      }
    }
  }
}

// Multer errors (e.g. file too large) and any other body-parsing errors
// that escape the /convert handler above.
app.use((req, res) => sendError(res, 404));
app.use(handleError);

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`MP4 backend listening on http://${HOST}:${PORT}`);
    console.log("Keep this window open while recording chat videos. Close it when you're done.");
  });
}

module.exports = app;
