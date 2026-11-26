# Payment Desk · design system

A financial operations tool. The reviewer has to understand what happened to a payment and what is asked of them within seconds, and has to be able to trust every figure. Design serves that: precision, restraint, and nothing on screen that is not real.

## Principles

1. **Trust before decoration.** Every figure comes from desk state. A metric that does not exist yet says so ("No usage yet", "n/a") instead of showing a placeholder number.
2. **Provenance is visible.** Each statement is labelled with where it comes from: Source (quoted from the document, the line located by the server), Computed (by code), Agent (an interpretation), Human (a decision). An agent's claim is never styled as a verified fact; a value without a located source is marked.
3. **Reason before log.** A payment opens on the decision and why. The agents' work follows, then the source document; the raw agent log is folded away.
4. **Not colour alone.** Status and exceptions always carry an icon and a label.
5. **Motion shows state.** It is used for feedback, a state change, or real activity. When the agents stop, the animation stops.

## Tokens (`web/src/styles/tokens.css`)

Components never hold a literal colour, size, radius, duration or curve. Colours are declared once with `light-dark()` and follow `color-scheme`, so the two themes cannot drift apart.

| Group | Tokens |
|---|---|
| Surfaces | `--bg` canvas, `--bg-2` navigation, `--surface` panels, `--raised` insets, `--hover`, `--line`, `--line-2` |
| Ink | `--ink`, `--ink-2`, `--ink-3` (all at or above 4.5:1 on every surface they sit on) |
| Accent | `--accent` (primary action, selection, running), `--accent-soft`, `--accent-line` |
| Status | `--good`, `--warn`, `--bad` and their `-soft` backgrounds. Reserved for state |
| Agents | `--agent-extractor / validator / auditor / investigator / policy`. The only categorical palette |
| Type | Geist and Geist Mono, self-hosted. Fixed rem scale 11 / 12 / 13 / 14 / 16 / 20 / 28 |
| Space | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 |
| Radius | 6 / 8 / 10 / 12 |
| Motion | `--d-hover` 120 ms, `--d-press` 140 ms, `--d-pop` 180 ms, `--d-panel` 220 ms, `--d-layout` 280 ms; `--ease-out` cubic-bezier(0.23, 1, 0.32, 1) |

**Dark** is a cool near-black canvas (#0b0d10) with slightly lighter panels. **Light** is not an inversion: a cool grey canvas (#f4f5f7) with near-white panels, a darker cobalt accent (#2b59c9) and darker status inks so text keeps its contrast. Neither theme uses pure black or pure white.

The agent palette was run through a validator for lightness band, chroma, colour-vision separation (worst adjacent pair ΔE 10.4 to 10.7 under protan and deutan simulation) and 3:1 contrast against both panel surfaces.

Typography: body 13 px, tabular numerals everywhere, Geist Mono only for identifiers, IBANs, timestamps, XML and the source document. Amounts are sans, weight 600, with the currency as a small muted suffix so the number reads first.

## Structure

- **Navigation.** Six destinations, each a real view. Collapsible to icons; on phones it becomes a tab bar. The review-queue badge and the "agents running" dot are live.
- **Command bar.** Page title, real system status (event-stream state backed by a heartbeat, Mozaik runtime participants, processing progress), theme, Add document, Run demo scenarios. One primary button.
- **Financial summary.** Eight figures in one hairline-divided strip, not eight cards: processed, approved automatically, awaiting review, blocked, blocked payment exposure, duplicates and beneficiary conflicts detected, daily budget, model usage. Exposure is listed per currency and never called savings. Most link to the view that explains them.
- **Payment list.** Two-line rows: vendor and amount, then status, the most severe exception, the invoice reference and the due date. Search, status filter, sort, ↑/↓.
- **Payment workspace.** Identity and amount; the verdict and only the actions the server allows (a blocked payment has no approve button; a changed beneficiary has a callback-reference form); the decision chain in three parts, never merged: what the Policy agent recommended, what the controls allow, what is in force; every firewall control with its status (pass, fail, review, unknown, not applicable), its rule id and its evidence chips; trusted record against incoming document with the differing IBAN groups marked; the Investigator's verified facts, conflicts, unknowns and steps; both agents' readings in one table; review history; the sandbox draft; the source document in a sticky rail. There are no confidence percentages anywhere: a control has a status and evidence, not a score.
- **Evidence inspector.** Every reference is a chip. Selecting one shows the ledger entry (category, source, value as written, value as normalised, or the calculation with its inputs) and marks the line in the document. A reference that does not resolve says "no evidence".
- **Agent activity.** One lane per agent, one bar per loop, sub-rows where loops overlap. Hover names the payment and the times; the focused payment's dependencies are drawn (Extractor to Validator and Auditor, both to the Investigator when there is an exception, then Policy) and in the one-payment view the parallel window is shaded and measured. Idle stretches are folded and labelled. Peak concurrency, agent time, wall time and their ratio are computed from the same events. A table repeats the data for keyboard and screen-reader users.

## Motion

| Where | What | Why |
|---|---|---|
| Buttons, source buttons | 0.97 scale on press, 120 ms colour | feedback |
| Rows, navigation, KPI links | background and border colour, 120 ms | feedback |
| Payment switch | 180 ms fade with a 3 px rise; skipped when the change came from the keyboard | prevents a jarring swap |
| KPI values | the new value settles in over 220 ms; no count-up through amounts that never existed | state change |
| Meters and progress | `scaleX`, 280 ms | state change |
| Timeline | running bars are translucent and grow with the clock; they turn solid when the loop finishes; lane dots pulse only while that agent runs | real activity |
| Agent surface | a faint dot grid; a slow light drifts across it only while agents are running | real activity |
| Dialog | 220 ms rise and fade | spatial |

Only `transform` and `opacity` animate. `prefers-reduced-motion` removes movement and keeps colour changes. Ambient loops pause when the tab is hidden; entrance animations are left alone so nothing can be stuck invisible. There is no ambient motion behind financial text.

## States

Initial load (skeleton in the shape of the overview), empty inbox, blocked (what blocks it and what would clear it), processing error (nothing approved, run again), scripted-model mode (a banner says the model is a test fixture), upload (drop, pick, paste, with size and type errors), active processing, settled, agent failure (the provider's message and "Run this document again"), partial failure (the failed step shows its error, the others keep their results), missing evidence ("no source", "quote not found"), lost server connection (banner, actions paused, status shown as unknown), no search results (with a clear-filters action), no model key.

## Responsive

Designed at 1280, 1440, 1728 and 1920. The workspace uses a container query: from 800 px of its own width the source document sits beside the details. Below 900 px the navigation is a tab bar, the list and the workspace are separate screens with a back link, and tables stack. No view scrolls horizontally.
