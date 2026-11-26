# Payment Desk · design notes

An operations tool for an accounts-payable reviewer. The design serves the task: find the cases that need a person, see why, act, move on. Brand lives in precision, not decoration.

## Foundations

- **Type:** one family, Geist (variable), self-hosted so the app works offline. Geist Mono for identifiers, IBANs, XML and the source document. Fixed rem scale at a 1.2 ratio: 12 / 13 / 14 / 16 / 20 / 28. Body 14px. Tabular numerals everywhere (`font-variant-numeric: tabular-nums`). Tracking only on large numbers (−0.025em) and headings (−0.01em).
- **Color:** neutral warm-grey surfaces, one accent (cobalt) for the primary action, selection and the running state. Status colors are reserved: good / warn / bad, always paired with an icon or a label, never color alone. The four agents own the only categorical palette; it was validated for lightness band, chroma and colour-vision separation in both themes.
- **Themes:** both are first-class. Dark is the default for long desk sessions; light follows `prefers-color-scheme` or the toggle. Tokens are redefined per theme in `web/src/styles.css`; components never hold a literal colour.
- **Surfaces:** hairlines over cards. Panels have a 1px line and a 12px radius; no shadows except on the floating tooltip and the dialog. The chrome is translucent with a solid fallback under `prefers-reduced-transparency`.
- **Browser surfaces are themed:** selection, caret, scrollbar colour, focus ring, form controls.

## Structure

1. **Chrome:** identity, model status, live connection, theme, the two actions (add a document, process the inbox).
2. **Ledger strip:** the five numbers a reviewer glances at, in one row with hairline dividers, no cards.
3. **Cases:** grouped by what they need (Processing, Needs approval, Approved, Rejected, Failed, Not a payment). A warning glyph marks cases where the bank details do not match the vendor master. ↑/↓ moves the selection.
4. **Agents on one clock:** the proof of concurrency. One lane per agent, one bar per loop, sub-rows for loops that overlap. Hover names the case, click opens it; the selected case's bars stay bright and the rest dim.
5. **Case:** the verdict strip comes first (what the desk decided, why, and the approve/reject action when it is the reviewer's call), then the four agents' work side by side, the SEPA draft, the source document with cited lines marked in the gutter, and the agent log.

## Motion

Motion exists only to show state or causality, 120–260 ms, exponential ease-out.

- Pressing anything scales it to 0.97 on `:active`.
- Switching cases crossfades with a 3px blur so two states never overlap visibly.
- The SEPA draft appears with a short rise when a payment is approved.
- Running chips pulse; the timeline's "now" line and running bars move with the clock.
- The dialog materialises (blur + scale) from the trigger's side of the screen.
- `prefers-reduced-motion` collapses every transition to an instant change and stops the pulse.

## States

Every step has pending, running (skeleton), done and error. The app without a key says so and disables the actions. An empty inbox explains what will happen. A document that is not a payment says why nothing is due. A provider failure shows the provider's message on the case instead of crashing.
