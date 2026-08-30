# Project context: WhatsApp Chat Story Recorder

## What this project is for

A tool to produce fake WhatsApp text-conversation videos for a faceless YouTube channel. The channel's content is horror stories (adapted from r/nosleep, r/LetsNotMeet, 4chan /x/ greentexts, etc.), targeted at a US audience for AdSense RPM, presented as staged WhatsApp conversations rather than narrated Reddit-post readings.

## Why this format, and the compliance context behind it

YouTube's 2026 "inauthentic content" monetization policy specifically flags: AI voice reading text verbatim with no original contribution, mass-produced templates reused identically across videos, and stock-footage-plus-AI-voice compilations with no point of view. Straight TTS narration of copy-pasted Reddit/4chan text is squarely in that risk zone.

The WhatsApp-chat-story format is a better fit because staging an original conversation (even when adapted from an existing story) is a creative reconstruction, not a verbatim reading — as long as the messages are written/adapted, not copy-pasted dialogue. Suspense in this format comes from pacing: lingering typing indicators, messages sent then "deleted," a contact going silent, timestamps that jump — these need to be creator-controlled, not template-driven, which is part of why a from-scratch tool (full manual control over timing) beats an existing template app.

Separately: YouTube's *disclosure* toggle ("altered or synthetic content") is a different policy from the monetization/inauthentic-content one. Disclosure is only required for *realistic* synthetic content that could mislead a viewer (fabricated real people/events). AI-generated narration voice alone, over real images/footage, likely does NOT require the toggle. AI-generated music DOES require it. Neither of these facts exempts the channel from the separate "add original value, don't just template it" monetization requirement above.

## Why a custom tool instead of an existing app

Evaluated and ranked: TextingStory (best mobile app, 4.7★/65k ratings, but mobile-only — creator records on PC), Vidulk and Mockly (browser-based, some have video export, Android/iOS split unconfirmed on at least one), Zeoob (explicit Android/iOS toggle + live preview + free, but static-image export only, would need external screen recording), CapCut fake-chat templates (native desktop app, but templates are rigid, no real Android/iOS distinction), plus a cluster of static-only WhatsApp mockup-screenshot generators (10015.io, FakeWhats, CommonNinja, etc. — fine for thumbnails, not for animated video).

None of them combined: PC/desktop use, a genuine Android-vs-iOS toggle, fine-grained manual control over exactly when each message is sent, AND a built-in recorder that can't pick up the mouse cursor. Hence: build one custom, single-file, no backend.

## Full feature spec (all required, already implemented once — see Current status below)

1. Left panel: editable message list — text, sender (Contact/Me), date/time; each message row has a Send button (Enter also works) that finalizes the text, reveals it in the live preview immediately, and auto-inserts + focuses a new blank row after it — global settings for contact name, avatar, online/typing/last-seen status.
2. Right panel: live WhatsApp-accurate chat UI (status bar, header, bubbles with tails/ticks/timestamps, wallpaper, date dividers, and a bottom compose-bar footer with emoji/camera icons + a green mic button) built from the left panel's data. The left panel's width is resizable by dragging the handle between the two panels.
3. Every visual detail is genuinely editable — nothing hardcoded/templated.
4. No auto-play/timer. The conversation advances only when the creator clicks a message's Send button. The typing indicator for a Contact message is purely state-driven — it shows automatically whenever it's the next un-sent message, and disappears the instant that message is sent. "Me" messages never show a typing indicator (matches real WhatsApp). A "Restart preview" button (formerly labeled "Reset chat" — same function, renamed per DESIGN.md copy-style guidance since it clears revealed state, not message data) clears the preview back to empty.
5. Full-preview recorder: Start/Pause/Resume/Stop, in a `.recorder-panel` inside a dedicated Export panel to the right of the phone mockup (not overlaid on the canvas), exports a real video file. The recorder now runs an explicit Ready → Recording → Paused → Processing → Complete/Error state machine (see Current status below) instead of just idle/recording/paused.
6. (Removed) A chat-only recorder used to exist here (same controls, cropped to just the message/wallpaper area) but was removed at the user's request — only the recorder in #5 remains. If it's ever wanted back, the old approach was a second hidden canvas mirroring just the chat-area draw calls.
7. Android/iOS toggle: status bar style, header style, bubble shape, font — driven by one shared theme-tokens config, not duplicated UI.
8. Customizable background/theme: default WhatsApp light/dark wallpaper, custom image upload, solid/gradient option, editable bubble colors, light/dark chrome toggle.
9. No separate "export render" — the live preview IS exactly what gets recorded, at all times.
10. **Recording must never capture the OS mouse cursor.** This is the one requirement with a specific correct-vs-wrong implementation: do NOT use `getDisplayMedia` (screen/tab capture) for the recorder — it will pick up the cursor. Instead render the whole preview onto an off-screen `<canvas>` via manual 2D draw calls, then use `canvas.captureStream(30)` + `MediaRecorder`. Because the canvas is a pure programmatic drawing surface, the cursor structurally cannot appear in the stream. If asked to modify the recording feature, preserve this approach — don't let it get "simplified" back to screen capture.

## Current status

`index.html` exists and has been iterated on across several sessions, re-verified via Playwright each time:
- Zero console errors on load; left-panel edits update the live canvas preview with no reload.
- Android/iOS toggle confirmed via pixel-sampling the canvas (header color, notch, back-icon, bubble radius all genuinely change); light/dark chrome toggle confirmed too (recolors header/status bar and the default wallpaper variant together).
- Message flow is fully manual now (see spec #1/#4 above) — Send reveals a message immediately and queues the next one; there's no Play button and no per-message typing-delay field anymore.
- Only one recorder remains (see spec #5/#6) — Start/Pause/Resume/Stop tested end-to-end, producing a real, valid, non-zero-size video file. With the local MP4 backend (below) running, `ffprobe` confirmed genuine H.264 output; with it stopped, the fallback (direct blob download + inline note, never `alert()`) still works correctly. No `getDisplayMedia` used anywhere in the code (confirmed via grep).
- Left panel is resizable (`#resizeHandle`, 280–720px) and the canvas draws a WhatsApp-style compose-bar footer, both added this session.
- **Studio shell redesigned to match `DESIGN.md`** (a separate design-direction doc in this same folder — read it before making further visual changes). Changes were CSS/HTML/JS-wiring only; the canvas drawing engine (constants, `PLATFORM` tokens, `draw()`/`drawChatArea()`/`drawTopChrome()`/etc.) was left untouched byte-for-byte, so preview/recording output is unaffected.
  - True three-zone desktop layout (≥1200px): editor sidebar (`#leftPanel`, Chat identity + Messages, with Appearance in a collapsible `<details>` below so it doesn't push Messages below the fold) | phone stage (`#phoneStage`, centered) | export panel (`#exportPanel`, Playback + recorder, fixed ~268px).
  - Below 1200px this collapses into a tab drawer (Content / Appearance / Export, `.tabsBar`) driven by `wireTabs()`/`applyTabVisibility()` in the JS, gated on a `matchMedia('(min-width:1200px)')` listener; below 768px the phone preview stacks above the tabs.
  - Dark Vercel-style token set (`--studio-*` CSS variables) replaces the old ad hoc palette; WhatsApp green reserved for primary actions, red for destructive/recording.
  - Message-card icon buttons (move up/down, delete) and the Send button now use small hand-inlined SVG icons (`ICONS`/`iconSvg()` in the JS) instead of emoji/glyphs — no external icon library loaded, stays single-file/offline.
  - Deleting a message now shows an "Undo" toast (`showToast()`/`#toastRegion`) for ~6s instead of deleting immediately with no recovery.
  - Recorder gained explicit Processing/Complete/Error states beyond the original idle/recording/paused (`fullRecState`, `fullRecHelper`, a `#fullLiveStatus` `aria-live` region, `Download again`/`Retry` buttons, `MediaRecorder.start(1000)` for periodic chunking) — the actual capture/backend/fallback logic is unchanged.
  - **Known gotcha if you touch this CSS again:** any selector that sets `display:` on an element (e.g. `#exportPanel{display:flex}`, the generic `button{display:inline-flex}`) silently defeats that element's native `hidden` attribute, because author-origin rules beat the UA `[hidden]{display:none}` rule regardless of specificity. Fixed here with one global `[hidden]{display:none !important;}` rule near the end of `<style>` — keep it if you add more `display:`-setting selectors, or hidden toggling will silently stop working again (hit this twice this session: once for `#leftPanel`/`#exportPanel` tab panels, once for every recorder button).
  - Verified via Playwright driving the system-installed Edge (`channel:'msedge'`, no separate browser download) at 1440px/1000px/390px: zero console errors at every width; platform/chrome toggles, send-message reveal, delete+undo, and the full recorder state progression (Ready→Recording→Complete) all exercised programmatically and confirmed by screenshot.

Known gaps / honest caveats:
- `MediaRecorder.isTypeSupported('video/mp4')` can report `true` while the actual codec is VP9 — this is exactly what the optional `server/` MP4 backend below fixes; without it running, the direct download may need re-encoding in an editor.
- Reordering *messages* is still up/down buttons only, no drag-and-drop (the resizable-panel drag is a different, unrelated feature — it resizes the panel, not message order).
- Bubble tail shape and wallpaper doodle pattern are stylized approximations of real WhatsApp, not pixel-perfect asset traces.

## If extending this project

- Keep the "preview = recording source" architecture (#9) — don't introduce a separate render/export pass.
- Keep the canvas-capture recording approach (#10) — don't swap to screen capture even if it seems simpler.
- The channel's format depends on messages being adapted/rewritten from source stories, not copy-pasted verbatim — if adding any script-import or auto-fill-from-Reddit feature later, keep a rewrite/paraphrase step in the workflow, not straight copy-paste, for the monetization-policy reasons above.

## Optional local MP4 backend (`server/`)

A small local Node/Express backend now exists at `server/` specifically to fix the VP9-in-mp4 problem noted above: `MediaRecorder.isTypeSupported('video/mp4')` can return `true` while the codec actually recorded is VP9, not H.264 — this was reproduced again during testing (Chromium headless: reported "MP4" but ffprobe showed `codec_name=vp9`). Real-world editors can choke on that.

- `server/server.js` exposes `POST /convert` (multipart field `video`) and `GET /health`, binds to `127.0.0.1:8787` only, and uses `ffmpeg-static` (a bundled ffmpeg binary — no system ffmpeg install required) to re-encode whatever is uploaded into `-c:v libx264 -c:a aac -movflags +faststart` MP4, streamed back as a download, with temp files cleaned up after.
- `server/start-server.bat` lets a non-technical Windows user double-click to `npm install` + `npm start` without touching a terminal; `server/README.md` is written for that same audience.
- **Frontend integration (index.html):** on load, the page does a silent `fetch` to `http://127.0.0.1:8787/health` with a ~1.5s timeout, swallowing any failure quietly (`checkMp4Backend()`, module-level `mp4BackendAvailable` flag + `mp4BackendCheckPromise`). If reachable, a small "MP4 backend: connected" indicator appears in the recorder panel (`#fullBackendStatus`), and the recorder's `onstop` handler POSTs the recorded blob to `/convert` and downloads the returned MP4 instead of the raw browser recording (`convertViaMp4Backend()`, `downloadBlob()`). If the backend is unreachable — or a `/convert` call fails for any reason — the code falls straight back to the **original** direct-download-of-whatever-`MediaRecorder`-produced behavior, and shows a small inline, non-blocking note (`#fullBackendNote`, never `alert()`) explaining that the MP4 backend wasn't used.
- **This fallback must be preserved in any future edit.** The tool must never hard-require `server/` to function — it is a pure enhancement. If you touch the recording/backend-wiring code, keep it so that with the backend simply not running, the recorder still works exactly as before (direct blob download, no errors, no blocking UI).
- Verified twice: first in a sandboxed environment (no npm registry access) by shimming `express`/`cors`/`multer`/`ffmpeg-static` against the real, unmodified `server.js`; later, in a real session with internet access, via an actual `npm install` of the real dependencies (confirmed `ffmpeg-static` downloaded a working `ffmpeg.exe`) and a live run of `server.js` against the real `index.html` — `/health`, a real `/convert` round-trip, and `ffprobe` on the result all confirmed genuine H.264 video + AAC audio, faststart, non-zero size. Both the connected path and the backend-stopped fallback path (silent on load, correct fallback note after Stop, browser's native recording still downloads unbroken) were confirmed with zero console errors. `server/node_modules` may already exist from that verification — `start-server.bat`'s `npm install` step is idempotent either way.

## Resuming this project in a new session

This folder is **not** a git repository — there's no commit history or branches, just `index.html`, `server/`, and this file on disk exactly as they were last saved. To pick the project back up:

- Just reopen Claude Code in this folder (`D:\PROJECTS\whatsapp-chat-recorder`). This file is loaded into context automatically at the start of every session, so the current spec/status above is all the context needed — you don't need to re-explain the project.
- If you want the *conversation* itself back (not just the file context) rather than starting fresh, use Claude Code's own session resume (`claude --continue` / `claude --resume` from this same folder, or the equivalent in whichever client you're using) — that restores this exact chat history, separate from what's written here.
- Nothing here needs to be "started" to keep working — `index.html` opens directly as a `file://` page with zero setup. Two optional background processes from past sessions do **not** persist between sessions and would need restarting if wanted again: a plain static file server (e.g. `python -m http.server 8080` in this folder) used once to get a `localhost` link, and the optional MP4 backend (`server/start-server.bat`, or `npm start` in `server/`) for real H.264 output instead of the browser's raw recording.
- Keep this file up to date as the spec changes — it's the actual persistence mechanism for this project across sessions, more so than chat history.
