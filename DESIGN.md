# EVE Combat Analytics design

## Direction

- **Product** — fleet-fight review for EVE fleet commanders and pilots. Combine a battle report with player logs and share updates live.
- **Character** — tactical, immediate and legible at a glance.
- **Visual reference** — EVE's tactical overview, with game icons, blue for the viewer's side and red for the largest opposing side.
- **Key moments** — weapons, repairs and other effects on the replay, and kill ticks on the timeline.
- **Signature** — gold target-lock corners follow the selected pilot. Selection and keyboard focus use the same accent.

## Foundations

Use the system appearance until the viewer chooses light or dark. Save that choice locally. Tailwind and canvas rendering both consume the CSS variables. [Token source](src/app/styles/tokens.css)

| Token | Use |
| --- | --- |
| `--color-bg` | Page and replay background, including the stroke behind a replay label |
| `--color-surface` | Panels, drawers and dialogs |
| `--color-raised` | Controls, hovered rows, active tabs and image placeholders |
| `--color-text` | Body copy and numeric values |
| `--color-text-2` | Supporting copy and legends |
| `--color-text-3` | Table headers, timestamps and axes |
| `--color-hair` | Separators, row lines and control borders |
| `--color-accent`, `--color-accent-ink` | Primary action fill and its foreground. The replay cursor also uses the accent. |
| `--color-accent-line`, `--color-sel` | Target-lock corners, selection and focus outlines, and selected or current-event row backgrounds |
| `--color-side-0`, `--color-side-1`, `--color-side-2`, `--color-side-n` | Side dots, icon rings, curves and bars. Assign colors from the viewer's side outward. Use neutral gray and letters from D onward. |
| `--color-repair`, `--color-dead` | Repair effects and curves, and destroyed nodes and icons |
| `--font-ui`, `--font-mono` | Interface text and tabular figures |
| `--fs`, `--fs-s`, `--fs-l`, `--fs-title`, `--lh` | 13 px body, 12 px small text, 16 px headings, 24 px page titles and 20 px body line height |
| `--row`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6`, `--space-8` | 32 px standard rows and controls, with 4 / 8 / 12 / 16 / 24 / 32 px spacing |
| `--row-compact`, `--fs-compact-table`, `--fs-compact-body` | 24 px battle-module rows, 11 px module tables and 12 px battle body text |
| `--radius-ctl`, `--radius-card` | 6 px controls and 10 px panels |
| `--layer-popover` | Menus and popovers above floating windows and drawers |
| `--ease`, `--dur-hover`, `--dur-edge-in`, `--dur-edge-fade`, `--dur-move` | Shared easing, 140 ms hover, 200 ms effect entrance, 3 s effect fade and 300 ms selection or drawer motion |

Use 44 px phone targets where applicable. Right-align tabular values, group thousands, round intervals to the nearest 0.5 s where shown at that precision, and round percentages to whole values. Use an em dash with an explanation for missing data and zero for a measured zero. Keep game names as supplied and use Chinese for interface text. Use game assets for ship, module and damage-type icons. Respect reduced motion with static interactions and effects.

## Page layouts

| Surface | Layout |
| --- | --- |
| Home | Use a 48 px product bar and one centered column up to 720 px, with 24 px gutters or 16 px on phone. Accept a BR or related BR link and list recent battles opened on this browser. |
| Battle, at least 1100 px | Pin the replay and timeline together as the stage below the 48 px bar. Scroll the module area beneath it, including column gaps. Use three columns in a 1.45 : 1 : 1 ratio. Start with Events and Compare on the left, Roster and Kills in the middle, and Hits and Pilot Timelines on the right. |
| Battle, 760–1099 px | Keep the stage and use two module columns. Move the third column's modules below the middle column's modules. Keep both the battle name and the compact side label readable. |
| Battle, below 760 px | Use a 44 px top bar, leave Upload in reach and move statistics into the menu. Put replay above the compact timeline, with damage curves and kill ticks. Use the bottom sheet for Roster, Events and Compare. Support peek, half and full heights with a draggable, keyboard-operable handle. |
| Empty battle | Keep the battle shell and use the replay area to explain where to drop or choose logs. Show available coverage and use one column on phone. |
| Pilot details and fit | Use a right drawer about 420 px wide, with Data, Fit and Events tabs. Preserve the replay and lock. Let the drawer expand to the full body and open full page on phone. Restore focus on close. |
| Full-page module | Use the full battle body for an expanded module. Hide the stage windows and resize grip until the module closes. On phone, comparison can show the pilot and one navigable metric at a time. |
| Side assignment | Use a viewport-bounded panel below the top bar, with its own scrolling. Give every side a column and leave room for Unassigned and New Side. Show horizontal overflow and support keyboard access to every column. Stack the columns on phone. |

On desktop and tablet, aim for a combined stage height of 62% of the viewport by default, leaving 220 px for modules where space permits. Keep the timeline at least 150 px with a damage lane at least 90 px. The resize grip sets the whole stage between 300 px and 75% of the viewport when both limits fit. Preserve the timeline and viewport fit at smaller heights, and let the module area shrink when the viewer resizes the stage. Double-click the grip to reset the height.

## Components

### Replay and timeline

- Use the ship render as the node, with a side outline and a character portrait badge. Show names for pilots with uploaded logs, for the selected pilot and for the hovered pilot. Fit other names where they do not overlap. Show all names at 1.5× zoom and above. Use a background-colored stroke beneath the name fill for legibility. The hover card shows the portrait, name and ship.
- Default the viewer's side to the side with the most uploads. Place it on the left. For two sides, place the opponent on the right. For more sides, distribute the remaining sides from the right around the canvas and distinguish sides beyond the first three with letters. Keep unassigned pilots in a distinct neutral group below the center. The top-bar side choice travels with the view URL.
- Draw effects beneath nodes. Scale each effect type by the fight's quantiles for that type. Move weapon and module icons along the trajectory and show the name in the tooltip. Use generic samples for the legend. When a weapon or module has no icon, show its name as text on the trajectory; never draw a placeholder glyph. A missed shot is dashed and ends partway with × and a missed-shot tooltip. An in-flight hit at pause keeps a solid shot line. Keep static nodes still while paused.
- Keep Zoom and Fit to View at the lower left of the replay and reserve room for the replay control pills. Make Interaction Legend and Current Fights draggable, collapsible, closable windows in the workspace layer. Keep them within the viewport. Open the legend below the pills and position Current Fights clear of pilot centers where possible. It covers the preceding ten seconds and starts collapsed on stages narrower than 1200 px. Keep Damage Filters anchored to its control and clamped to the viewport. Offer filters for drones, smartbombs and misses.
- Show damage by side, primary spans and kill ticks by default. Add optional repair and point-control lanes and kill ship icons. Protect lane heights and legibility as layers change. Use the same cursor for chart seeking, drag scrubbing, play, next event and 1× / 2× / 4× / 8× speed. Wheel or pinch zooms time. Shift-drag or the touch range control scopes the modules to a time range. Use the data already delivered to the browser for range calculations.
- Use the shared pin set for Pilot Timelines and Compare. Each pinned pilot gets a lane on the same time axis and cursor, with output, incoming damage or repair output and a peak annotation. Label observed data when it comes from other pilots' logs. Use the timeline help to describe shortcuts and controls. Give it a heading and a visible close button, and support Escape.

### Data modules and dialogs

- **Event feed** — default to individual events (逐条) and remember the viewer's choice. Offer merged actions and key events as alternate modes. Give each mode column headings. Use time, actor, weapon or module, target and value for individual events. Use last time and total × count for the merged variant. Use time and event for key events. Follow the cursor, highlight its current event and fall back to time separators in narrow panels.
- **Roster and portraits** — show portrait, log dot, name, relevant source label and ship icon with ship name. Use a solid log dot for an upload and a hollow dot for no upload. Dim destroyed icons and strike through destroyed names. Put logged allies first and sort opponents by observed activity. Show only manual or inferred side changes as source labels, with the time or evidence on hover. Keep Unassigned separate. Use the same-size empty portrait slot when the character ID is unavailable. Use one row button for the pilot. Put secondary actions in the ⋯ or context menu.
- **Compare** — use the sortable table for many pilots, side by side for pinned pilots and distribution for spread. Keep side-by-side capacity open to the number of pilots the viewer pins. Group columns for output, timing, incoming damage, logistics and point control. Use a thin median reference line for recorded values. Let viewers filter by multiple sides and compare observed values across pilots. Expose incoming damage type breakdowns wherever the evidence identifies them, and explain unknown types.
- **Hit analysis** — compare hit-quality distribution, hit rate and change over time across sides and weapon classes. Give each confirmed pilot the available observed metrics, including opponents seen in the logs. Keep hit quality separate from damage records without a quality grade. Metric-specific ranks may have a rank column. Show sample size next to each rank and place pilots below the sample threshold in a separate insufficient-sample section. Show the same observed hit metrics in Compare and pilot details.
- **Side assignment** — represent every actual side and show affiliation names and sizes in the picker and panel. Use alliance or corporation logos and allow moving groups or individual pilots by drag or menu. Resolve assignment by manual pilot override, manual group override, log evidence, BR or kill report, then ESI. Infer sides from reviewed logs for pilots outside the BR. Let viewers identify an unknown ship through the row menu and merge it to a known pilot.
- **Kills** — show the victim, ship, timestamp and ISK loss. Selecting a kill seeks to that moment in the replay. Use the shared pilot selection and menu where a row identifies a pilot.
- **Upload** — accept files anywhere on the battle page or from the top bar. Use a flat tray with queued, uploading, parsing and complete states. Show progress for upload and indeterminate activity for parsing. Completed rows report pilot, event count, time span and client language when known. Append uploads, explain duplicates and parsing failures, and give failed rows a removal action.
- **Pilot and fit** — use a single editor per pilot. Show theory from pyfa next to observed active average and peak. Accept pasted EFT or prefill it from an eligible killmail for confirmation. Show loading on first calculation and explain base attributes where abyssal mutation data is unavailable. Show damage composition and log coverage in pilot details.
- **Portraits** — show a character portrait wherever a pilot is named. Use 20 px in roster and Compare rows, 16 px in feed and upload rows, 28 px for kill victims (32 px kill rows, 16 px ship overlay) and 56 px in pilot details. Use the game portrait and logo assets with a same-size fallback.

## Interaction rules

1. Give every module the same title bar with a drag handle, title, subtitle, tool controls, pop-out and collapse. Give icon controls tooltips and accessible names.
2. Start a module drag from the grip or empty title-bar space. Show the grab cursor and hover highlight. Show the insertion placeholder and drag preview, suppress text selection and let Escape cancel to the original position. Floating modules move by title bar, resize by corner, dock from their title-bar action or by dropping on a column, and rise on focus.
3. Share one selection across roster, events, compare, hits, kills, replay and timeline. Clicking a pilot highlights the corresponding rows, locks the map and opens pilot details. Clicking again or pressing Escape clears the selection. Solo playback is an explicit action in the drawer.
4. Open the same action menu from ⋯ and right-click. Give each pilot row a single primary control and put secondary actions in that menu, including side assignment, identification, timeline pinning and replay focus.
5. Offer undo for shared side, identity and fit edits. Show the bottom-center toast for 10 seconds from the action, pausing while hovered or focused. Show pending feedback while waiting for a change to appear and allow immediate undo for optimistic edits. Undo restores the prior shared state.
6. Escape closes one layer at a time in this order — menu, dialog or drawer, floating window, range, then selection. Closing pilot details clears its associated selection.
7. Every module's empty state explains how to give it content.
8. Save layout positions, collapse and visibility, floating-window geometry and stage height to local storage. Show module choices and state in the Layout menu. Reset from Restore Default Layout and use the default when saved layout data is invalid or incompatible.
9. Make module title bars focusable. Alt+Arrow reorders within a column or moves between columns, and focus follows the module. Preserve keyboard controls for the replay, timeline and tables.
10. Show the dismissible timeline hint on first visit and put other instructions behind the help control.

## Don'ts

- Keep side colors on dots, outlines, curves and bars. Keep all text and numeric values in text colors.
- Avoid colored pill badges, red and green judgments, composite scores and implied pass marks. Use median lines only as reference.
- Avoid drop shadows, text shadows and elevation glows. Use borders, surface tones and flat selection lines.
- Avoid slogans, taglines and decorative copy. Use labels that help the viewer act or interpret data.

## Pre-ship

- [ ] Use the real 17-log J125990 fixture for screenshots. Review desktop, tablet and phone at 1280, 900 and 390 px in light and dark, and spot-check the wide and reduced-motion layouts.
- [ ] Verify the stage drag limits, drag cancellation, focus return, overlay ordering and keyboard and touch navigation.
- [ ] Verify live upload and side changes in two independent browser contexts. Confirm the token guard, component states in `/_gallery` and the remote gate with `scripts/check-remote.sh`.
- [ ] Run `node scripts/rules-live.mjs` against the deployed battle for the read-only interaction checks and `node scripts/rules-live.mjs --local` for the reversible identity edit. Use `build/final-live.mjs` for final deployed-site captures.
