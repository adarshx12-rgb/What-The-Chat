# WhatsApp Chat Story Recorder — Design Direction

## Product character

Build a professional creator tool that feels calm, precise, and trustworthy.

The product has two intentionally different visual environments:

1. **Studio UI:** a restrained, Vercel-inspired dark workspace for configuring, previewing, and exporting a chat story.
2. **Phone preview:** a highly realistic mobile chat simulation. Android and iOS modes must remain visually distinct and faithful to their platform conventions.

Do not apply the studio's minimalist styling inside the phone preview. The preview is the content being produced; the studio is the tool used to produce it.

## Design principles

- **Preview first:** the phone preview is the visual focal point. Controls support it rather than compete with it.
- **Progressive disclosure:** show essential controls first; place advanced appearance and export options in collapsible sections.
- **Quiet precision:** rely on spacing, typography, borders, and state changes—not gradients, glow, or decorative effects.
- **Immediate feedback:** every editor change should update the preview instantly. Recording, conversion, success, and failure states must always be visible.
- **Platform realism:** Android/iOS selection must change more than a label; it should change type, spacing, status bar, header, bubble geometry, and composer details.
- **Creator confidence:** destructive actions need confirmation or undo. Long-running actions need progress and a clear result.

## Visual split

### Studio shell

Use a Vercel-like neutral dark UI:

- Near-black page background
- Layered charcoal surfaces
- Thin neutral borders
- Compact controls with strong focus states
- Mostly neutral typography
- WhatsApp green used sparingly for primary actions and positive status
- Red reserved for destructive actions and recording

Avoid oversized headings, glassmorphism, neon glow, colorful gradients, pill-shaped everything, and excessive card nesting.

### Phone preview

The preview must resemble a real captured phone screen rather than a themed website component:

- Render at 1080 × 1920 (9:16)
- Preserve safe areas, status bar, app header, chat wallpaper, bubbles, timestamps, delivery ticks, and composer
- Keep text sharp and all important elements inside recording-safe bounds
- Never place studio controls inside the captured canvas
- Never allow recording indicators, editor hover states, or the mouse cursor into the output

## Studio design tokens

Use these as the default shell tokens. Existing preview-specific platform tokens remain separate.

```css
:root {
  --studio-bg: #09090b;
  --studio-surface: #111113;
  --studio-surface-raised: #18181b;
  --studio-surface-hover: #202024;
  --studio-border: #2a2a2f;
  --studio-border-strong: #3f3f46;
  --studio-text: #fafafa;
  --studio-text-secondary: #a1a1aa;
  --studio-text-tertiary: #71717a;
  --studio-accent: #25d366;
  --studio-accent-hover: #20bd5a;
  --studio-accent-text: #052e16;
  --studio-danger: #ef4444;
  --studio-warning: #f59e0b;
  --studio-focus: #60a5fa;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-float: 0 16px 48px rgb(0 0 0 / 45%);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

Do not reuse studio tokens when drawing the chat canvas. The canvas must use its Android/iOS and chat-theme tokens.

## Typography

### Studio

- Font: Inter, Geist, or the system sans-serif stack
- Page title: 18px / 600
- Section title: 12px / 600, uppercase only when useful, with modest letter spacing
- Body/control text: 13–14px / 400–500
- Helper text: 12px / 400
- Numeric timers: tabular numerals

### Preview

- Android: Roboto-compatible system stack
- iOS: San Francisco-compatible system stack
- Match platform-specific sizes and weights; do not force the studio font into the preview

## Layout

### Desktop, 1200px and wider

- Use a three-zone studio: editor sidebar, centered phone stage, export/recording panel
- Editor sidebar: 360–420px, independently scrollable
- Phone stage: flexible center region with the preview centered both visually and spatially
- Export panel: 240–280px, sticky when space permits
- Keep the preview visible while editing; scrolling the editor must not move it off screen

For the current two-column implementation, keep the recording controls beside the preview until the third zone is introduced.

### Tablet, 768–1199px

- Use an editor drawer or tabs: **Content**, **Appearance**, **Export**
- Keep the preview centered and scale it without changing its internal 9:16 coordinate system

### Mobile, below 768px

- Stack preview above controls
- Use a bottom-sheet editor or compact tabs
- Never shrink form controls below a 44px touch target
- The tool must remain usable, but desktop is the primary authoring experience

## Information architecture

Group controls in this order:

1. **Chat identity** — contact name, avatar, online/typing/last-seen status
2. **Messages** — sender, text, timestamp, ticks, delay/duration, ordering
3. **Appearance** — Android/iOS, light/dark, wallpaper, bubble colors
4. **Playback** — play, pause, restart, current message, total duration
5. **Export** — format, quality, recording state, conversion progress, download

Make **Messages** the dominant editor section. Appearance options should not push the message editor below the fold by default.

## Components and states

### Header

- Product name on the left
- Project/file name and saved state nearby
- Compact actions on the right: reset, import/export project, help
- Do not use a large marketing-style hero header inside the tool

### Message cards

- Use a clear sender segmented control: **Contact** / **Me**
- Give the message text area the most space
- Keep time, ticks, and playback delay in a compact metadata row
- Provide drag handle or explicit move controls
- Use icon buttons for duplicate and delete; include tooltips and accessible labels
- Show the selected/active message with a subtle border or background change
- Do not add a blank message when the user presses playback Send; editing and playback are separate operations

### Buttons

- Primary: solid WhatsApp green; one primary action per region
- Secondary: neutral surface with border
- Destructive: neutral or transparent until hover; red text/icon
- Icon-only controls: minimum 32px desktop and 44px touch, always with an accessible name
- Use a consistent SVG icon family such as Lucide; do not mix emoji, text glyphs, and unrelated icon styles

### Inputs

- Labels remain visible; placeholders are examples, not labels
- Inputs use 36–40px desktop height and 44px touch height
- Show focus with a high-contrast blue or neutral ring, not only a border-color change
- Place validation text immediately below the related input

### Recording panel

Use explicit states:

| State | Primary action | Visual treatment | Required message |
|---|---|---|---|
| Ready | Start recording | Neutral | Estimated duration and export format |
| Recording | Stop | Red dot + timer | “Recording preview” |
| Paused | Resume | Amber status | “Recording paused” |
| Processing | None/cancel if supported | Progress indicator | “Converting to MP4…” |
| Complete | Download MP4 | Green success | File size and duration |
| Error | Retry | Red error | Plain-language cause and next action |

Disable conflicting editor actions while recording only when they would corrupt the output. Explain disabled states with helper text or tooltips.

### Toasts and dialogs

- Use toasts for saved, copied, downloaded, and recoverable failures
- Use inline messages for field errors and backend availability
- Use confirmation dialogs only for clearing the whole project or losing a recording
- Prefer undo after deleting a single message

## Preview realism requirements

- Use believable default values instead of generic placeholders
- Support realistic message grouping: reduced gap and hidden/reduced tails for consecutive messages from the same sender
- Use subtle wallpaper texture; keep contrast sufficient for both bubble colors
- Align time and tick marks consistently at the bubble baseline
- Animate typing and message appearance with restrained, platform-like motion
- Incoming and outgoing messages should appear from their correct side with a 160–220ms ease-out transition
- Auto-scroll smoothly as messages appear
- Preserve user-entered timestamps; do not silently rewrite them during playback
- Playback should reveal existing messages according to timing data and must not mutate the message list

## Motion

- UI hover/focus: 100–150ms
- Panel/drawer movement: 180–240ms
- Message reveal: 160–220ms ease-out
- Respect `prefers-reduced-motion`
- Do not use continuous decorative motion
- Recorded output timing must be deterministic and must not depend on editor frame rate

## Accessibility

- Meet WCAG AA contrast for studio controls and text
- All functionality must be keyboard accessible
- Maintain visible `:focus-visible` states
- Pair color states with text or icons; never communicate status using color alone
- Provide labels for file inputs, icon buttons, segmented controls, and recorder controls
- Announce recording and conversion changes through an `aria-live` status region
- Do not place small muted text on low-contrast surfaces

## Copy style

Use short, direct labels:

- “Start recording,” not “Start” when context may be unclear
- “Restart preview,” not “Reset chat” if message data is preserved
- “Clear project” only when data will actually be removed
- “MP4 converter unavailable,” followed by a useful next step
- “Download MP4,” followed by file size when known

Never expose raw technical errors to users without a plain-language explanation.

## Implementation boundaries

- Preserve the 1080 × 1920 canvas as the recording source
- Keep editor DOM state separate from playback state
- Keep playback state separate from recording state
- Never infer playback progress from how many times an editor button was clicked
- Use one source of truth for messages, with stable IDs
- Treat timing as data on each message or as a generated timeline
- Start `MediaRecorder` with periodic chunks so long recordings do not remain as one unbounded in-memory blob
- Prefer same-origin backend endpoints such as `/health` and `/convert`; do not hard-code localhost URLs for production
- Show a fallback WebM download when MP4 conversion is unavailable
- Avoid adding a framework solely for visual polish. Refactor when component/state complexity justifies it

## Non-goals

- Do not turn the studio into a WhatsApp clone
- Do not add social feeds, accounts, collaboration, or analytics unless explicitly requested
- Do not imitate Vercel branding, logos, or exact proprietary page layouts
- Do not sacrifice preview accuracy for decorative studio effects

## Definition of done for UI changes

A design-related change is complete only when:

- It works at 1440px, 1024px, and 390px viewport widths
- Keyboard focus is visible and logical
- Empty, loading, recording, paused, processing, success, and error states are handled where relevant
- The canvas output still renders at 1080 × 1920
- The exported recording contains no cursor or studio controls
- Android and iOS preview modes remain visually distinct
- Text does not clip with long contact names or multi-line messages
- Controls do not shift unexpectedly between recorder states
- The final result is checked visually, not only through code inspection

## Decision rule for Claude Code

When a request is ambiguous, prioritize in this order:

1. Recording correctness
2. Preview realism
3. Editing clarity
4. Accessibility
5. Visual polish

Before introducing a new pattern, reuse an existing token or component. If a proposed change conflicts with this document, explain the tradeoff before implementing it.
