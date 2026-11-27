# Payment Desk

[![CI](https://github.com/lukovic75/payment-desk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lukovic75/payment-desk/actions/workflows/ci.yml)

**AI investigates. Code decides.**

Payment Desk is a multi-agent financial operations system that independently verifies invoices, investigates discrepancies, and enforces payment controls before approval. Agents read and investigate; deterministic code controls what can be authorised.

For accounts payable teams and finance managers: anyone who has to decide, invoice by invoice, whether a payment may go out. The workflow is receive, extract, verify, investigate, review, prepare an eligible payment draft.

It does not trust what one AI reads from an invoice. Five agents on Mozaik read each inbound payment request, check it against trusted records, read it a second time independently, investigate what does not add up and recommend what to do. Where two findings disagree, code records a structured challenge with the evidence for each side. A deterministic payment firewall then decides what is allowed. An agent can explain and can ask for something stricter. It cannot approve a payment the controls stop.

Built for the JigJoy Black Friday AI Hackathon, track *Agents in Finance*, 26-27 November 2026.

> Sandbox demonstration. All data is synthetic, no money moves, nothing is sent to a bank, and nothing here is financial advice.

## What to verify in three minutes

| Claim | In the app | In the code | Test or document |
|---|---|---|---|
| Real Mozaik orchestration | Agent activity → Execution details | [`server/desk.ts`](server/desk.ts) lines 73, 381, 874 to 898 | [`ARCHITECTURE_PROOF.md`](ARCHITECTURE_PROOF.md) |
| Independent Auditor | Showcase scenario 3, *Raised by* | `runAuditor`, [`server/desk.ts`](server/desk.ts#L680) | `intelligence.test.ts`: the Auditor's input holds nothing from the Extractor |
| Parallel execution | Any scenario → *How the agents worked* → *Execution record* | two handlers on one event, [`server/desk.ts`](server/desk.ts#L876) | `workflow.test.ts`: recorded intervals overlap |
| Cross-agent challenges | Scenario 3 → **Inspect agent challenge** | [`server/challenges.ts`](server/challenges.ts) | `intelligence.test.ts`, `resolution.test.ts` |
| Deterministic firewall | Scenario 2: blocked, no approve action | [`server/firewall.ts`](server/firewall.ts), `enforce` in [`server/desk.ts`](server/desk.ts#L796) | `workflow.test.ts`, `api.test.ts` |
| Source-backed figures | Select any `line N` reference, or `p. N, line M` on a PDF | [`server/integrity.ts`](server/integrity.ts) | `lab.test.ts`: each kind of broken evidence is caught |
| Evidence-backed resolution | Scenario 3 → *Resolve it with independent evidence* | `verify_amount` in [`server/desk.ts`](server/desk.ts#L1118) | `resolution.test.ts` |
| Reproducible showcase | `npm ci && npm run demo` | [`server/showcase.ts`](server/showcase.ts) | `showcase.test.ts`, `npm run test:browser` |
| PDF intake with page evidence | **Add documents** → a sample PDF; showcase scenario 3 runs on a two-page PDF | [`server/pdf.ts`](server/pdf.ts), [`server/pdf-worker.mjs`](server/pdf-worker.mjs) | `pdf.test.ts`, `npm run test:browser` |
| Real models with no key | `LOCAL_MODEL=gemma2:9b npm run demo:local`; a stored run of this version is in the showcase | [`server/local.ts`](server/local.ts) | `local.test.ts`; *Local inference* and *Live verification* below |
| Financial Stress Lab | Stress lab → Run all 12 | [`server/lab/`](server/lab) | `npm run lab`, `lab.test.ts` |
| Automated evidence | | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | 142 tests, 12 lab scenarios, 28 browser checks (the browser checks run locally, not in CI) |
| Real models on this version | Showcase opening → *Watch the recorded run of this version* (a local model, 27 Nov); *Watch the recorded execution* for the earlier hosted run | [`server/data/recordings/`](server/data/recordings) | Local model: 2 of 4 scenarios as expected, 2 failed safely. Hosted models: **not verified** (provider credit). See *Live verification* |

Walkthrough: [`DEMO_GUIDE.md`](DEMO_GUIDE.md). Likely questions: [`JUDGE_QA.md`](JUDGE_QA.md).

![Interactive showcase, scenario three: the Auditor found a second amount on its own, code recorded the cross-check, the Investigator was called and the payment is held for a person](docs/showcase.jpg)

![Overview: what is pending, approved and blocked, the payments that need a person, and what the agents are doing](docs/overview.jpg)

![Payment Firewall: the exception, and the trusted vendor record beside the incoming document with only the differing groups marked](docs/firewall.jpg)

## Try it in two minutes, without an API key

```bash
npm ci                   # Node 20.19+ or 22.12+; installs exactly what the lockfile says
npm run demo             # builds the UI and starts the scripted showcase on http://localhost:8799
```

Open http://localhost:8799 and press **Start demo**: four synthetic scenarios, one at a time, each through the real workflow. `DEMO_GUIDE.md` is the walkthrough.

This is the **scripted demo: real orchestration, predefined model responses**. The Mozaik runtime, the agent loops, the evidence checks, the controls and the enforcement run for real; the agents' answers are fixed text, and every screen says so. It shows the architecture and the workflow, not the quality of a language model.

```bash
npm test                 # 142 automated tests on the real Mozaik runtime with a scripted model, about a minute
npm run lab              # the 12 stress scenarios from the terminal, scripted model, a few seconds
npm run test:browser     # 28 browser checks of the showcase and PDF intake (needs Node 22+ and a local Chrome or Chromium)
```

With real models and no key, on your own machine (see *Local inference* below):

```bash
ollama pull gemma2:9b                      # once, about 5 GB
LOCAL_MODEL=gemma2:9b npm run demo:local   # http://localhost:8798, says Live local AI
```

With a model key, for live agents on a hosted provider:

```bash
cp .env.example .env     # set ANTHROPIC_API_KEY
npm run dev              # API on :8787, UI on http://localhost:5173
```

Open http://localhost:5173. **Start demo** then runs the same scenarios with live models and says *Live AI*; the full inbox of sixteen synthetic documents can be loaded from the overview or the demo summary; **Financial Stress Lab** runs twelve reproducible scenarios, on a deterministic path that needs no key or on live models. A provider refusal (no credit, a bad key) is shown as a failure with what to do about it. The application never switches from live to scripted by itself.

**Status of real models on this version.** A local model (`gemma2:9b`) ran the four showcase scenarios on this version on 27 November: two ended as expected, two failed safely, none ended looser than expected. That run is stored and replays in the app. Hosted models (Anthropic, Google, OpenAI) have **not** been run on this version: the provider account had no credit. Details in *Live verification, stated plainly* below.

## The problem

A finance team pays what arrives in the inbox. Two things go wrong, and both are expensive: an invoice is paid twice, or it is paid to an account that is not the vendor's because an email said "we changed banks". Manual review catches these when someone has time to compare every invoice with the vendor master, the payment history and the invoice's own arithmetic. At month end nobody has that time, and an approver looking at a clean-looking PDF has no way to see that the IBAN changed.

A language model alone does not fix this. It can read a document well, and it can also drop a digit, follow an instruction hidden in the text, or agree with itself. So this system gives the reading to agents and keeps the authority in code.

## What makes it different

- **Authority is in code, not in a prompt.** Every control is deterministic (`server/firewall.ts`). The stricter of the agent's recommendation and the controls is enforced, and the app always shows the three apart: recommended, allowed, in force.
- **Two independent readings.** The Auditor reads the document without seeing the Extractor's output; code compares them. A different amount, currency or account blocks the payment.
- **Evidence that is re-verified, not just cited.** Every value carries a reference to a line, a record or a calculation. A separate verifier (`server/integrity.ts`) goes back to the source and checks that the reference exists *and* that the source really supports the value. A payment whose critical evidence fails that check is blocked.
- **A stress lab that can fail.** Twelve adversarial scenarios declare their expected outcome before they run, in files no agent ever sees, and are judged on outcomes, controls, evidence and invariants. Each execution is isolated in its own process.
- **An honest benchmark.** A single-agent baseline runs the same scenarios with the same information and the same enforcement. Raw recommendations are counted apart from enforced decisions, unmeasured metrics are shown as unmeasured, and nothing is displayed before a benchmark has actually run.

## What the firewall detects

| | Scenario | What happens |
|---|---|---|
| A | **Changed beneficiary account**: the IBAN is valid but is not the one on file | Blocked. Both values are shown side by side with their sources. Only a callback reference recorded against that vendor and that IBAN clears it, and a person still approves. The vendor master is never changed. |
| B | **Duplicate**: same invoice already in the inbox, already paid, or the same file under another name | Blocked. Matching is on vendor plus invoice number, the payment history, and a content hash. The identical file is stopped at intake before any agent runs. A same-amount request with a different number is a *suspected* near-duplicate and goes to review. |
| C | **Arithmetic**: net plus tax is not the gross | Blocked. The inputs, the computed sum and the difference are shown, each input linked to its line. |
| D | **Policy limits**: per payment and cumulative per day | Needs a human approver. The limit shown is the one in `server/data/policy.json`. |
| E | **Unknown vendor or missing evidence**: creditor not in the master, no IBAN, a value whose quote is not in the document | Blocked. A missing IBAN is never filled in from the vendor master. |
| F | **Prompt injection**: text in the document telling the AI to approve | Treated as content, flagged, held for a person. The controls do not read agent opinions, so they hold even if an agent goes along with it. |
| G | **Possible split payment**: requests on one purchase order, each under the limit, over it together | Review. Stated as a possibility, with the sum shown. |
| | **Agents disagree** on amount, currency or IBAN | Blocked until the document is run again or corrected. |
| | **Evidence fails re-verification** | Blocked, whatever the agents recommend. |
| | **Zero or negative amount**: a zero invoice or a credit note | Blocked. It is not a payment, a person cannot approve it and no draft is made. |
| | **Conflicting amounts in one document** | Needs a person. It is settled with evidence that does not come from the document: a verified vendor confirmation on record for that vendor, invoice and currency. If the confirmation states the amount the payment would pay, the cross-check ends as *matched to a trusted record* and a person approves; if it states another amount, the payment is blocked. Without a record nothing releases it (R14, policy v7): a written statement or a line of the invoice cannot say which of the two amounts is owed, so the approval is refused and the reviewer rejects the payment and asks for a corrected invoice. |

And it approves what is valid: three of the sixteen demo documents are clean and go straight through.

## Architecture

```mermaid
flowchart LR
  D[Document<br/>untrusted text] -->|document.received| E[Extractor]
  D -. identical content hash .-> B0[[Blocked at intake]]
  E -->|extraction.completed| V[Validator]
  E -->|extraction.completed| A[Auditor<br/>reads the document itself]
  V -->|validation.completed| F{{Firewall<br/>compares readings, evaluates controls,<br/>re-verifies evidence}}
  A -->|audit.completed| F
  F -->|exception| I[Investigator]
  F -->|clean| P[Policy agent]
  I -->|investigation.completed| P
  P -->|recommendation| X{{Enforcement<br/>stricter of the two}}
  X --> O1[AUTO_APPROVED<br/>sandbox draft]
  X --> O2[NEEDS_APPROVAL<br/>a person decides]
  X --> O3[BLOCKED<br/>no approve button]
  X --> O4[PROCESSING_ERROR<br/>recoverable]
```

Rounded boxes are agents (models). Hexagons are code.

### How Mozaik is used

One Mozaik runtime (`@mozaik-ai/core` 6.0.0, `defineRuntime`) holds one typed shared state (`DeskState extends RuntimeState`). Eight participants are joined to it: five agents created with `createAgent`, plus the desk, the firewall and an observer created with `createHuman`. There is no orchestrator. Each participant has a `SituationHandler` whose `SituationSpecification` matches semantic events sent with `sendEvent`:

| Event | Who reacts |
|---|---|
| `document.received` | Extractor |
| `extraction.completed` | Validator **and** Auditor: both loops start from the same event and run concurrently |
| `validation.completed`, `audit.completed` | Firewall, once both results are in shared state |
| `investigation.requested` | Investigator (only on an exception) |
| `policy.requested`, `investigation.completed` | Policy agent |

Every agent turn is a `runLoop` with its own fresh `ModelContext`, so loops never share or block on memory: sixteen documents give fifteen Extractor loops at once, then up to twenty-eight Validator and Auditor loops overlapping. Each loop gets tools bound to its case and attempt, so an agent can only write its own slot of its own case, and a result from a superseded attempt is discarded. An `InterceptionHandler` records tool calls on the case timeline, closes the loop as soon as the result is in shared state, and stops a loop whose case has moved on before it spends another model call. The inference runner is wrapped for bounded retries on transient provider errors, per-loop token accounting, and turning a provider failure into a visible processing error instead of a crash.

### Agents

| Agent | Sees | Writes | Model |
|---|---|---|---|
| **Extractor** | the document | a reading: each value with a verbatim quote | fast |
| **Validator** | the Extractor's reading, trusted records via one lookup tool | findings citing evidence ids | fast |
| **Auditor** | the document only, not the Extractor's reading | its own reading, and places where the document contradicts itself | careful |
| **Investigator** | the case file: both readings, findings, controls, records, the document | verified facts, conflicting evidence, unknowns, verification steps, a suggested disposition. Never states fraud; says "confirmed discrepancy" or "suspected" | careful |
| **Policy** | the controls, the investigation, the policy rules | a recommended disposition with the rules it rests on | fast |

Models default to `claude-haiku-4-5` (fast) and `claude-sonnet-5-5` (careful); override with `FAST_MODEL` / `CAREFUL_MODEL`.

### Cross-agent checks that change the outcome

Every disagreement is kept as a **challenge**: the claim, what was independently observed against it, the evidence for each side, what would settle it, and a status. Challenges are derived by code (`server/challenges.ts`), never written by a model, and are not erased when they are settled. They are passed to the Investigator and the Policy agent and shown under *Verification → Agent cross-checks*. `AGENT_INTELLIGENCE_REPORT.md` has the protocol.

- The Auditor reads the document without seeing the Extractor's output. Code compares the two readings field by field. A different amount, currency or IBAN blocks the payment (rule R13) and triggers the Investigator.
- The Validator reports what the trusted records say. The server computes the same checks itself and records any disagreement with the Validator's report; a disagreement sends the case to review.
- The Investigator receives both readings and the controls, and is called only when there is something to investigate. A payment over the limit with nothing else wrong does not spend an investigation.
- The Policy agent's recommendation is compared with what the controls allow. The stricter one is enforced.

**An example, from the synthetic document `INV-2026-1049`.** The cover text says "please pay EUR 1,980.00"; the invoice total is EUR 1,890.00. The Extractor reports the invoice total. The Auditor, which never sees the Extractor's result, reports that the document states both. Code turns that into one challenge:

| | |
|---|---|
| `id` | `CH:contradiction:gross:1`, raised by the Auditor |
| challenged | `1980.00`, line 7 of the document |
| observed | `1890.00`, line 23 of the document |
| required | Verify which amount is payable before approving |
| status | `requires_human_verification` |

The Investigator is called, the Policy agent is told, and the controls hold the payment (R14). How a challenge can end:

| Ends as | When | Is it verification? |
|---|---|---|
| `matched_to_record` | A trusted record held by the desk matches: a vendor confirmation for this vendor, invoice, currency and amount, or a callback record for a changed account | A match with an independent record |
| `confirmed_discrepancy` | A vendor confirmation states another amount than the payment would pay: blocked | The record is evidence against the payment |
| `accepted_by_reviewer` | A person approves on a written statement, for a discrepancy that is a matter of judgement. Not available when a document states two payable amounts: that needs a record | No |
| `unresolved` | The payment is rejected | |

Four things are kept apart: a value appearing in the document, a citation of the line that contains it, a reviewer saying it is right, and an independent record establishing what is payable. Only the last one settles a contradiction. The records are synthetic fixtures (`server/data/confirmations.json`, `callbacks.json`); the desk matches a record, it contacts nobody.

### Proof of execution

Every loop leaves a record on its case: execution id, agent, model, attempt, real start and finish timestamps, status, retries, tokens as reported by the provider, and the event that triggered it. **Agent activity** draws those records on one clock, so concurrency is overlap you can measure, and draws the dependencies of one payment (Extractor to Validator and Auditor, then the Investigator if called, then Policy). The same records are in every Stress Lab audit report. Model reasoning is not recorded or shown: only tool calls, structured findings and results.

![Agent activity: sixty-seven loops from one live run on a shared clock](docs/activity.jpg)

### Shared case state

`server/domain.ts` defines it. Per case: `id`, content `hash`, `version` (bumped on every write), `attempt` (bumped on reprocess), `stage`, one slot per agent (`extraction`, `validation`, `audit`, `investigation`, `decision`) each with status, timings, result and error, the firewall `controls`, the evidence `ledger`, the `integrity` report, `exposure`, the human `review` history, the payment `draft`, the agent `runs` and the `timeline`. Agent input is validated at runtime with zod schemas, which also generate the tool JSON Schemas. State is saved to `.desk-state.json` and restored on start; anything that was mid-flight at a restart becomes a recoverable processing error, never an approval.

## Payment Firewall

`server/firewall.ts` contains the controls. Nothing in that file calls a model.

- **Money** is parsed from text straight into integer minor units (`server/money.ts`) and never passes through a float. Arithmetic is exact, with no rounding and no tolerance.
- **IBAN**: normalisation, country length and the ISO 13616 mod-97 checksum. A valid checksum is reported as structurally valid and nothing more; ownership comes only from the vendor master or a recorded callback.
- **Read from the source**: an IBAN is taken character by character from the line the agent quoted, not from what the agent typed. If they differ, the ledger records what the model typed.
- **Duplicates**, **beneficiary comparison**, **arithmetic**, **per-payment and daily limits**, **split-payment grouping**, **instruction-like content**, **stated-amount consistency**, **agent agreement**, **stage completion**, **evidence integrity**.
- **Fail closed**: a failed, timed-out or invalid agent stage makes the case a `PROCESSING_ERROR`. Nothing is approved on an incomplete run.
- **Enforcement is synchronous**, so two decisions can never both see the same remaining daily budget. Approving twice is refused; reprocessing an approved payment is refused; re-sending an approved invoice is blocked as a duplicate.
- **Human actions are checked on the server**: a blocked payment cannot be approved through any button or API call; a draft exists only for an approved payment that still passes every blocking control.

The policy, with rule ids the controls cite, is `server/data/policy.json` and is shown in the app under Settings.

## Evidence Ledger and integrity verification

Every case carries a ledger of evidence entries in six categories: source document (line range, excerpt, value as written, value as normalised), trusted vendor record, historical payment, configured policy, deterministic calculation (method, inputs with their own references, result, rounding) and human verification. Controls, agent findings, investigation facts and draft fields reference ledger ids. In the UI every reference is a chip: selecting it shows the entry and highlights the line in the document.

A citation is not correct because it exists. `server/integrity.ts` re-verifies the ledger independently of the flags recorded when an agent submitted a value, and reports two things separately:

| | Question | Example of a failure |
|---|---|---|
| **Present** | Is there a reference, and does the thing it points at exist where it says? | No reference; a quote that is not at the stated line; a record that is not in the vendor master |
| **Correct** | Does that source really support the value after normalisation? | The quoted line does not contain the amount; the stored value does not follow from what was written; a calculation input that is not what its source holds |

Findings are classified as missing evidence, broken reference, unsupported claim, incorrect normalisation or untraceable calculation. Values that cannot be checked mechanically (a date written in words) are reported as such and never counted as correct. A critical finding adds a failing `evidence_integrity` control, which blocks the payment whatever the agents recommended.

![Verification of one payment: the failing controls and the investigation, with the evidence inspector open on a cited line of the document](docs/investigation.jpg)

## Financial Stress Lab

A workspace for proving reliability instead of asserting it. Twelve synthetic scenarios, each defined in `server/lab/scenarios.ts` with its problem, source documents, trusted records, policy, expected outcome per document, the controls that must fire, the evidence that must exist and verify, and the invariants that must hold. The expectations are never given to an agent; a test asserts that no agent context contains them.

![Financial Stress Lab: scenarios, what each declared before running, and the path it ran on](docs/stress-lab.jpg)

| | Scenario | Declared outcome |
|---|---|---|
| S01 | Legitimate invoice | Approved automatically, with a sandbox draft |
| S02 | Beneficiary manipulation | Blocked pending independent verification |
| S03 | Duplicate invoice under another file name | The original is authorised once; the copy is stopped at intake |
| S04 | Arithmetic discrepancy | Blocked, with the calculation and its inputs |
| S05 | Prompt injection | Held for a person; document instructions change no control |
| S06 | Unknown vendor | Blocked |
| S07 | Spending limit | Routed to a human approver, not blocked |
| S08 | Concurrent approvals against the daily budget | The cumulative limit holds; at least one request is held |
| S09 | Missing financial evidence | Blocked; the IBAN is not taken from another record |
| S10 | Agent disagreement *(fault injection)* | Blocked and investigated |
| S11 | Agent failure *(fault injection)* | Fail closed, no draft, and recoverable when the fault is removed |
| S12 | Related payment requests | Both held as a possible split payment |

**Isolation.** Every scenario execution is a separate worker process (`server/lab/worker.ts`) with its own Mozaik runtime and its own case state, and no persistence. The payment inbox, its approval totals and its saved state cannot be reached from there; tests assert that the inbox is byte-for-byte unchanged after a lab run.

**Two paths, kept apart everywhere.**

| | Deterministic path | Live path |
|---|---|---|
| What runs | The real Mozaik workflow: loops, tools, events, controls, enforcement | The same, with real models |
| What the agents say | A fixed fixture (`server/test/fixtures.ts`). The scripted Policy agent recommends approval for everything, so a pass means the controls held without help | Whatever the models say |
| Needs | Nothing | A model API key and credit |
| Proves | The workflow and the controls | The whole system, non-deterministically |
| Does not prove | Anything about a language model | Repeatability |

**Fault injection** (S10, S11) is labelled in the scenario, in the result, in the case's own audit trail and in the report. An injected result is never presented as model behaviour, and those two scenarios are left out of the benchmark.

**Guard rails.** One run at a time; at most four workers on the deterministic path and three on the live path; a timeout per scenario after which the worker is stopped; a run is capped at 24 executions; a live run must be confirmed explicitly, in the UI and in the API; a provider failure makes a scenario "not judged", not passed or failed.

**Audit report.** Every execution exports as JSON: scenario, source documents with content hashes, trusted record references, policy version (name plus a hash of the policy), agent execution records, structured findings, the evidence ledger and its integrity report, expected outcome, actual outcome, the deterministic enforcement result, test status, timestamps and known limitations. Synthetic data and sandbox output are labelled at the top.

![One stress scenario: declared outcome per document against what the agent recommended, what the controls allow and what is in force](docs/stress-result.jpg)

```bash
npm run lab                      # all twelve, deterministic path
npm run lab -- --only S02,S05    # some of them
npm run lab:live                 # all twelve with live models (uses credit)
```

## Benchmark: single agent against multi-agent

**Configuration A, the baseline.** One agent in one loop on the stronger of the two models. It reads the document, gets the same trusted-record lookup the Validator gets and the same control list and policy the Policy agent gets (the same functions in `server/desk.ts`), reports contradictions it finds, and recommends a disposition. It is not handicapped: it has everything except a second, independent reader and a separate investigation.

**Configuration B, Payment Desk.** The Mozaik workflow as described above.

Both process the same scenarios (the ten without fault injection), are judged against the same declared outcomes, and pass through the same deterministic enforcement. Two things are measured apart, because conflating them would be the easiest way to mislead:

- **What the agent recommended**, before enforcement. This is where architectures can differ.
- **What was enforced.** The controls stop an unsafe recommendation in either configuration, so a safe final decision is not evidence for either architecture.

Metrics, each with its definition shown next to the number in the app (`server/lab/metrics.ts`): scenarios passed, correct final decisions, unsafe approval recommendations, unsafe approvals after enforcement, legitimate payments not approved, critical fields read correctly (against hand-written reference readings), declared control conditions detected, evidence present, evidence correct, agent disagreements, loops, execution time, tokens as reported by the provider. Cost is not shown because no reliable price table is bundled. A metric that was not measured is shown as "not measured", never as zero. Ten synthetic scenarios support no statistical claim, and the app says so.

```bash
npm run lab:benchmark            # live models only
```

**Status: the benchmark has not been run.** The API account used for development ran out of credit before it could be. The benchmark page shows an empty state, and no figure appears in this README in its place. The baseline's workflow and the metric arithmetic are covered by tests on the scripted model; what the two configurations actually score against live models is unknown.

## Documents: plain text and text-layer PDF

**Add documents** takes several files at once, by drag and drop or from a file picker, and offers three synthetic sample PDFs. Each file is validated and parsed first and waits in a queue with what was found (pages, lines of text, a duplicate already on the desk). Nothing reaches an agent until **Process** is pressed.

| | |
|---|---|
| Formats | Plain text (`.txt`, `.eml`, `.md`, or pasted) and PDF with a text layer |
| Limits | A PDF: 2 MB, 10 pages, 8 seconds to parse. Any document: 20,000 characters of text. The dialog takes 8 documents at a time |
| Where a PDF is read | On this machine, in a worker thread, with `pdfjs-dist` 5.4.624. The file is not sent anywhere. The agents receive the extracted text and nothing else |
| Refused, with the reason | Scanned or image-only PDFs (**there is no OCR**), encrypted PDFs, a file that is not a PDF whatever its name says, a broken or truncated PDF, anything over a limit |
| Never used | Links, forms, attachments and scripts inside a PDF. The page is drawn to a canvas and that is all |

How a PDF becomes evidence:

1. **Validate.** Size and the `%PDF-` signature, not the file name or the declared type. Page count before any page is read.
2. **Parse** ([`server/pdf-worker.mjs`](server/pdf-worker.mjs), [`server/pdf.ts`](server/pdf.ts)). Text is grouped into lines per page, top to bottom. Every line keeps its page, its number on that page and, when the text is horizontal and inside the page, the box around it.
3. **One text, one workflow.** The lines joined together are the document the five agents and the controls work on, exactly as for a text document. A PDF invoice and the same invoice as text reach the same decision; `pdf.test.ts` compares five of them.
4. **Evidence carries the page.** An agent quotes; code finds the quote in the text and code adds the page and the line on that page. A reference reads `p. 2, line 12`. The integrity verifier fails a reference whose line is not in the source map or whose page does not match.
5. **Show it.** A reference opens the original page with a marker over the cited line, placed from the box the parser measured, at any zoom. When there is no box (rotated text, a quote that crosses pages) nothing is marked and the interface says so; the line is still quoted. The marker covers the line, not the single value in it.

The original file is kept by its SHA-256 (in memory, and beside the state file when persistence is on). If it is gone, the extracted text and its references remain and the interface says the original is unavailable. A second copy of the same file is reported as the same file; a different file with the same text is reported as that.

**In the scripted demo** only registered synthetic documents are interpreted: the sixteen text documents and eight PDFs, recognised by the hash of their extracted text, never by name. Any other document is validated, parsed and shown, and then answered with: *"The document was parsed successfully. Live AI access is required to interpret this invoice because it is not a registered scripted fixture."* The scripted model does not guess at a document it has no answer for.

**With live models** any supported PDF goes through the same agents as a text document. This path is **not verified on this version**: the provider account had no credit.

The sample PDFs are in [`server/data/documents/pdf/`](server/data/documents/pdf), written by `npm run fixtures:pdf` from the descriptions in [`server/test/pdf-specs.ts`](server/test/pdf-specs.ts). A test regenerates them and compares byte for byte.

![A figure opened on page two of the original PDF, with the cited line marked](docs/pdf-evidence.jpg)

![Add documents: three synthetic PDFs parsed and waiting, one previewed as the original](docs/pdf-intake.jpg)

## The demo dataset

`server/data/documents/` holds sixteen synthetic documents; `server/data/scenarios.json` states the expected outcome of each. Trusted records are in `vendors.json`, `history.json`, `purchase-orders.json`, `callbacks.json` and `confirmations.json`. Nothing needs to be generated or seeded: the files are the dataset. **Start demo** runs four of them one at a time (`INV-2026-1041`, `INV-ES-55820`, `INV-2026-1049`, `INV-7701-rappel`, and optionally `INV-ADR-0101`); *load all sixteen* on the overview runs the whole inbox.

| Document | Scenario | Expected |
|---|---|---|
| `INV-2026-1041` | Clean invoice, known vendor | AUTO_APPROVED |
| `INV-TC-20261122` | Second clean invoice | AUTO_APPROVED |
| `INV-AE-991204` | Original invoice that is later repeated | AUTO_APPROVED |
| `REM-AE-991204` | Reminder for that invoice | BLOCKED (duplicate) |
| `scan_0042` | The same file as `INV-7733` under another name | BLOCKED at intake |
| `INV-7701-rappel` | Invoice paid last month (`H-0001`) | BLOCKED (duplicate) |
| `INV-ES-55820` | Changed beneficiary IBAN | BLOCKED (beneficiary) |
| `INV-BP-2291` | 1,500.00 + 300.00 stated as 1,900.00 | BLOCKED (arithmetic) |
| `INV-7733` | 6,740.00, above the 2,500.00 limit | NEEDS_APPROVAL |
| `INV-PX-3001` | Unknown vendor | BLOCKED |
| `INV-TC-20261124` | "Pay to our usual account": no IBAN | BLOCKED (mandatory field) |
| `INV-ADR-0101` | Prompt injection in the document | NEEDS_APPROVAL |
| `INV-2026-1049` | Cover note asks 1,980.00, invoice total 1,890.00 | NEEDS_APPROVAL, or BLOCKED if the two agents read different amounts |
| `INV-ADR-0102`, `INV-ADR-0103` | Two invoices on PO-7781, 3,550.00 together | NEEDS_APPROVAL (possible split) |
| `MSG-newsletter` | A newsletter | NOT_A_PAYMENT |

**Add documents** offers three sample PDFs (a valid invoice, changed bank details, conflicting amounts on two pages), which the scripted demo can process, and four text examples under *Paste text instead*, which need live models. Among the text examples, *Changed bank details* is an invoice from vendor V-001 with a new IBAN: it is blocked, and entering callback reference `CB-2026-1125-01` (from `callbacks.json`) under **Verify beneficiary change** moves it to "needs approval". Any other reference is refused.

## Local inference: real models with no key and no cost

Payment Desk can run its agents on a model that runs on your own machine. Nothing is sent to a cloud provider and nothing is paid for. Only the transport changes: the Mozaik runtime still runs the five agent loops, the events, the tools and the shared state.

```bash
# once: install Ollama (https://ollama.com) and fetch a model, about 5 GB
ollama pull gemma2:9b

# then
LOCAL_MODEL=gemma2:9b npm run demo:local      # builds the UI, serves it on http://localhost:8798
```

Open http://localhost:8798. The showcase says **Live local AI**, and every agent loop is recorded with the model that ran it, for example `gemma2:9b · Ollama, this machine`.

| Variable | Default | Meaning |
|---|---|---|
| `DESK_INFERENCE=local` | off | selects local inference (`npm run demo:local` sets it) |
| `LOCAL_MODEL` | none, required | the model every agent uses; or `LOCAL_FAST_MODEL` and `LOCAL_CAREFUL_MODEL` |
| `LOCAL_MODEL_BASE_URL` | `http://127.0.0.1:11434/v1` | any OpenAI-compatible server on this machine. A remote address is refused |
| `LOCAL_MAX_CONCURRENCY` | `1` | model requests at one time. Agent loops still overlap; their requests wait in turn |
| `LOCAL_TOOL_PROTOCOL` | `json` | `json`: tool calls as schema-constrained JSON. `native`: the server's own tool calls, through Mozaik's `OpenAIChatCompletions` |
| `AGENT_TIMEOUT_MS` | `600000` in this mode | per-loop timeout |

What to know before relying on it:

- **There is no fallback.** If the local server is not running or does not have the model, the desk says so and stops. It never switches to a cloud provider or to the scripted model. A cloud key in the environment is ignored in this mode.
- **It is slow.** On an Apple M4 with 16 GB, one invoice takes four to eight minutes with a 9B model, because five agents make six or more model calls and the requests run one at a time. It is not something to run live in a three-minute presentation; the stored run below is.
- **A small model is a weaker agent.** It reads a clean invoice correctly. It is less reliable at the Investigator's and the Auditor's harder judgements than a large hosted model. Whatever it answers, the same controls decide, so a wrong answer costs a held or failed payment, never an approval that should not happen.
- **Why the `json` protocol is the default.** In testing, a 7B model's native tool call was dropped by the server's own parser: 307 tokens generated, an empty message returned. With `json` the server constrains the answer to the tools' schemas, so it always parses; the desk's own validation of the arguments still applies afterwards.
- **Memory.** A 9B model needs about 6.5 GB while loaded. On a machine that is already swapping, close other applications first.

## Install, configure, run

Requirements: Node.js 20.19 or newer in the 20 line, or 22.12 or newer (what the build tool needs). Tested on 20.20.2 and 22.23.5 with npm 10.8.2 (the npm they ship with) and on 26.8.2 with npm 11.19.1, macOS. On Node 20 `npm ci` prints an engine warning for the dev-server launcher; it runs there all the same. Nothing else: Mozaik runs in-process and needs no credentials of its own. The npm scripts set environment variables the POSIX way, so on Windows use WSL.

```bash
npm ci
cp .env.example .env     # only for live models
```

| Variable | Needed | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | for live agents | or `OPENAI_API_KEY` / `GEMINI_API_KEY` with matching model names |
| `FAST_MODEL`, `CAREFUL_MODEL` | no | defaults `claude-haiku-4-5`, `claude-sonnet-5-5` |
| `MOZAIK_API_KEY` | no | Mozaik Cloud trace; or `npx @mozaik-ai/cloud-sdk pair` |
| `API_PORT` | no | default 8787 |
| `HOST` | no | default `127.0.0.1`: the server answers on this machine only. There is no sign-in, so do not expose it |
| `AGENT_TIMEOUT_MS` | no | per-loop timeout, default 90000 |
| `DESK_STATE_FILE`, `DESK_PERSIST=off` | no | where the inbox state is saved, or not at all |
| `LAB_RESULTS_FILE`, `LAB_PERSIST=off` | no | where Stress Lab results are saved, or not at all |

| Command | What it does | Key |
|---|---|---|
| `npm run demo` | builds the UI and serves the scripted showcase on http://localhost:8799 (the UI says it is scripted) | no |
| `npm run dev` | API on :8787 and UI on http://localhost:5173 | for live agents |
| `LOCAL_MODEL=<model> npm run demo:local` | builds the UI and serves it on http://localhost:8798 with agents on a local model (Ollama or another OpenAI-compatible local server) | no |
| `npm run heldout -- http://localhost:8798` | uploads the five held-out invoices to a running server with real inference and compares the outcome with `server/data/heldout/expected.json` | no |
| `npm test` | 142 automated tests, scripted model | no |
| `npm run test:browser` | 28 browser checks of the showcase and PDF intake, after `npm run build`; Node 22+ and a Chrome or Chromium (`CHROME_PATH` if it is not found) | no |
| `npm run lab` | Stress Lab in the terminal, deterministic path | no |
| `npm run lab:live`, `npm run lab:benchmark` | Stress Lab and the benchmark with live models | a key, or `DESK_INFERENCE=local` with `LOCAL_MODEL` |
| `npm run cli` | the sixteen demo documents with live models, headless | yes |
| `npm run typecheck` | TypeScript, server and UI | no |
| `npm run build` then `npm start` | static UI in `web/dist`, served by the API on :8787 | for live agents |
| `npm run dev:scripted` | the scripted server alone on :8799, when the UI is already built | no |

There is no linter in the project; the type checker and the tests are the gates. GitHub Actions (`.github/workflows/ci.yml`) runs install, typecheck, tests, build and the Stress Lab on Node 20 and 22, with no model key.

## Tests

`npm test` runs 142 tests in eleven files with Node's test runner, in about a minute (the PDF tests parse real files), with no API key and no model. `AGENT_INTELLIGENCE_REPORT.md` describes the agents, how they check each other and what is verified. `QA_REPORT.md` lists the defects the stabilisation pass found and fixed, `TEST_MATRIX.md` maps each behaviour to its test, and `DEMO_READINESS.md` says what is and is not verified.

- `server/test/firewall.test.ts`: money parsing, IBAN, instruction detection, per-currency totals. No runtime.
- `server/test/workflow.test.ts`: the whole workflow on the **real Mozaik runtime** with a **scripted model**. Loops, tools, events, the firewall, enforcement and human actions are the real code; only the model's words are fixed. In most tests the scripted Policy agent recommends approval for everything, so a pass means the deterministic layer held by itself.
- `server/test/lab.test.ts`: the twelve stress scenarios; that expected outcomes never reach an agent; that the judge fails a run that did the wrong thing; the daily budget under concurrency, repeatedly; fault-injection labelling; the integrity verifier on a clean payment and on each kind of broken evidence; the integrity gate; the single-agent baseline and the metric arithmetic; process isolation of a lab run.
- `server/test/safety.test.ts`: amounts that are not payable (zero, negative), exact arithmetic at the edges of the number format, a very large amount, and each agent failing in turn.
- `server/test/intelligence.test.ts`: malformed model output in ten forms (never an approval), well-formed but wrong output, invented rules and citations, provider failures by kind (no retry on an empty account, one retry on an outage), the cross-agent challenge protocol, and what a person's approval of a challenge does and does not establish.
- `server/test/showcase.test.ts`: the interactive showcase. Each scenario's result is the outcome the controls enforced; a scenario cannot run twice and two cannot run at once; a failed scenario is failed, never confirmed, and can be run again; an unexpected outcome is reported as unexpected; the demo leaves a person's own documents, decisions and callback verifications alone; the recorded execution is served as stored and cannot be acted on; a scripted server says it is scripted, and a live server without a key runs nothing and substitutes nothing.
- `server/test/resolution.test.ts`: how a held or blocked payment is resolved with a trusted record, and what cannot stand in for one. A verified vendor confirmation for the right vendor, invoice and amount settles a contradiction and a person still approves; no reference, an unknown one, another vendor's, another invoice's, an unverified one and malformed input are refused; a confirmation that states the other amount blocks the payment; readers that disagree are not settled by it; a callback clears only its own vendor and account and never changes the vendor master; missing and contradictory currency.
- `server/test/pdf.test.ts`: PDF intake. The fixtures regenerate byte for byte; one and two pages; European number and date formats; a rotated page; refusals (empty, executable, image, text named `.pdf`, corrupted, truncated, too large, too many pages, too much text, image-only, encrypted); the parse timeout and eight parses requested at once; five invoices reaching the same decision as text and as PDF; page and line on every located reference; the integrity verifier on a tampered page reference; three kinds of duplicate (the same file under another name, the same text in another file, the same obligation in another document); the financial controls on PDFs (changed IBAN, arithmetic, zero amount, missing IBAN, unknown vendor, instruction-like text, an invented value, a failing agent); the HTTP flow from sample to processed payment; the scripted server refusing to interpret an unregistered document; persistence across a restart, and honesty when the original file is gone.
- `server/test/local.test.ts`: local inference and mode labels, with a stand-in OpenAI-compatible server over real HTTP (no real model). Configuration (a remote address is refused, a model must be named, limits are bounded); the startup probe; a clean invoice through both tool protocols with tool results round-tripping and usage recorded; every label saying local and no cloud model name anywhere; model requests bounded to the configured concurrency while two agent loops still overlap; malformed answers, an answer with no tool call, a body that is not JSON, a model that never answers and a server that goes away, none of which approves anything or is replaced by a scripted answer; the scripted server naming no model; and both intake routes refusing an unregistered document before a case exists.
- `server/test/api.test.ts`: the real server under hostile and careless use: malformed bodies and addresses, bad uploads, path traversal, a run started twice, conflicting amounts approved without a resolution, approvals that race, reprocessing a decided payment, an open page compared with server state, a server killed straight after a decision, and requests from another site or under a foreign hostname (refused; the server listens on this machine only).
- `server/test/http.test.ts`: the real server process driven over HTTP the way the UI drives it: run the inbox, approve, refuse approval of a blocked payment, export a draft, reject, a wrong callback reference, add a document, run the Stress Lab, export an audit report.

What they cover from the firewall's point of view: a valid invoice is approved; a changed IBAN cannot be approved whatever the Policy agent says; an invalid IBAN; a duplicate is not authorised twice; a renamed duplicate; arithmetic; unknown vendor; missing evidence and missing IBAN; the per-payment limit; the daily limit, including decisions that land together; a double approval; prompt injection, alone and on top of a changed IBAN; Extractor and Auditor disagreeing; a Validator report that contradicts the records; a failed Auditor and a failed Policy agent; a superseded loop that must stop; idempotent reprocessing; no draft for a blocked payment; every reported amount resolving to a ledger entry; mixed currencies; and all sixteen demo documents ending where `scenarios.json` says.

**Browser checks.** `npm run test:browser` (`scripts/browser-smoke.mjs`, no extra dependency) starts the scripted server, drives a headless Chrome over the DevTools protocol and walks the showcase: one entry point, the mode labelled as scripted and never as live, the four scenarios and their enforced outcomes, a figure opened at its source line and on its page of the original PDF with the line marked, the agent challenge, the summary, no approve action on a blocked payment, the execution proof, exit, the appearance switch, the recorded view, document intake (a sample PDF parsed, previewed and processed only when asked; an executable and a broken PDF refused; an unregistered document parsed but not interpreted; evidence marked on the page in the payment workspace; a duplicate named before processing), and the agent inspector naming the scripted fixture rather than a configured model, a document with two amounts offering a confirmation and a rejection but no approval, and a provider that refuses every call (banner shown, scenario failed, nothing confirmed). Twenty-four checks, including the resolution of the held payment with a vendor confirmation; every wait is a condition on the page. It is a smoke suite, not full interface coverage, and is not part of `npm test`.

**What these tests are not.** They are not live-model tests. Passing tests show that the workflow and the controls behave as specified with fixed agent output. They do not show how a model behaves.

### Live verification, stated plainly

### A run of this version with a real model, 27 November 2026

The four showcase scenarios were run on this version of the code with **`gemma2:9b` on the same laptop** (as `gemma2:9b-8k`, the same model with an 8k context; Ollama 0.32.5, Apple M4, 16 GB, one model request at a time, `json` tool protocol). No cloud provider was called. The cases are stored in `server/data/recordings/current.json` and replay in the app: showcase opening, *Watch the recorded run of this version*.

| Scenario | Expected | What happened | Time |
|---|---|---|---|
| Legitimate invoice | AUTO_APPROVED | **AUTO_APPROVED.** Extractor and Auditor each read 1,415.00 EUR and the IBAN, with the exact lines; the Validator looked the vendor up and found the account on file; the Policy agent recommended approval; sandbox draft | 190 s |
| Changed bank account | BLOCKED | **BLOCKED.** The Validator reported that the IBAN is not the one on file and the Investigator was called. **The Policy agent recommended only "needs approval"; the controls kept it blocked.** No draft | 422 s |
| Two amounts in a PDF | NEEDS_APPROVAL or BLOCKED | **Processing error, nothing approved.** This model's Auditor did not report the second amount. The control in code did (1,890.00 against 1,980.00, challenge on record). The Investigator then twice returned a result that failed validation (more than ten facts), so its loop was closed and the payment failed | 500 s |
| Duplicate payment | BLOCKED | **Processing error, nothing approved.** The Extractor left the currency empty; the Validator reported the duplicate and the duplicate control failed; the Investigator again returned an invalid result twice | 455 s |

What this shows, and what it does not:

- **Shown:** real model inference through the Mozaik runtime on the current version: 17 agent loops, each recorded with its model, its start and finish, its trigger and the token usage the server reported. The Validator and Auditor loops start from the same event and overlap; their model requests ran one after the other, because one request at a time was configured.
- **Shown:** the reason for the architecture. In one scenario an agent recommended less than the policy requires and the code overruled it. In two, an agent failed, and the payment failed with it instead of being approved. No scenario ended looser than expected.
- **Not shown:** that a small local model is a good Auditor or Investigator. Two of four scenarios did not reach a decision, and the Auditor missed the contradiction that the hosted model found in the earlier run. That is what this model did, stored as it happened.
- **Not run:** the five held-out invoices (`npm run heldout`), the live Stress Lab and the single-agent benchmark. The laptop ran out of disk through swap while the model was loaded; the files and scripts are in the repository. An earlier attempt with `qwen2.5:7b` and native tool calls stopped at the Auditor: the server returned an empty message for a 307-token answer, which is why the `json` protocol exists.
- **Not verified:** hosted models on this version. Mozaik in this repository supports `gemini-3.5-flash-lite` and `gemini-3.8-flash`, which Google listed with a free tier on 27 November 2026; with `GEMINI_API_KEY` set, `FAST_MODEL=gemini-3.5-flash-lite CAREFUL_MODEL=gemini-3.8-flash npm run dev` should use them, but no key was available and it has not been run.

### The earlier run with hosted models, 26 November 2026

A live run of the sixteen demo documents through the app on 26 November 2026 (Haiku 4.5 + Sonnet 5.5, 67 agent loops, about 370k tokens, 46 seconds) decided 12 of the 16 before the API account ran out of credit. Of those 12, 11 ended as `scenarios.json` expects; the twelfth was a clean invoice the Policy agent held for review because it read a not-applicable control as a failure (the control now has its own "not applicable" status and the agent's instructions say so). The remaining four stopped as processing errors with the provider's "credit balance is too low" message, and nothing was approved for them, which is the fail-closed behaviour working. Two of those four are documents whose IBAN the fast model mistyped: the Auditor read both correctly and the controls failed on both, which is why an account number is now read by code from the quoted line.

The five showcase documents of that run are in the repository (`server/data/recordings/live-2026-11-26.json`) and can be replayed in the app: three reached a decision, including the live Auditor reporting both amounts of `INV-2026-1049` on its own, and two stopped when the credit ran out. They are shown as recorded, on an earlier version of the code.

Everything added after that run has been verified on the deterministic path only: reading IBANs from the quoted line, the not-applicable status, shorter agent briefs, the evidence integrity gate, the Stress Lab, the single-agent baseline, the revised prompts, the cross-check protocol, the showcase and the vendor confirmation. The last attempt to reach the provider, on 26 November at 23:38 CET, was refused for lack of credit. **No live Stress Lab run and no benchmark has completed**, on hosted or on local models. A live Stress Lab scenario was started and reported, correctly, that it could not be judged because the provider refused the request.

One real defect was found by the Stress Lab while building it: when a document was run again after an agent failure, a loop left over from the failed attempt kept calling the model until its timeout. It now stops before its next model call, and a test covers it.

## The app

The sidebar is grouped by what a person comes to do: **Workspace** (Overview, Payments, Review queue), **Intelligence** (Agent activity, Payment risks) and **Verification** (Evidence & audit, Stress lab). Pointing at an item, or focusing it, says in one sentence what is there. An empty desk shows what the product does, one **Start demo** action and three labelled examples of the outcomes instead of four zeros. Where the agents' answers come from (scripted demo, live local AI, live AI) is always in the top bar, with the full explanation one press away.

| View | For |
|---|---|
| **Guided demo** (the **Start demo** button, top right of every page) | The interactive showcase. An opening that says what the product is for and which mode this server runs in, then four scenarios one at a time: the agents drawn from the run's own execution state, the outcome the controls enforced beside what the scenario file expects, every figure with its source, the agent challenge, the recorded overlap of the two independent checks, an optional resolution of the held payment with a vendor confirmation, and a summary counted from the payment cases. A recorded live run can be replayed from here. |
| **Overview** | What the product does in one line, four figures (pending review, approved, blocked exposure per currency and never called "money saved", auto-approval limit used), the three most serious payments each with its issue in one sentence, the five agents at a glance, and an optional first-visit guide. |
| **Payments / Review queue** | A list beside the selected payment. Search, a status filter, sort, keyboard navigation. The queue holds what is blocked or needs approval, the most serious first. |
| **Payment workspace** | Four tabs. *Overview*: the decision in one sentence, each reason with the values it rests on and their sources, the actions the server allows, and the payment facts; how it was decided is folded beneath. A payment with a discrepancy (conflicting amounts, readings that disagree, a possible split) is not approved by a click: the server refuses the approval until a verified vendor confirmation is attached or the reviewer states in writing how it was resolved, and the primary action is to request verification. A payment that is only above a limit is approved directly. *Verification*: every control with its evidence, the investigation, both agents' readings side by side. *Evidence*: the whole ledger beside the source document. *Activity*: this payment's agent timeline, review history and log. Any reference opens an evidence inspector with the cited lines. |
| **Add documents** | Drag and drop or choose several files, or try a synthetic sample PDF. A queue shows what each file is and what was read from it; a PDF is previewed as the original. Refusals say why. Processing starts only when asked. |
| **Payment risks** (the Payment Firewall) | Every payment a control stopped or flagged: the exception in one sentence, the trusted record beside the incoming document, what each agent found, and the decision. |
| **Agent activity** | *Workspace*: five glass agents and two code gates in one composition, drawn from recorded state. An agent leans toward its input while its loop runs, a capsule travels a connection at the moment the receiving loop starts, and the conditional route to the Investigator lights only on a real exception. It follows a live run, and it replays any finished payment from the stored start and finish times (pause, seek, 8 s, 16 s or real time) without calling an agent. *Execution details*: every loop on one clock, concurrency figures, and a table with model, retries, tokens and trigger. |
| **Evidence & audit** | Evidence integrity across the desk, every agent step, firewall decision and human action (by time or by payment, with filter, search and export), and the scenario check: expected against actual for all sixteen documents. |
| **Stress lab** (the Financial Stress Lab) | The twelve scenarios on either path, each with what it declared, what happened, the agent execution, the evidence integrity report and its inputs; the benchmark; JSON audit reports. |
| **Settings** | Appearance, ambient motion, demo reset, connection status, and the policy, vendor master and payment history as the server has them. |

The interface is a web interpretation of a glass material system: an ambient background, a floating navigation layer, content glass for summaries and near-opaque reading surfaces for financial detail. It is designed in dark and light, for a phone as well as a desktop, and it honours reduced motion, reduced transparency and increased contrast. `DESIGN.md` has the system.

![A payment that needs approval: the decision, the actions the server allows, the payment facts and how the decision was reached](docs/payment.jpg)

![The same overview in the light appearance](docs/overview-light.jpg)

## Three-minute demonstration

`DEMO_GUIDE.md` is the walkthrough for a first visit: **Start demo**, four scenarios, what to inspect in each. The steps below go further into the workspace, on the full inbox.

With a key and credit (live agents):

1. **Overview → load all sixteen synthetic documents.** Open **Agent activity** while it runs: the Extractor reads everything at once, Validator and Auditor overlap on each document, the Investigator is called only for exceptions.
2. **Evidence & audit → Scenario check**: expected against actual for all sixteen.
3. **Payment risks → Iberia Office Supplies.** Blocked. The trusted IBAN sits beside the incoming one with the differing groups marked. Select the `line 22` reference: the evidence inspector opens with the cited lines. There is no approve button.
4. **Open the payment → Verification → Investigation**: verified facts with references, what is unknown, who to call. "Suspected, not proven."
5. **Add document → Changed bank details.** Blocked. Enter `CB-2026-1125-01` under *Verify beneficiary change*: it moves to "needs approval", with the callback in the ledger. Approve it: a sandbox draft appears and the review history records who, when and why.
6. **Stress lab → Run all 12 scenarios** on the deterministic path: seconds, in isolated processes. Open S08 to see three concurrent decisions held under the daily budget, and S10 to see a labelled fault injection caught by the comparison of the two readings.

Without a key: `npm test`, `npm run lab`, then `npm run demo`, load the sixteen documents on http://localhost:8799 and follow steps 2, 3, 4 and 6 (the mode indicator in the top bar says the demo is scripted). **Add documents** there processes the three sample PDFs; any other document is parsed and shown, and says it needs live AI.

## Project layout

```
server/
  desk.ts          Mozaik runtime: shared state, the agents, bound tools, event reactions, enforcement, human actions, persistence
  firewall.ts      every deterministic control, the evidence builders, the reading comparison (no model)
  integrity.ts     independent re-verification of the evidence ledger (no model)
  local.ts         local inference: configuration, startup probe, the runner that reaches a local model server (no fallback)
  pdf.ts           PDF validation, limits, the parse with a timeout, canonical text and its source map (no model)
  pdf-worker.mjs   the PDF parser, in a worker thread: text lines with page, line and box
  money.ts         integer minor units: parsing, formatting, per-currency sums
  lib/iban.ts      normalisation, country lengths, mod-97, reading IBANs from text
  draft.ts         sandbox payment draft (JSON)
  domain.ts        typed case state, shared with the UI
  challenges.ts    cross-agent challenges derived from shared state; provider error classification (no model)
  showcase.ts      the four showcase scenarios, their results read from the cases, and the recorded execution
  index.ts         HTTP API + server-sent events with heartbeat
  cli.ts           live headless run of the demo documents
  lab/
    scenarios.ts   the twelve stress scenarios and what each declares
    run.ts         runs one scenario and judges it
    worker.ts      one scenario in its own process
    manager.ts     queue, concurrency, timeouts, results, audit report
    metrics.ts     benchmark arithmetic and metric definitions
    cli.ts         the lab from the terminal
  data/            policy, vendors, history, purchase orders, callbacks, scenarios, documents (all synthetic)
    documents/pdf/ eight synthetic PDF invoices and their manifest (regenerate with npm run fixtures:pdf)
    recordings/    stored execution records for replay only: an earlier run on hosted models, and a run of this version on a local model
    heldout/       five synthetic invoices no predefined answer exists for, and what should happen to each
  test/            scripted model, fixtures, predefined showcase responses, the PDF writer and specs, and the eleven test files
scripts/
  browser-smoke.mjs  the browser checks of the showcase and PDF intake (npm run test:browser)
  make-pdf-fixtures.ts  writes the synthetic PDFs from their descriptions (npm run fixtures:pdf)
  heldout.mjs        runs the held-out invoices against a server with real inference (npm run heldout)
  capture-recording.mjs  stores a live showcase run for replay
web/src/
  views/           Showcase, Overview, Payments (inbox + queue), Firewall, Activity, Lab, Audit, Settings
  components/      Shell, LivingWorkspace, PaymentList, PaymentDetail, Timeline, AddDocument, PdfView, ui
  lib/             api (one EventSource), lab, derive (pure functions over state), format, router
  styles/          tokens.css, base.css, views.css
ARCHITECTURE_PROOF.md    eight architectural claims, each with its code and its test
JUDGE_QA.md              short answers to likely questions
FINAL_RELEASE_REPORT.md  what was verified for this release and what was not
DEMO_GUIDE.md            the walkthrough for a first visit
DEMO_READINESS.md        what is ready, what is verified and what is not, per execution mode
DESIGN.md                the design system
HACKATHON_SCORECARD.md   self-assessment against the four judging criteria
```

## Known limitations

- **Sandbox only.** No bank connection, no payment execution. The payment draft is a structured JSON record, not an ISO 20022 message: producing schema-validated pain.001 XML was not practical in the time, so the app does not claim it.
- **Hosted models are not verified on the current version**, and the benchmark has not been run. A local model ran the four showcase scenarios on it: two as expected, two failed safely. See *Live verification, stated plainly*.
- **The scripted demo proves the workflow, not a model.** Its agent answers for the five showcase documents are predefined text, written after what the live models returned in the recorded run.
- **A hackathon sandbox, not a production system.** It is not deployed, not hardened and not connected to anything.
- **No authentication.** Human actions are recorded as "Demo reviewer". Permissions are enforced on the server, but there is one reviewer.
- **Text and text-layer PDF only. No OCR.** A scanned or image-only PDF is refused. Encrypted PDFs are refused. Images are not read.
- **PDF reading order is simple.** Lines are read top to bottom by baseline. A multi-column page can come out interleaved, and a table is read row by row. The synthetic fixtures are single-column invoices; nothing is claimed about arbitrary layouts.
- **The marker covers a line.** It is drawn only where the parser measured a box, and it marks the cited line, not the single value. Rotated text and a quote that crosses pages get the page without a marker.
- **Arbitrary PDFs need live models, and that is not verified here.** The scripted demo interprets only its registered synthetic documents; with no provider credit, a PDF outside that set has never been run through live agents on this version.
- **Models are non-deterministic.** The same document can be worded differently between runs, and an agent may be stricter than the controls require. It can never be looser.
- **Heuristics are labelled as such.** Instruction-like content and "another payable amount in the document" are pattern matches that send a case to review; vendor matching is token overlap on names.
- **One process for the inbox.** State is one JSON file and the concurrency guarantees are those of a single Node process. Stress Lab runs are separate processes. A person's decision is written to the file before the request returns; agent progress within a second.
- **Trusted records are fixtures.** A contradiction about the amount is settled by a vendor confirmation and a changed bank account by a callback record. The desk matches a record to the vendor, the invoice or account, and the amount; it does not contact a vendor, and in this sandbox both kinds of record are synthetic files.
- **A reviewer's statement is accepted for discrepancies that are a matter of judgement, and is never called verification.** A possible split or instruction-like text can be approved on a written statement. A document that states two payable amounts cannot: only a verified vendor confirmation releases it (policy v7). A critical disagreement between the two readers cannot be approved at all.
- **Local only.** The server listens on 127.0.0.1 and refuses requests from other sites and foreign hostnames. It has no sign-in, so it is not meant to be hosted publicly.
- **One sandbox workspace.** Showcase payments are ordinary demo documents on the desk and share its daily auto-approval budget. Starting the demo replaces the demo documents; a person's own documents, decisions and verifications are kept.
- **Split-payment detection** groups by vendor and purchase order (or same invoice date) within a window; it does not look at history.
- **Reference readings are hand-written** for the sixteen synthetic documents; field accuracy in the benchmark is measured against them and only on live runs.
- **Browser coverage is a smoke suite** of twenty-four checks on the showcase and PDF intake, outside `npm test` and outside CI. There is no linter.
- **CI covers install, types, tests, build and the Stress Lab** on Node 20 and 22 (Linux). It does not run the browser checks or anything with a live model. Its first run failed and caught a lockfile that npm 10 rejected; that run is still in the history.
