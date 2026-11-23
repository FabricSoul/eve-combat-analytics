# EVE Combat Analytics design

## Direction

- **Product** — fleet-fight review for EVE fleet commanders and pilots.
- **Character** — tactical, immediate, legible at a glance.
- **World** — EVE's tactical overview, with game icons and a dark surface by default on dark systems.
- **Moments** — live weapon and module effects in the replay and the kill ticks on the timeline.
- **Signature** — gold target-lock corners follow the selected pilot and identify active selection.

## Foundations

Use [the CSS token file](src/app/styles/tokens.css) as the source of truth. Tailwind references those variables. Follow the system appearance preset and save the viewer's choice on this browser.

| Token | Use |
| --- | --- |
| `--color-bg` | Page and replay background |
| `--color-surface` | Panels, drawers, dialogs |
| `--color-raised` | Controls, hover rows, active tabs, image placeholders |
| `--color-text` | Body copy and all numeric values |
| `--color-text-2` | Supporting copy and legends |
| `--color-text-3` | Table headers, timestamps and axes |
| `--color-hair` | Separators, row lines and control borders |
| `--color-accent`, `--color-accent-ink` | Primary action fill and its foreground. The accent also marks the replay cursor. |
| `--color-accent-line` | Target-lock corners, selection edge and keyboard focus |
| `--color-sel` | Selected and current-event row background |
| `--color-side-0/1/2`, `--color-side-n` | Dots, ship outlines, curves and bars for the viewer's side, the two largest opposing sides and subsequent sides. Use letters from D onward. |
| `--color-repair` | Replay repair effects and their plot marks |
| `--color-dead` | Destroyed nodes and icons |
| `--font-ui`, `--font-mono` | Interface and tabular figures |
| `--fs`, `--fs-s`, `--fs-l`, `--fs-title`, `--lh` | 13 px body, 12 px rows, 16 px headings, 24 px page titles, 20 px body line height |
| `--row`, `--space-1/2/3/4/6/8` | 32 px rows and controls, 44 px phone touch targets, and 4 / 8 / 12 / 16 / 24 / 32 px spacing |
| `--radius-ctl`, `--radius-card` | 6 px controls and 10 px panels |
| `--ease`, `--dur-hover`, `--dur-edge-in`, `--dur-edge-fade`, `--dur-move` | Shared easing, 140 ms hover, 200 ms edge entrance, 3 s fade and 300 ms selection or drawer motion |

Use tabular, right-aligned figures in text color. Group thousands, round seconds to 0.5 and percentages to whole values. Keep game names as supplied and use Chinese for interface text. Use hairline borders and surface tones for depth. Use the four game icons for damage types. Respect reduced motion with static interactions and effects.

## Layout

| Surface | Layout |
| --- | --- |
| Home | 48 px product bar. Center one column up to 720 px with 24 px gutters, or 16 px on phone. Show the BR field and recent battles. |
| Replay, at least 1100 px | 48 px bar, 280 px roster, flexible replay and 340 px event column. The feed uses up to 260 px. The timeline spans the full width and grows when extra lanes open. |
| Replay, 760–1099 px | 56 px roster rail with ship icons and log dots. Show names on hover and keyboard focus. Stack the feed below the canvas and span the timeline across both columns. |
| Replay, below 760 px | 44 px top bar with statistics in the menu and upload in reach. Put the replay above controls and a 64 px plot with damage curves and kill ticks. Put roster, events and compare in a bottom sheet with peek, half and full heights. |
| Empty battle | Keep the battle shell. Replace the canvas with upload guidance and coverage. Use one column on phone. |
| Pilot | Use the 420 px right drawer, expandable to the full body. On phone open a full-width page under the top bar and restore focus on dismiss. |
| Compare | Use the roster's Compare tab or expand the table to the full body. On phone show the pilot and one metric at a time and allow metric navigation. |
| Sides | Open from the top bar. Use a panel up to 960 px, one column per side and a final drop target. Stack columns on phone. |
| Kills | Use the roster's Kills tab. Selecting a row seeks the replay to that kill. |

## Components

- **ReplayCanvas** — use ship icons for nodes, with portraits in the hover card and selected label. Put effect lines beneath nodes and use quantiles within each effect type for visual scale. Use the compact node variant below 420 px canvas height. Place the viewer's side left, distribute three or more sides around the canvas and put unassigned pilots below the middle. Selecting a roster row locks the pilot and opens details. Solo focus is an explicit action.
- **Timeline** — show both damage curves, primary spans and kill ticks by default. Use separate lanes for repairs and point control, and offer kill ship icons as an option. Seeking, wheel or pinch zoom and Shift-drag range selection share the same cursor. Escape clears a range. The compact plot uses curves and kill ticks.
- **Roster and portraits** — put the portrait before the pilot name, then the ship icon next to its ship name. A solid log dot means uploaded and a hollow dot means absent. Use a strike-through and dim visuals for destroyed pilots. Show outlined source labels only for manual or log-evidence changes. Keep a same-size blank portrait when the character ID is absent. Use 20 px portraits in roster and compare rows, 16 px in feed and upload rows, 28 px for kill victims and 56 px in pilot details.
- **EventFeed** — default to merged actions, with raw and key-event variants. Label columns in each mode. Follow the replay cursor and mark its current row with the selection background and edge. Use time separators when the panel is narrow.
- **CompareTable** — use the table for many pilots, side-by-side for selected pilots and distribution to show a metric's spread. Group output, timing, incoming damage, logistics and point control. Keep checked pilots together and show a thin median reference for recorded values. Use an em dash with a reason for unavailable values and reserve zero for measured zeros.
- **SidesPanel** — one group per actual side. Use drag and drop and the keyboard-operable action menu. Apply manual character, manual corp or alliance, log evidence, battle report and ESI in that precedence. Share side assignments live. The viewer's choice of their own side belongs to the share URL.
- **UploadDock** — accept a drop throughout the battle page and a file picker from the top bar. Show queued, uploading, parsing and complete with clear status. Use indeterminate progress for parsing. Completed rows show pilot, event count, time range and language when known. Explain duplicates and failures.
- **PersonDrawer and FitTab** — use Data, Fit and Events tabs. Compare pyfa theory with logged active average and peak. Accept pasted EFT or offer a killmail import for a pilot with an eligible kill. Show a loading state for the first calculation and describe the base-attribute assumption for abyssal modules.
- **BottomSheet** — use Roster, Events and Compare tabs. Expose height through a draggable and keyboard-operable handle. Maintain tab labels, selected state and visible focus.

## Don'ts

- Keep side colors off text and keep numeric values in text color.
- Avoid colored pill labels, red and green good-or-bad judgments, scores and rank columns.
- Keep borders and surface tones as the only elevation cues. Avoid shadows and glows.
- Avoid slogan-style titles, taglines and decorative copy. Use labels that explain a control, state or metric.

## Pre-ship

- [ ] Capture J125990 real-data screens at 1280, 900 and 390 px in dark and light.
- [ ] Exercise reduced motion, keyboard navigation, focus return and 44 px phone targets.
- [ ] Check all colors against tokens and verify the added states in `/_gallery`.
- [ ] Verify live upload and side changes in two independent browser contexts.
