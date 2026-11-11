---
name: flash-design
description: Brand rules for Flash, the vault's Electron desktop app (sidebar, Home, Session thread, skill map, badges). Use when designing, building, restyling, or reviewing any Flash screen or UI part, or when picking a Flash color, font, size, icon, or motion.
---

# Flash design

Flash is a calm tool: a quiet, precise app that gets out of the way while you learn for hours. Small color does the talking. It tells you which subject you are in and how urgent or how finished something is. What to press is ink. Everything else is grey.

The source is "Flash brand guideline v1, Calm tool" (26 Oct 2026), `.scratch/flash-brand/guideline/flash-brand-guideline.pdf`, built from `guideline.html` in the same folder by `build.py`. Its mockups are the visual target. Edison approved every row on 26 Oct 2026.

To change a color, font, size, rule, or component, use the brand-guideline skill's change flow.

Use the vault's words in screens and copy: subject, node, skill, check, review, session, record, plan, and can-do line.

## Design a screen

1. Find the screen's layout and its hard rule in [screens.md](screens.md).
2. Name the one next step. Give it the screen's only filled ink button. Every other action is a neutral button, a text button, or a row.
3. Give every color on the screen one job from the [color table](#color). Remove any color that is only decoration.
4. Build from the parts in [components.md](components.md) and the icons in [icons.js](icons.js). Take every value from [tokens.css](tokens.css). A raw hex value in a component is a bug.
5. Design every state. Each control needs hover, focus, disabled, and loading. Each screen needs light and night, with the sidebar full, folded, and hidden. Each action needs a keyboard shortcut, shown in its hover tip and in the command palette.
6. Write the copy by the [voice](#voice) rules.
7. Run the [checklist](#checklist). The screen is done when every line passes. Report each line as pass or fail.

The renderer moved to this theme on 27 Oct 2026. [migration.md](migration.md) maps each old Vault token to its new name, for older branches and the gaps the guideline leaves.

## Principles, in priority order

When two rules conflict, follow the one higher in this list.

1. **One next step.** A screen has at most one filled ink button.
2. **Color has a job.** Subject color says which subject. Coral, amber, and green say now, coming up, and passed. Actions are ink, so every color left on screen is a fact. A row carries at most one splash of color.
3. **Proof, not points.** Green and gold appear only where a check was passed. The app has no XP, leagues, levels, or confetti.
4. **Calm where you read.** Tutor replies sit on the white panel in the read color, at 15/25, at most 660px wide. Nothing glows, moves, or tints behind text you are reading.
5. **Never move what the learner is looking at.** A refresh that changes nothing repaints nothing. A new message never jumps the scroll position. Coming back to a screen returns you to where you were.

## Color

About 70% of a screen is background and surface, 20% ink, and 10% color. [tokens.css](tokens.css) holds every value. Night values sit under `[data-theme="night"]`.

| Token | Light | Night | Its one job |
|---|---|---|---|
| `color-bg` | #F4F6F8 | #1E1F22 | The frame behind the sidebar and panels |
| `color-side` | #ECEFF3 | #1A1B1E | The sidebar |
| `color-surface` | #FBFCFD | #25262A | The main panel, cards, composer, options, menus |
| `color-selected` | #E4E8EE | #2C2E33 | Hover, the current plan card, today's column |
| `color-bubble` | #E4E8EE | #2C2E33 | Your messages |
| `color-row-selected` | #FBFCFD | #25262A | The selected sidebar row: a white pill |
| `color-line` | #E1E5EA | #2E3035 | Hairlines. Never text. |
| `color-line-strong` | #DCE1E7 | #33353B | Card and input borders. Never text. |
| `color-ink` | #1F2328 | #E3E4E7 | Headings and labels |
| `color-ink-2` | #4B525C | #AEB2B9 | Secondary text |
| `color-ink-3` | #5E6570 | #959AA2 | Captions and placeholders. The lightest text allowed. |
| `color-read` | #2A2F36 | #D6D8DC | Tutor replies and notes |
| `color-action` | #1F2328 | #E3E4E7 | The one filled button, send once there is text, focus rings, the picked answer |
| `color-coral` | #C93A3F | #E28F92 | Now: due today, to repair. Text uses `color-coral-text` (#A82B31 light). |
| `color-amber` | #B45309 | #DDAE6F | Coming up: the up-next node, a deadline in one or two days, and the review icon. Text uses `color-amber-text` (#924207 light). |
| `color-green` | #1F7A55 | #78BE9C | Passed: a checked skill, the right answer, filled bars |
| `color-gold` | #E2B23A | #E8BE4F | Solid. Shapes only, with the `color-gold-edge` rim and a `color-gold-ink` icon. |
| `color-untaught` | #8A929D | #737882 | The dashed outline of a Not yet node, and empty radios |

Subject colors come from `theme:` in each subject's `record.md`: code #4A6FA5, math #267C88, circuits #8E4FA0, literature #B5505F, design #66762E, calm #7A746A (night values in tokens.css). Show a subject color only as its icon on a tinted tile, a deadline chip, a progress bar, the line under a tab, or the 9% wash at the top of the recommended card or a subject card. Subject color never colors text.

A wrong answer stays neutral. The right option turns green and the explanation sits under it.

## Type

Two faces, both SIL OFL and bundled with the app: Figtree for everything you read and tap, Geist Mono for code, math lines, and key chips. Use the `--type-*` tokens. Chinese text falls back to the system's CJK font.

| Style | Token | Use |
|---|---|---|
| Greeting | `--type-greeting`, 700 36/42, tracking -2.5% | Home's greeting |
| Title | `--type-title`, 700 30/34 | A screen title |
| Heading | `--type-heading`, 700 21/28 | Card titles |
| Section | `--type-section`, 700 15/22 | Section heads |
| Reading | `--type-reading`, 400 15/25 | Tutor replies and notes |
| UI | `--type-ui`, 400 or 600 13/18 | Rows, buttons, inputs |
| Caption | `--type-caption`, 400 12/16 | Dates, counts, hints, in ink 3 |
| Code | `--type-code`, Mono 400 13.5/21 | Code blocks and math lines |
| Key | `--type-key`, Mono 500 11/14 | Key chips and option numbers |

Build hierarchy from size and weight: one heavy heading per region, small quiet rows under it. Use sentence case everywhere, tabular figures for counts, dates, and timers, and at most two weights in one region. Keep reading text at 60 to 75 characters a line.

## Layout and shape

- The window is one sidebar (240px, folds to 56px with ⌘\ or the sidebar button beside search, hides with ⇧⌘\ and comes back from the button in the left island; subjects grouped by course), a white panel inset 8px in the grey frame, and on Session a 290px plan panel. Regions are told apart by grey steps, not borders.
- Session's header is two floating islands: the subject switcher and the tabs (Session, Skill map, Progress) on the left, the status line and icon buttons on the right.
- Everything sits on a 4px grid of `--space-*` steps. The thread is 660px. Home and other content columns are 900px.
- Radii: cards 10, the composer and islands 12, options and tabs 8, chips 4, buttons 8. Buttons are flat rounded squares, never pills or circles, with no gradient, lit edge, shadow or blur, and medium-weight labels (Edison, 11 Nov 2026: pills read as playful, raised buttons as "too 3D"). A found or finished state is said in words ("Installed"), not with a check badge.
- Resting things get a 1px border and no shadow. Only floating things (menus, the command palette, popovers, Settings) get `--shadow-float`. The only gradients are the subject wash, the dock fade under the composer, and the header fade.

## Motion

Short and calm, and nothing bounces. Every duration uses `--ease-out`. With Reduce motion on, nothing animates.

- Hover and press: 120ms, fill color only. A pressed button scales to 98%.
- Screen change: 200ms cross-fade of the panel. The sidebar never moves.
- Sidebar fold: 200ms, width only. Labels fade in the first 80ms.
- New message: 180ms, fades in and rises 4px. A streaming reply grows in place.
- A disc turns Solid, or a goal seal lands: 320ms. These are the only motions tied to a reward.
- The selected tab is a pill that slides to the new tab. A screen change cross-fades the panel only; the sidebar, header islands, and plan panel never fade.
- Menus grow from where they were opened (150ms). Rows, cards, and icon buttons press to 98%.
- Map moves are camera flights with a cubic ease-out: zoom buttons 240ms, Fit 360ms, flying into a subject 460ms.
- A refresh that changes nothing repaints nothing: `put()` in `app.js` skips identical markup.

## Icons

28 drawn line icons in [icons.js](icons.js), with an SVG of each in `icons/`. They share a 24px grid with open strokes and round ends. Sizes: 18px in the sidebar and header islands, 15px in buttons and rows, 14px inside a 20px subject tile. Icons are ink 3 at rest and ink when selected. Review is amber and repair is coral, because they carry a fact. Draw a new icon on the same grid, check it at 14px beside its neighbors, and add it to icons.js.

## Badges

A badge is a record of something proved, drawn as a flat seal like the skill discs. The rarer the badge, the louder: Solid seals stack small by day, Recovered gets its own row, and Goal met sits on the subject's card and is the only badge that animates. The words come verbatim from `learn-status.py --rewards`. Show only badges the record has earned: no locked or greyed slots, no "3 more to go". Rewards off in `learn/me/preferences.md` hides badges, the streak, and the closing lines.

## Voice

Copy states a fact or names an action. Write "3 to repair" and "Paused at 17:26", in sentence case, with no praise words and no exclamation marks. A status line says what was saved and when. An empty state says what will appear and offers one action.

## Do and don't

| Do | Don't |
|---|---|
| One filled ink button per screen | A second filled button, or a colored primary button |
| Grey bubbles for your messages | A saturated fill behind your messages |
| A white pill for the selected sidebar row | A darker or colored selected row |
| One splash of color per row | A tag, a dot, and a colored icon on the same row |
| Status color only where the record put a fact | Coral or amber for decoration or emphasis |
| Flat discs and seals | Coins, foil, glows, or confetti |
| Shortcuts in hover tips, menus, and the palette | A key chip printed beside a button |
| Keep the scroll position on refresh | Jump the thread to the bottom while the learner reads |

## Open decisions

Ask Edison, or pick and say so in your report.

- **Name.** Flash is the working name, and Edison is fine with it for now (26 Oct 2026).
- **Code font.** Geist Mono is common in AI-built apps. Edison will decide later. Figtree stays.
- **Other surfaces.** This skill covers the Flash desktop app only. The Obsidian notes and the planned phone app keep Vault v0.2 until Edison decides.
- **Undrawn screens.** Skill map, Progress, All skills, Dashboard, and Settings have layouts in [screens.md](screens.md) but no mockup. Mark each as a judgment call until Edison has seen it.

## Checklist

- [ ] The screen has at most one filled ink button.
- [ ] Ink fills only the primary button, send once there is text, focus rings, and the picked answer.
- [ ] Coral, amber, green, and gold each carry their fact and nothing else.
- [ ] Subject color appears only as a tile, a chip, a bar, a tab underline, or the 9% card wash, and never as text.
- [ ] A row carries at most one splash of color, and no text sits on a gradient or glow.
- [ ] Only floating things have a shadow.
- [ ] Text uses Figtree or Geist Mono, the type tokens, sentence case, and tabular figures for numbers that change.
- [ ] Every value is a token, and `.scratch/flash-brand/guideline/check_contrast.py` reports 0 failing pairs.
- [ ] Every control has hover, focus, disabled, and loading states.
- [ ] Every action has a keyboard shortcut in its hover tip and in the command palette.
- [ ] The screen works in light and night, with the sidebar full, folded, and hidden.
- [ ] Nothing moves under the learner: a refresh keeps scroll, and a new message never jumps the thread.
- [ ] With Reduce motion on, nothing animates.
- [ ] Every empty state has a drawn icon, a title, one line on what will appear, and one action.
- [ ] The copy carries a fact or names an action, with no praise words and no exclamation marks.
