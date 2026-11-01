# Chat preview visual audit — October 6, 2026

## Status clocks and call cards — November 1, 2026

The clock now uses fixed digit advances, one stable digit baseline, and a
vertically centred time colon. These are drawn on the capture canvas, so preview,
PNG export, and video use the same typography at every viewport size. Apple
devices retain their system-font preference; Windows uses the bundled Inter
fallback. The fallback is an approximation of SF Pro, not an exact replacement.
The centred colon follows [Apple's description of time typography](https://developer.apple.com/fonts/).

Call-card changes apply to the studio's Gen 2 and Gen 3 presets; Gen 1 remains
excluded. Both platforms now have the inset card surface, lighter icon disc,
filled directional handset/camera, a red incoming missed-call icon, and a
separately positioned timestamp without delivery ticks. iOS and Android have
separate icon, padding, height, subtitle and timestamp measurements. Colours
still follow the project's light/dark and custom bubble settings.

Short calls can be entered in seconds and saved in projects/backups. Legacy
hour/minute projects retain their duration; old text such as `45 sec` imports as
seconds. Android pluralizes minutes/hours; iOS retains the short `min`/`hr`
labels. Seconds are shown for sub-minute calls, with compact minute/hour labels
for longer calls. Incoming missed calls say “Tap to call back”; outgoing
unanswered calls say “No answer”. Gen 3 also depicts the message-recording prompt
under unanswered outgoing calls. This is part of the staged canvas image, not a
live call or audio/video-recording control.

Reference evidence:

- [Guiding Tech's August 2024 iPhone capture](https://www.guidingtech.com/how-to-set-custom-notification-sound-for-specific-contacts-on-whatsapp/): incoming/outgoing voice calls, seconds, missed calls, inset surfaces, icon colours, and timestamp placement.
- [WABetaInfo's Android capture reproduced with attribution](https://tn.com.ar/tecno/aplicaciones/2023/12/14/no-uno-sino-muchos-whatsapp-permitira-fijar-multiples-mensajes-en-los-chats/): filled video-call camera and contrasting incoming/outgoing arrow. This is an older reference for the card structure, not proof of every later rollout.
- [Samsung user's Galaxy S25 capture](https://eu.community.samsung.com/t5/galaxy-s25-series/galaxy-s25-ultra-screen-glitch/td-p/11599836) and [Galaxy A55 capture](https://r1.community.samsung.com/t5/galaxy-a/galaxy-a55-5g-display-issue-in-whatsapp-video-call/td-p/34040271): newer Android light/dark call cards and neutral outgoing unanswered-call icons.
- [WhatsApp's December 2025 announcement and photograph](https://blog.whatsapp.com/new-feature-roundup-missed-call-messages-new-status-stickers-and-more/): inset missed-call card and the “Record voice message” row. The announcement confirms the corresponding video-note feature; the exact video-row wording/layout across both OS versions is not established by that photograph.

Verification: `tests/e2e/call-cards.spec.js` covers all 64 platform/generation/
theme/type/direction/result combinations, long-duration bounds, timestamp
separation, absent delivery ticks, Gen 1 exclusion, seconds editing, reload and
backup migration. It also checks 1500/768/390/360px layouts and a touch-enabled
390px viewport at 3× pixel density. Comparison PNGs are attached to that test's
output. `output/check-status-clock.cjs` checks 84 clock samples across all 12
platform/generation/theme combinations and captures desktop/mobile previews.
Browser checks run in Windows Chromium/Edge; they are not physical iPhone or
Safari checks. Exact appearance still varies by OS font, locale, WhatsApp build,
and rollout; the presets are not pixel-identical emulations of every release.

Reviewed Android and iOS in all three generations, in both light and dark mode
(12 rendered variants). Comparisons use screenshots normalized by screen width;
the export stays 1080 × 1920 rather than adopting the taller aspect ratios of
recent physical phones. The presets represent eras, not exact app builds.

| Preset | Review and changes |
| --- | --- |
| Classic Android | Kept the green header and compact angular bubbles. Increased the undersized contact identity, avatar, date chip, and composer; tightened consecutive-message gaps. |
| Refreshed Android | Retained the measured neutral header, outlined icons, typing indicator, and composer geometry. Expanded the overly narrow maximum message/media width and made reply text readable. |
| Current Android | Retained the rounded bubbles, grouped tails, and frameless media. Applied the width, reply, wrapping, and emoji fixes. |
| Classic iOS | Reduced the excessively tall contact header, used a top-connected notch instead of a miniature Dynamic Island, improved identity/status proportions, and corrected dark header material. |
| Refreshed iOS | Preserved the green controls and solid toolbars. Improved status icon scale, clock placement, and Dynamic Island proportions. Applied shared text/media fixes. |
| Current iOS | Kept the glass header and floating controls. Added the separate idle camera capsule and filled microphone action seen in the September 2026 reference; typing hides the camera and expands the input. Updated status proportions and shared text/media layout. |

## Cross-platform corrections

- Long initial words, URLs, and text without spaces now wrap inside bubbles.
- Wrapping and truncation preserve whole grapheme clusters: joined families,
  professions, skin tones, flags, keycaps, and combining characters.
- Short emoji-only messages use larger glyphs with proportional line heights.
  Mixed text, captions, quoted replies, and longer emoji strings keep normal
  text sizing. These are static emojis, not animated stickers.
- Reply snippets wrap and truncate within their available width.
- Maximum bubble width is 80% of the canvas; media width is 76%, matching the
  wider photo-message proportions visible in the references. These are preset
  approximations, not pixel measurements for every device and font setting.
- Canvas exports wait for the bundled emoji font to settle. Scroll controls
  remain outside the canvas; the actual scrolled conversation is exported.

## Emoji and fidelity limits

Windows previously supplied Segoe emoji for both platforms and rendered some
flags as country letters. A bundled Noto Color Emoji COLRv1 font now provides a
consistent color fallback with flag and joined-sequence support. iOS styling
prefers Apple Color Emoji where that font is installed. The fallback's drawings
are **not** the proprietary Apple or WhatsApp emoji set. Likewise, the embedded
Inter fallback on non-Apple computers approximates, rather than reproduces, SF
Pro. Exact screenshots vary with app rollout, OS, display scaling, and font size.

The font is unmodified apart from WOFF compression, packaged as a local script
with a data URL so direct `file://` use remains possible. No emoji-service network
request is added. Source and SHA-256 are in `assets/chat-emoji.js`; its SIL Open
Font License is in `assets/NotoEmoji-LICENSE.txt`. COLRv1 rendering was checked in
Chromium; browsers without support fall back to their installed emoji fonts.

## References

- [Meta's May 2024 design explanation and before/after images](https://www.meta.com/design-at-meta/blog/whatsapp-user-interface-update/)
- [The same official screenshots in Meta's newsroom](https://about.fb.com/br/news/2024/05/mantendo-o-whatsapp-moderno-simples-e-acessivel/)
- [WABetaInfo's September 2026 iOS chat-interface screenshots](https://wabetainfo.com/whatsapp-is-widely-rolling-out-the-full-liquid-glass-experience/)
- Existing local Android and iOS reference captures in `output/` were also inspected.
- [Google's Noto Emoji source and license information](https://github.com/googlefonts/noto-emoji)

## Verification artifacts

Local audit captures are in `output/audit-after-*.png`, with light/dark comparison
sheets and per-variant layout metrics. `output/audit-chat-ui.cjs` checks long text,
emoji sequences, sizing, quote bounds, and composer geometry, then runs the
existing generation/recording/export checks. `output/check-chat-scroll.cjs`
covers scrolling and dock interactions. `output/` is local verification material
and is intentionally excluded from Git and deployment.
