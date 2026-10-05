# Chat preview visual audit — October 6, 2026

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
