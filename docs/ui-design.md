# UI design guide

MindRoom Chat uses restrained, Liquid Glass-inspired surfaces: readable content, shallow blur, and consistent controls.
This guide records the settled design rules for future UI changes.
The [Runbook](../FORK_CHANGES.md#runbook) retains implementation history; older experiments there do not override these rules.
Update this guide alongside intentional changes to shared visual behavior.

## Choose the surface by its role

| Role                                                                                          | Treatment                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Room toolbar, navigation titles, Members title, scrolling settings/dialog titles              | Flat translucent glass: content scrolls behind it; no rim, border, shadow, or pointer glow.                                                                  |
| Full-height icon rail                                                                         | Flat glass, without a raised outer edge; preserve individual buttons, avatars, badges, and selection indicators.                                             |
| Command palette, menus, dialogs, floating thread banner, and thread filter panels             | Rounded glass surface with a restrained directional rim; preserve rounded bottom corners when scrolling or when the keyboard opens.                          |
| Composer, audio player, inline summaries, tool/approval disclosures, typing and approval bars | Reuse the shared material and rim, with spacing between separate surfaces.                                                                                   |
| Rows within a glass panel, including nested approval receipts                                 | Let the enclosing surface own the glass; avoid stacking opaque fills, rims, or blur on every child. Selection and semantic states can retain their own fill. |
| Following/status strip below the composer                                                     | Flat blur only while it contains status text; an empty strip stays fully clear and unblurred so messages remain visible.                                     |
| Operator notice banners above the app                                                         | Flat strip in the level's Folds `Container` colors with a bottom `ContainerLine`; in normal flow, so the layout below shrinks instead of being covered.      |

The room toolbar and the floating thread banner are different surfaces.
The toolbar has room navigation and member/menu controls; the banner has thread details and actions.
Do not remove the banner's rim when making the room toolbar flat.
The same navigation treatment applies across Home, rooms, DMs, invites, spaces, Lobby, Explore, and Members, including simple mode.

## Color, light, and edges

- Use Folds theme colors and spacing/radius tokens, plus the shared [glass materials](../src/app/styles/Glass.css.ts).
  Avoid per-component white fills, custom gradients, or duplicate opacity constants.
- A neutral header inside a glass panel uses the panel's color, adding blur without a second tint layer.
  With no content underneath, header and body should read as one surface, including in light mode.
- Tint and blur vary by surface role; uniform styling does not mean identical opacity everywhere.
  Floating chrome uses the shared shallow-blur modifier; dimmed sheets need less tint than menus over an undimmed page.
  Change these presets centrally, and check readability against actual content.
- Raised surfaces use a thin directional rim: top and bottom catch the light, sides recede.
  The current CSS rim uses a vertical `180deg` gradient, with shading that stays visible against light backgrounds.
  Do not paint a constant-color resting outline over it; preserve meaningful focus, selection, and playback indicators.
- Flat headers have no decorative hover glow, including light on their enclosing panel triggered by hovering a header control.
  Keep keyboard focus visible and preserve deliberate control-state feedback.
- Dividers are quiet theme-colored lines, never specular edges.
  Recently Opened keeps its quiet inset divider; do not turn it into another floating glass shelf.

## Scrolling and layout

Transparency requires content behind the surface.
Putting a translucent header above a separate scroll viewport cannot reveal that viewport's content.

- Use [PageScroll](../src/app/components/page/Page.tsx) with its `header` slot for scrolling pages and dialogs, and `PageNavContent` with `PageNavHeader` for navigation lists.
  The header stays inside the viewport and receives the flat treatment automatically.
- Use the shared [InsetScrollbar](../src/app/components/inset-scrollbar/InsetScrollbar.tsx) pattern: content can pass behind headers and footers, but the visible scrollbar starts below the top controls and ends above the composer/footer.
- Reuse measured heights for sticky search/action bars, virtual-list offsets, focus scrolling, and floating controls.
  Do not hard-code a second estimate of the header or composer height.
  See [room overlay insets](../src/app/mindroom/threads/RoomOverlay.css.ts) for chat layouts.
- Keep Jump to Latest and Show more/less reachable above the composer, even as typing, approvals, tags, or the software keyboard change the available space.
  Header resizing must preserve the reader's scroll position.
- The composer floats with breathing room below it; do not add an opaque full-width shelf underneath.
  Preserve safe-area spacing, pointer access to messages in clear gaps, and small gaps between tool disclosures and approval history.
- Shrink decorative controls without shrinking usable hit targets.
  The [audio player](../src/app/components/message/content/VoiceAudioContent.css.ts), for example, separates its visible play disc from its larger touch target.

## Reuse the shared implementation

Use the app-owned [GlassPrimitives](../src/app/components/glass/GlassPrimitives.tsx) for `Menu`, `Modal`, `Dialog`, `Header`, `Surface`, `IconButton`, `Chip`, and `MenuItem` where these treatments apply.
Direct imports of the equivalent Folds components bypass those defaults; ordinary layout components still come from Folds.
Custom component families should compose `glassSurface` and shared modifiers instead of reproducing their styles.

- `appearance="glass"` supplies a material, `"inherit"` reveals the enclosing surface, and `"plain"` keeps ordinary styling.
  These options belong to the surface primitives; they are not a universal prop on every control.
- A `Header` in a `PageScroll` header slot becomes flat automatically.
  So does a neutral `Header` with no enclosing surface: standalone page chrome is flat, with no raised rim or bottom border.
  Pass `appearance="glass"` or `flat={false}` only for a deliberately raised standalone header.
- Section labels inside a list or card (room groups in Notifications or message search, a call's participant label) use `appearance="plain"`: they are rows, not chrome.
- Neutral nested headers inherit the panel treatment; semantic variants retain matching foreground and background colors for contrast.
  Menus default to transparent rows, with explicit selected states where needed.
- Keep the existing surface/context boundaries and separate panel backdrop layer.
  They prevent portal dialogs inheriting the wrong header behavior and nested blur repainting the tint or blurring the panel rim.
- Draw text buttons soft and outlined: `fill="Soft"`, `outlined`, and `radii="300"` unless the button sets another radius; `size="500"` buttons keep the default radius so they match the sign-in and create buttons beside them.
  A button with its own ring, such as the pending approval Review button, drops `outlined`.
  The variant carries the meaning (`Primary`, `Success`, `Critical`), including selected and unsaved states; a solid fill reads as a bright pill in dark themes.
  Give the main safe action its own variant (usually `Primary`) when a destructive action sits beside it, so the two never look alike.
  An unselected toggle is `fill="None"` without an outline beside the selected soft, outlined `Primary` one: a soft `Secondary` fill is darker than a soft `Primary` one in light themes, and a `fill="None"` outline draws in the variant's main color, louder than the selection.
  A `Spinner` inside a soft button uses `fill="Soft"`, and buttons with `fill="None"` keep it.
  The only solid button is "Sign in with Apple", whose appearance Apple prescribes.

Example structure, using the app-owned `Modal` and `Header`:

```tsx
<Modal size="500">
  <PageScroll header={<Header size="600">Account</Header>}>
    <PageContent>{accountSettings}</PageContent>
  </PageScroll>
</Modal>
```

This is automatic through shared components, not a global rule that makes arbitrary DOM elements glassy.
Fix a repeated inconsistency in its shared primitive or component family, with an explicit exception only when the surface needs one.

## Browsers, accessibility, and cost

- CSS translucency, native backdrop blur, and the shared rim are the baseline.
  The isolated [liquid-glass runtime](../src/app/components/glass/liquid/liquidGlass.ts) adds SVG refraction on supported Chromium configurations; WebKit/iOS and Firefox keep native CSS glass.
  Preserve this fallback and avoid claiming pixel-identical rendering across engines or exact reproduction of Apple's native material.
- Keep the glass implementation dependency-free.
  Do not allocate a refraction filter and observers per small button or inline card.
  Use [useGlassHighlight](../src/app/components/glass/liquid/useLiquidGlass.ts) for a card's pointer highlight without refraction; flat chrome needs neither.
- Preserve bounded map generation, caching, offscreen cleanup, and animation-frame-batched pointer updates.
  Pointer movement must not drive React renders or rebuild optical maps.
- Respect reduced transparency, increased contrast, forced colors, and reduced motion.
  Opaque fallbacks are intentional; focus outlines and readable semantic states take priority over decoration.
- Use the shared [motion tokens](../src/app/styles/Motion.css.ts) for transitions.
  Avoid perpetual decorative animation; do not rely on hover to expose essential actions on touch devices.

## Review visual changes

Scale these checks to the affected surfaces and risk; a small local tweak needs a focused check, while shared material or layout changes need the broader coverage below.

1. Capture before/after views with the same theme, viewport, content, and scroll position, using disposable data.
   Include content visibly scrolled beneath the header; an empty panel does not demonstrate transparency.
2. Check light and dark themes in Chromium and WebKit, plus other supported themes when shared color/rim tokens change.
   Inspect narrow screens, nested menus, keyboard-open layouts, hover/focus, and accessibility fallbacks relevant to the change.
3. Exercise scrolling, first/last-item access, expanding disclosures, scrollbar dragging, and controls near the composer.
   Check the shared component's other consumers, not only the screenshot that prompted the change.
4. Reuse the [glass visual helpers](../e2e/helpers/glassVisual.ts) and existing [surface](../e2e/glass-surfaces.spec.ts), [dialog](../e2e/dialog-menu-glass.spec.ts), and [live settings](../e2e/live/settings-header-glass.spec.ts) coverage.
   See [testing instructions](testing.md) for the browser runner and fixtures.
5. Label rendering limits honestly: Linux headless WebKit has not painted native backdrop blur in our test environment.
   Its screenshots establish layout/transparency, not final iPhone blur appearance; verify native painting on an Apple device when judging that effect.

Keep the guide focused on durable rules and link to implementation/tests for details.
Do not copy private screenshots, chat content, or an entire PR history into the repository.
