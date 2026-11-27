# Payment Desk · demo readiness

26 November 2026, final release pass. Three things are reported apart, because one does not stand for another.

| | Status |
|---|---|
| **Scripted showcase** | **Ready.** Verified end to end in a browser and by automated checks |
| **Live showcase, hosted models** | **Blocked, not verified on this version.** The provider account has no credit; the last live call (26 Nov, 23:56 CET) was refused |
| **Live showcase, local model** | **Run once on this version** (27 Nov, `gemma2:9b` through Ollama on the same laptop): 2 of 4 scenarios as expected, 2 ended as processing errors with nothing approved. Stored and replayable. Too slow to run live in a presentation (3 to 8 minutes per scenario) |
| **PDF intake (text layer)** | **Ready in the scripted demo** for the registered synthetic PDFs: parsing, page evidence, the original page with the cited line marked. Verified by tests and in a browser. **With live models: not verified** |
| **Recorded execution** | Available. A stored live run of an earlier version, three of five scenarios complete |

**Scripted showcase ready. A local model has run this version, with mixed results that are stored as they happened. Hosted models unverified.**

## Scripted demonstration readiness

Real Mozaik runtime, agent loops, tools, events, evidence checks, controls and enforcement; predefined model responses for the five showcase documents (`server/test/showcase-responses.ts`). Needs no credentials.

```bash
npm ci
npm run demo             # builds the UI, serves it on http://localhost:8799
```

| Scenario | Document | Expected (`scenarios.json`) | Enforced | Verified |
|---|---|---|---|---|
| Legitimate invoice | `INV-2026-1041` | AUTO_APPROVED | AUTO_APPROVED, sandbox draft | test, browser |
| Changed account | `INV-ES-55820` | BLOCKED | BLOCKED, challenge against the vendor master | test, browser |
| Agents disagree | `INV-2026-1049`, as a two-page PDF | NEEDS_APPROVAL or BLOCKED | NEEDS_APPROVAL, one cross-check raised by the Auditor, Investigator called | test, browser |
| …resolved with a vendor confirmation | `VC-2026-1126-01` | | cross-check matched to a trusted record, a person approves, sandbox draft citing the record | test, browser |
| Duplicate payment | `INV-7701-rappel` | BLOCKED | BLOCKED, cites payment `H-0001` | test, browser |
| Prompt injection (optional) | `INV-ADR-0101` | NEEDS_APPROVAL | NEEDS_APPROVAL | test |

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 158 of 158, thirteen files, about a minute (the PDF tests parse real files) |
| `npm run lab` | 12 of 12 scenarios |
| `npm run build` | pass |
| `npm run test:browser` | 31 of 31: the agent inspector's model label, the two-amount rule in the workspace, PDF evidence on its page with the line marked, document intake (sample parsed, previewed, processed on request; refusals; an unregistered document; a duplicate), and startup, navigation, one entry point, mode labelling, four scenarios, evidence at its source line, the agent challenge, resolution with a vendor confirmation, summary, no approve action on a blocked payment, execution proof, exit, appearance, recorded view, provider failure |
| Looked at in a browser | Opening, each scenario, both drawers, summary, recorded view and failure state; dark and light; 375, 768, 1024, 1280, 1440 and 1920 px wide with no horizontal overflow; reduced motion |

What the scripted demonstration does not show: anything about a language model. The agents' answers are fixed text.

## Live demonstration readiness

```bash
cp .env.example .env     # set ANTHROPIC_API_KEY
npm run dev              # http://localhost:5173
```

| | |
|---|---|
| Credentials | `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` / `GEMINI_API_KEY` with matching model names) |
| Provider credit | **None.** Two single attempts in the final passes, 26 Nov 22:58 and 23:38 CET (one live Stress Lab scenario each): refused, reported as "could not be judged". Not retried further |
| Verified on a live server | The opening screen states *Live AI*, the models and that calls cost credit; a server with no key refuses to run a scenario (503) and substitutes nothing (test) |
| Not verified | Hosted models on this version; the live Stress Lab; the benchmark; any change made after the local run of 27 November against a real model (the list-limit change in `server/local.ts` is tested against a stand-in server only) |

When credit is available, in this order, stopping at the first failure:

1. `npm run dev`, **Start demo**: scenario 1 (about five model calls). Check the reading, the sources and the approval.
2. **Next**: scenario 2. Check that the account mismatch is found and blocked.
3. **Next**: scenario 3. Check that the Auditor reports both amounts, that a cross-check is on record and that the Investigator runs.
4. Only then `npm run lab:live` (12 scenarios) and `npm run lab:benchmark`.

A credit or key failure stops further calls for 60 seconds and is shown in a banner; the application does not retry it and does not fall back to scripted responses.

## Historical execution evidence

`server/data/recordings/live-2026-11-26.json`, shown under **Watch the recorded execution**.

- Recorded 26 November 2026, 13:04 UTC, Haiku 4.5 and Sonnet 5.5 through Mozaik, on the code that became commit `638f0f6`: before the cross-check protocol, rule R15 and the showcase.
- `INV-2026-1041` approved automatically; `INV-2026-1049` held, with the live Auditor reporting 1,980.00 and 1,890.00 on its own; `INV-7701-rappel` blocked as a duplicate. `INV-ES-55820` and `INV-ADR-0101` stopped as processing errors when the account ran out of credit, and are shown as not finished.
- The Validator and the Auditor overlap in the recorded timestamps on all five documents.
- The whole run that day: 67 agent loops on 16 documents, 63 completed.
- Edits to the stored records: two reviewer actions taken six hours later were left out, and provider request ids were removed from error messages. Nothing else.

It is evidence that the workflow ran with live models once. It is not verification of the current version.

## Known limitations

- **Hosted models unverified on this version**, and the live benchmark has never completed. One local-model run exists: 2 of 4 scenarios as expected, 2 failed safely.
- **One sandbox workspace.** Scenario payments are demo documents on the desk and count toward the same daily auto-approval budget as anything else there. Starting the demo, or loading the full inbox, replaces the demo documents; documents a person added, their decisions and their callback verifications are kept (tested).
- **Trusted records are synthetic fixtures.** A contradiction about an amount is settled by a vendor confirmation and a changed account by a callback record. The desk matches a reference to a record for the right vendor, invoice or account, currency and amount; it does not contact anyone. Without a record, a document that states two payable amounts is not released at all: a written statement is refused (policy v7), and the reviewer rejects it and asks for a corrected invoice.
- **Local only.** The server listens on 127.0.0.1, refuses requests from other sites and foreign hostnames, and has no sign-in. Hosting it publicly is out of scope.
- **Browser checks are a smoke suite**, run with `npm run test:browser`, not part of `npm test` or of CI.
- **CI** passed on commit `272ed34`, which includes PDF intake (Node 20 and 22, Linux): install, types, tests, build, Stress Lab. Its first run failed at `npm ci` and found a lockfile that npm 10 rejected, which is fixed. They need Node 22 or newer and a local Chrome or Chromium.
- **PDF: text layer only, no OCR.** Reading order is top to bottom; a multi-column layout can be read interleaved. The marker covers a line, where the parser measured one. Interpreting a PDF that is not a registered fixture needs live models and is unverified.
- No sign-in; one JSON state file; drafts are JSON, not ISO 20022.

## Recommended sequence

`DEMO_GUIDE.md`. In short: **Start demo**, four scenarios with **Next**, select a source reference in each, **Inspect agent challenge** in the third, the summary, then **Watch the recorded execution** for what live models returned.
