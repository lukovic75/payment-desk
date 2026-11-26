# Payment Desk

A team of four Mozaik agents that turns a messy accounts-payable inbox into reviewed SEPA payment drafts. Every number on screen links to the line of the document it came from, agents check each other's work, and a human approves anything the policy does not allow to go out on its own.

Built for the JigJoy Black Friday AI Hackathon (track: Agents in Finance), 26-27 November 2026.

## What it does

Nine documents land in the inbox: invoices in five languages, a payment reminder that duplicates an invoice, an invoice whose "new bank details" differ from the vendor master (the classic invoice-fraud pattern), an invoice from an unknown vendor, and a newsletter. Press **Process inbox** and:

1. **Extractor** reads all nine documents at the same time and pulls out creditor, amount, IBAN, BIC, due date and reference, each with a verbatim quote as evidence.
2. **Validator** and **Auditor** then run **in parallel on every extraction**:
   - Validator looks the creditor up in the vendor master, checks the IBAN checksum (ISO 13616) and whether it matches the account on file, and searches the inbox for duplicates.
   - Auditor re-reads the original document and verifies every extracted value against it. It is an independent second pair of eyes on the Extractor.
3. **Policy** routes each payment: auto-approve, send to a human, or reject. Its reasons cite the policy rule or the tool result.
4. A **deterministic policy guard** recomputes the floor from shared state. The agent may be stricter than the guard, never looser; overrides are shown in the UI.
5. Payments within policy get a **SEPA pain.001.001.09** credit transfer draft immediately. The rest wait in **Needs approval** for a person, who sees the extraction, the validation issues, the audit result and the source document, and approves or rejects with a note.

A typical run settles all nine documents in about 20 seconds: two auto-approved, six waiting for a human, one newsletter correctly ignored.

## Run it

Requirements: Node.js 20.6 or newer, and an API key for Anthropic (default), OpenAI or Gemini.

```bash
npm install
cp .env.example .env     # then put your key in .env
npm run dev              # API on :8787, UI on http://localhost:5173
```

Open http://localhost:5173 and press **Process inbox**.

Headless, without the UI:

```bash
npm run cli
```

Other commands: `npm run typecheck`, `npm run build` (static UI into `web/dist`, served by `npm start`).

Models default to `claude-haiku-4-5` for Extractor and Policy and `claude-sonnet-5-5` for Validator and Auditor. Override with `FAST_MODEL` / `CAREFUL_MODEL` in `.env`; any model name Mozaik supports works (e.g. `gpt-5.5`). A full run costs roughly 200k tokens.

Optional: pair the machine with Mozaik Cloud (`npx @mozaik-ai/cloud-sdk pair`) and every loop, tool call and agent state shows up live at app.jigjoy.ai. Nothing in the app depends on it.

## How the agents run concurrently

Everything is one Mozaik runtime (`@mozaik-ai/core` 6.0.0) with one typed shared state (`DeskState`: cases, documents, vendor master, policy, token usage). There is no orchestrator calling agents in sequence. Agents react to events:

```
inbox ──▶ Extractor            one runLoop per document, all started in the same tick
              │ extraction.completed            (sent from the submit_extraction tool)
              ├──▶ Validator  ┐  both match the same event, so both loops start
              └──▶ Auditor    ┘  at once and run side by side
                    │ validation.completed + audit.completed
                    ▼
                 Policy        its specification fires only when the case has
                    │          BOTH results in shared state
                    ▼
            guard → auto | human | reject → SEPA draft
```

- `server/desk.ts` is the whole runtime: state, tools, agents, situation handlers.
- Each loop gets a **fresh `ModelContext`** (developer message + the case brief), so loops of the same agent never share or block on memory. Concurrency is real: with nine documents you get nine Extractor loops, then up to 16 Validator/Auditor loops, overlapping. The UI's **Agents on one clock** chart draws every loop as a bar on a shared time axis; overlap is the proof.
- Tools write to shared state and publish domain events with `sendEvent`. Situation specifications (`OnEvent`) decide who reacts. The Policy spec reads shared state to wait for both checks.
- A per-loop `InterceptionHandler` records inference, tool calls and the final answer on the case timeline, which streams to the UI over Server-Sent Events.
- Provider failures (missing key, quota) end the loop with a visible error on the case instead of crashing the process.

## Care with financial data

- **Synthetic data only.** Vendors, invoices, the policy and the debtor account are invented and live in `server/data/`. No real customers, accounts or money. IBANs are valid test numbers.
- **Every number has a source.** The Extractor must attach a verbatim quote per field; the server locates the quote in the document and the UI shows a `line N` badge that jumps to it. A field without a located quote is marked, not hidden.
- **Agents check agents.** The Auditor verifies the Extractor against the document; the Validator verifies against the vendor master; the deterministic guard verifies the Policy agent against the policy.
- **Not financial advice.** The SEPA draft is a file to review, it is never sent anywhere, and the UI says so.

## Project layout

```
server/
  desk.ts        Mozaik runtime: shared state, tools, four agents, situation handlers, policy guard
  index.ts       HTTP API + SSE (node:http, no framework)
  cli.ts         headless run that prints every agent step and a summary table
  sepa.ts        pain.001.001.09 draft builder
  domain.ts      shared types (also imported by the UI)
  data/          vendors.json, policy.json, documents/*.txt (synthetic)
web/
  src/App.tsx          layout, stats, run control, theme
  src/Timeline.tsx     agent loops on one clock (SVG)
  src/CaseDetail.tsx   extraction with evidence links, validation, audit, decision, approval, SEPA, source document
```

## Honest limitations

- State lives in memory; restarting the server clears the run. Fine for a demo, not for production.
- Documents are plain text. Real invoices would need OCR or PDF parsing in front of the Extractor.
- Vendor matching is a token-overlap heuristic on names. Good enough for the demo data, not a master-data product.
- The models are non-deterministic: wording changes between runs, and occasionally the Policy agent is stricter than the guard requires (for example rejecting the duplicate reminder instead of escalating it). The guard guarantees it is never looser.
