# Payment Desk · design system

A financial operations tool. The reviewer has to understand what happened to a payment and what is asked of them within seconds, and has to be able to trust every figure. The look is a web interpretation of a glass material system (an ambient environment, translucent layers above it, opaque surfaces for reading), in the spirit of a native desktop application. It is not Apple's rendering and does not claim to be.

## Principles

1. **Trust before decoration.** Every figure comes from desk state. A metric that does not exist says so ("Not measured", "Unavailable", "Not run") instead of showing zero.
2. **One question per screen.** The overview answers "what needs me". A payment opens on what it is, whether it is safe and what can be done; verification, evidence and agent activity are one tab away. Nothing is removed, it is placed.
3. **Provenance is visible.** Each statement says where it comes from: Source (quoted from the document, the line located by the server), Computed (by code), Agent (advisory), Human (a decision). An agent's claim is never styled as a verified fact.
4. **Glass for chrome, solid for reading.** Translucency belongs to navigation, summaries and floating panels. Tables, documents, evidence and long text sit on near-opaque surfaces.
5. **Not colour alone.** Status and exceptions always carry an icon or a label.
6. **Motion shows state.** Feedback, a change of place, or real activity. When the agents stop, the animation stops.

## Tokens (`web/src/styles/tokens.css`)

Components never hold a literal colour, size, radius, duration or curve. Colours are declared once with `light-dark()` and follow `color-scheme`, so the two appearances cannot drift apart.

| Group | Tokens |
|---|---|
| Environment | `--bg`, `--bg-2`, and three ambient fields `--amb-sapphire / emerald / silver` |
| Materials | `--glass-1` navigation, `--glass-2` content, `--surface` reading, `--glass-4` floating; `--glass-edge`, `--glass-hi`, `--glass-sheen`, `--glass-rim`; `--blur-1 / 2 / 4`; `--shadow-1 / 2 / float` |
| Fills | `--solid`, `--raised`, `--hover`, `--press`, `--select`, `--line`, `--line-2`, `--scrim` |
| Ink | `--ink`, `--ink-2`, `--ink-3` |
| Accent | `--accent` (primary action, selection, running), `--accent-strong`, `--accent-soft`, `--accent-line`, `--focus` |
| Status | `--good`, `--warn`, `--bad` and their `-soft` tints. Reserved for state |
| Agents | `--agent-extractor / validator / auditor / investigator / policy`. The only categorical palette |
| Type | The platform's system face first, Geist as the bundled fallback; `ui-monospace` then Geist Mono. Scale 11 / 12 / 13 / 14 / 15 / 17 / 20 / 24 / 28 / 32 / 40, with tracking that tightens as size grows |
| Space | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 |
| Radius | 6 / 8 / 10 / 14 / 18 / 24, pill |
| Motion | press 110, micro 130, hover 160, pop 200, page 240, dialog 260, layout 280, drawer 320 ms, ambient 40 s; `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-soft`, `--ease-drawer` |
| Layers | `--z-ambient` 0, content 1, bar 20, nav 30, drawer 40, dialog 50, tooltip 60 |

**Contrast is measured, not assumed.** Glass is translucent, so a token pair says little on its own. Text contrast was measured from rendered pixels on seven pages in both appearances at 1440 × 900: every visible text element met WCAG AA (4.5:1, or 3:1 for large type) against the surface actually behind it. Disabled controls are excluded.

## Materials (`web/src/styles/base.css`)

| Level | Used for | Character |
|---|---|---|
| 1 Ambient glass | Sidebar, phone tab bar | Most translucent, strongest blur, a deep shadow |
| 2 Content glass | Summary cards, stat bars, the list pane, agent nodes | More opaque, moderate blur, a rim of light on two corners |
| 3 Reading surface | Payment detail, tables, documents, the audit trail | Near-opaque, no blur behind text |
| 4 Floating glass | Dialog, drawers, sticky headers | Strongest separation, layered shadow |

Glass is a fill, a one-pixel edge, an inner top highlight and a soft shadow. `backdrop-filter` is added only where content really passes underneath (sidebar, top bar once scrolled, sticky headers, drawer, dialog); it is never nested, because a blurred surface inside another has nothing to blur, so tooltips and the phone "More" sheet are near-solid instead. The ambient background is three radial fields that fade to nothing before their box ends, over a base gradient, with a faint static grain against banding. Only `transform` moves.

Fallbacks: no `backdrop-filter` support raises opacity; `prefers-reduced-transparency` makes every material solid; `prefers-contrast: more` makes materials solid and strengthens edges and muted ink.

## Structure

- **Shell**: an ambient layer, a floating glass sidebar (244 px, collapsible to icons with tooltips, the choice is remembered) and the workspace. The sidebar groups places as Workspace, Intelligence and Assurance; one selection capsule travels between items. The top bar holds only global things: the real connection state (with a meter while documents are processing), appearance, add a document, run the demo. It has no material until content scrolls beneath it, and the page title moves into it once the large title has scrolled away.
- **Overview**: a status sentence, four figures, at most four payments that need a person, a quiet line per agent, five recent payments, and a folded first-visit guide.
- **Payments and Review Queue**: a glass list (search, a segmented status filter, sort, arrow keys) beside a reading surface. The payment has four tabs: Overview, Verification, Evidence, Activity.
- **Evidence**: any reference chip opens a floating inspector beside the work, with the value, where it comes from, the cited lines in context and whether code verified it. The Evidence tab sets the whole ledger beside the full document.
- **Payment Firewall**: a stat bar, the flagged payments, and for the selected one the exception in a sentence, the trusted record beside the incoming document with only the differing groups marked, each agent's finding folded to one line, and the decision.
- **Agent Activity**: two tabs. *Workspace* is the living agent workspace (below) with a one-sentence narrative and three figures. *Execution details* holds the concurrency figures, the execution timeline and the table of every loop.
- **Evidence & Audit**: evidence integrity across the desk, the audit trail on one rail (by time or by payment), and the scenario check.
- **Financial Stress Lab**: the scenario list beside the selected scenario; what was declared is set apart from what happened.

Cards are not the default container. Inside a reading surface, sections are separated by space and a hairline, never by another box.

## The living agent workspace (`web/src/components/LivingWorkspace.tsx`)

One SVG composition: a document, five agents, two code gates, nine connections. The positions never change, so a mental model forms; what moves, moves inside that structure.

- **Agents are glass, gates are plates.** An agent is a translucent sphere with light inside, a rim that catches light on two sides, one specular highlight and a glyph. The two deterministic stages are flat geometric plates with a function mark. The difference is the point: judgement against rule.
- **Each agent has one colour and one way of moving**, used only while its loop is running: the Extractor's fast satellite and the scan line on the document; the Validator's two marks closing on each other; the Auditor's sweeping arc; the Investigator's three evidence points orbiting inward; the Policy agent's two slow counter-rotating rings.
- **State is read, never staged.** `sceneOf(case, at)` is a pure function of the run records (start, finish, status, retry) and the case. It gives each agent one of waiting, running, retrying, done, failed, skipped. A working agent leans a few units toward what it reads and returns when done. A failed agent keeps a red rim and a cross; a skipped one stays visible but dim and says why.
- **Handoffs.** A capsule in the sender's colour travels a connection once, at the moment that connection becomes travelled (the receiving loop started, or a result reached a gate). Transitions that already happened are never replayed as new ones, and switching payment clears them. In the whole-inbox view no capsules are drawn; connections flow while the agent they feed is running.
- **The conditional route** to the Investigator is dotted until an exception really triggers it, then solid in the Investigator's colour, and the direct route fades.
- **The decision** arrives at the Enforce plate: it takes the outcome's tone, one ring expands once, and the disposition is written beneath. No celebration.
- **Live, recorded, replay.** A running payment is followed live. A finished one rests in its recorded final state, and can be replayed: a clock runs over the stored timestamps, scaled uniformly to 8 s, 16 s or real time, with pause and seek. Replay is labelled, calls nothing and changes nothing.
- **Without motion** the same picture holds: every state has a text label and a badge, each agent is a focusable button with an accessible name, and reduced motion removes the lean and the capsules while states still change.

## The interactive showcase (`web/src/views/Showcase.tsx`)

The guided demo is a view of the same application, not a presentation layered on it: the shell, the materials and the living workspace are the ones used everywhere else.

- **One idea per screen, one next action.** An opening with the statement, the five agents and the mode this server runs in; then one scenario at a time; then a summary. The primary button is always the next step.
- **The outcome sits beside the agents.** On a wide screen the stage and the verdict share a row, so the decision and how it was reached are read together. On a phone the stage is tall, so the verdict comes first.
- **The mode is always on screen.** A tag and one line in the header of every showcase screen: *Live AI*, *Scripted demo* or *Recorded execution*. They are never mixed and never switch by themselves.
- **The cross-check moment.** When a challenge is on record, the comparison gate takes the warning tone and the two values that do not agree appear above it, in the challenge's own words. It is a reading of state, so it is there in replay and without motion too.
- **Replay is labelled.** A scripted run finishes in a fraction of a second, so it is played back once from its own timestamps, marked *Replay*, with a line saying when the decision was really made. With reduced motion nothing plays by itself.
- **Results are statuses, not celebrations.** Confirmed, unexpected, failed, not executed: an icon and a label each. A failure shows the provider's own error text and what can be done.

## Original documents (`web/src/components/PdfView.tsx`, `AddDocument.tsx`)

- **A page is paper.** A PDF page keeps its own white in both appearances (`--doc-paper`); the interface around it changes, the document does not.
- **One marker.** The cited line is covered by a translucent marker (`--doc-hl`, `--doc-hl-edge`) placed from the box the parser measured. It is the only colour introduced for documents. No box, no marker: a sentence says why.
- **The drawer widens for a page** (`--drawer-w-wide`) and the intake dialog is wider than other sheets (`--sheet-w-wide`), because a page has to be legible.
- **Intake is a queue.** Each file is a row that states what it is and what happened to it, in the same status vocabulary as payments. Refusals are sentences in the row, not toasts.
- **On a phone** the queue row stacks (status under the name), the page fits the width and zoom scrolls inside its frame.

## Motion

| What | How | Why |
|---|---|---|
| Sidebar selection, segmented control, tabs | One indicator moves to the new item (`transform`, 280 ms) | A change of place |
| Page change, appearance change | Cross-fade through the View Transitions API where it exists; the new page also rises 8 px | Preventing a jarring change; the shell is identical in both frames so only content is seen to move |
| Drawer | Slides in from the right and leaves the same way (CSS transition, so it can be reversed mid-way) | Spatial consistency |
| Dialog | Fades and scales from 0.97 with `@starting-style` and a discrete exit | State change |
| Buttons | Fill and edge brighten on hover (160 ms), `scale(0.98)` on press (110 ms) | Feedback |
| Interactive glass | A faint reflection follows the pointer (one delegated listener, one frame per move) | Feedback on what is pressable |
| Running agent | The node's dot breathes and the connection feeding it flows; both stop when the loop ends | Real activity |
| Changed figure | The new value settles in once; no count-up through values that never existed | State change |
| Evidence marker on a PDF page | Fades in and widens slightly once when the page is ready (280 ms); under reduced motion it is simply there | State: this is the line the figure came from |
| Ambient light | Three fields drift over 34 to 48 s. Paused while the tab is hidden; off under reduced motion; can be switched off in Settings | Depth. This is the one decorative loop, kept at the edge of perception and under the person's control |

Keyboard-driven changes skip entrance motion. `prefers-reduced-motion` keeps colour and opacity changes and drops movement.

## States

Loading is the shape of the content, not a spinner. Empty states say why they are empty and what to do. Errors are inline, next to what failed, and long technical text is cut to its start with the rest one press away. A blocked payment has no approve button. A button that is working keeps its width and shows a spinner in place of its icon.

## Responsive

Tested for horizontal overflow on every route at 390, 768, 900, 1024, 1280, 1440 and 1920 px wide. Below 900 px the sidebar becomes a floating tab bar with the four everyday places and a "More" sheet for the rest; split views become a list and then a detail screen with a back button; the workflow graph stacks; drawers become bottom sheets with a scrim; the summary cards regroup.

## Accessibility

Semantic landmarks, one `h1` per page, visible focus rings, labelled icon buttons, `role="tablist"` with arrow keys, a native `<dialog>`, drawers that close on Escape and are `inert` when closed (focus moves in and back only when opened from the keyboard, so a pointer user's place is not stolen), `role="switch"`, live regions for counts and connection state.
