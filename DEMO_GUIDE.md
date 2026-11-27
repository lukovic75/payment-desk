# Payment Desk · demo guide

A ten-minute walkthrough for someone who has never seen the application.

## What Payment Desk does

It decides whether an invoice may be paid, and shows why. Five AI agents on Mozaik read each document, check it against trusted records, read it a second time independently and investigate what does not agree. Controls written in code then decide: eligible for approval, held for a person, or blocked.

It does not trust what one AI reads. That is the product.

## Why the problem matters

A finance team has to review every invoice, verify the beneficiary account, catch duplicates and stop incorrect amounts, usually under time pressure. A changed bank account in a plausible email, or the same invoice sent twice, is paid because nobody had time to compare it with the records.

## Run it

Requirements: Node.js 20.19 or newer in the 20 line, or 22.12 or newer (22 or newer for the browser checks). macOS or Linux shell; on Windows use WSL.

```bash
npm ci
npm run demo
```

Open http://localhost:8799 and press **Start demo**. No API key, no account, no cost.

`npm run demo` builds the interface and starts the **scripted demo**: the real Mozaik runtime, the real agent loops, evidence checks, controls and enforcement, with **predefined model responses**. The interface says so on every screen. It shows the architecture and the workflow; it does not show how well a language model reads an invoice.

### With live models

```bash
cp .env.example .env     # set ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:5173 and press **Start demo**. The header then says **Live AI**. Each scenario makes five or six model calls on your provider account. If the provider refuses a call (no credit, a bad key), the scenario is shown as not finished, the application says why and what to do, and nothing is replaced by scripted output. The mode changes only when you restart the server with the other command.

### The recorded run

On the opening screen, **Watch the recorded execution** replays a stored run with live models (Haiku 4.5 and Sonnet 5.5, 26 November 2026, 13:04 UTC) for the same documents: real agent outputs, real timings, real token counts. It is an earlier version of the code, two of the five scenarios did not finish in that run because the provider account ran out of credit, and it is shown that way. Replay calls no model and decides nothing.

## The four scenarios

Each is one synthetic document from `server/data/documents/`. Press **Next** to run the following one.

| | Scenario | Document | Outcome the controls enforce | What it shows |
|---|---|---|---|---|
| 1 | Legitimate invoice | `INV-2026-1041` | Eligible: approved automatically, sandbox draft | Valid payments go through; the Investigator is not called |
| 2 | Changed account | `INV-ES-55820` | Blocked | The IBAN on the invoice is not the one in the vendor master; a valid checksum does not show who owns an account |
| 3 | Agents disagree | `INV-2026-1049` | Held for a person | The cover text asks for 1,980.00, the invoice total is 1,890.00; the Auditor reports both, code records a cross-check, the Investigator is called. Then, optionally, resolve it with a vendor confirmation |
| 4 | Duplicate payment | `INV-7701-rappel` | Blocked | Same vendor and invoice number as payment `H-0001` in the payment history |
| | Prompt injection (optional) | `INV-ADR-0101` | Held for a person | Text in the document telling the AI to approve is treated as content; no permission or rule changes |

Expected outcomes are in `server/data/scenarios.json`, which no agent sees. A scenario is marked *Expected outcome confirmed* only when the outcome the controls enforced is the one in that file; otherwise it says *Unexpected outcome* or *Execution failure*.

In scripted mode a run takes about a quarter of a second, so it is played back once from its own recorded timestamps, labelled **Replay**. The outcome is already decided and shown beside it.

## What to inspect

- **Original financial evidence.** In *Check it at the source*, select any `line N` or record reference. The evidence drawer opens with the cited lines of the document or the trusted record.
- **Cross-agent challenges.** In scenario 3, **Inspect agent challenge** opens the cross-check: both amounts, the line each comes from, who raised it and its status.
- **Actual Mozaik execution.** *How the agents worked* shows the recorded overlap of the Validator and the Auditor and every agent loop with its start and finish. **View execution proof** opens Agent Activity → Execution details: the timeline, every loop and the Mozaik event counts.
- **Deterministic financial controls.** **Open the payment** → *Verification*. A blocked payment has no approve action. Approving scenario 3 is refused as it stands; citing the line that states the amount is not enough, because that shows the amount is in the document, not that it is the amount owed.
- **Resolution with independent evidence.** In scenario 3, under *Resolve it with independent evidence*, enter `VC-2026-1126-03`: refused, the record is unverified. Enter `VC-2026-1126-02`: refused, it belongs to another vendor. Enter `VC-2026-1126-01` and press **Verify payable amount**: the cross-check becomes *matched to a trusted record*, **Approve payment** appears, and approving creates a sandbox draft that cites the confirmation. The scenario's result does not change: it stays what the workflow decided.
- **Final disposition.** The summary lists, per scenario, what was expected and what the controls enforced.
- **The original document.** Scenario 3 runs on a two-page PDF. Select `p. 1, line 5` or `p. 2, line 12` under *Check it at the source*: the page opens with the cited line marked. The cover note on page one asks for 1,980.00; the invoice on page two totals 1,890.00.
- **Your own upload.** **Document** in the top bar → *Try a sample invoice* → **Process document**. The queue shows what was read before anything runs. One document opens as a payment once it is processing; with several, the dialog stays and each row gets **Open**. The payment's *Evidence* tab has the original PDF beside the ledger. Drop any other PDF: it is parsed and previewed, and the scripted demo says it needs live AI to interpret it.

## Other checks

```bash
npm test                 # 142 tests on the real Mozaik runtime with a scripted model
npm run lab              # 12 stress scenarios, deterministic path
npm run test:browser     # 28 browser checks of the showcase and PDF intake (after npm run build; needs Node 22+ and a Chrome or Chromium)
```

## Limits to know

- **Synthetic data only.** Vendors, accounts, invoices and the payment history are invented. No customer data, no real accounts.
- **Sandbox payment drafts.** An approval creates a JSON draft marked sandbox. No money moves and nothing reaches a bank.
- **Text and text-layer PDF.** A PDF up to 2 MB and 10 pages is parsed on this machine. Scanned PDFs and images are refused: there is no OCR. The scripted demo interprets only its registered synthetic documents.
- **One demo reviewer.** There is no sign-in; human actions are recorded as "Demo reviewer".
- **One sandbox workspace.** The scenario payments are ordinary demo documents on the desk. Starting the demo replaces the demo documents; documents you add yourself are kept.
- **Trusted records are fixtures.** The desk matches a callback reference to a record in `server/data/callbacks.json` and a vendor confirmation to one in `server/data/confirmations.json`. It does not call or write to anyone.
- **Local only.** The server answers on this machine only and has no sign-in. It is not meant to be hosted.
- **Live models are not verified on the current version.** The provider account had no credit when this version was finished. The scripted demo and all automated checks pass; the live Stress Lab and the single-agent benchmark have never completed. See `DEMO_READINESS.md` and `FINAL_RELEASE_REPORT.md`. Architecture, claim by claim: `ARCHITECTURE_PROOF.md`. Likely questions: `JUDGE_QA.md`.
