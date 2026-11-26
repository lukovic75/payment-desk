# Hackathon scorecard

A self-assessment of Payment Desk against the four judging criteria of the JigJoy Black Friday AI Hackathon, track *Agents in Finance*. Written by the team, on 26 November 2026, and revised for the final release.

**This is not an official score.** The points in the "Self-assessment" lines are our own estimate of where we stand, given to make the gaps visible. The jury decides.

Every claim below names the file that implements it and the evidence that it works. "Verified" means it was run and the result was observed. Where something was not verified, it says so.

## Verification summary

| Check | Result |
|---|---|
| `npm run typecheck` (server and UI) | passes |
| `npm test` | 114 of 114 pass, about 4 seconds, nine files, on Node 20.20.2, 22.23.5 and 26.8.2 (see `QA_REPORT.md`, `AGENT_INTELLIGENCE_REPORT.md` and `TEST_MATRIX.md` for what they cover) |
| `npm run test:browser` | 17 of 17 browser checks of the interactive showcase, headless Chrome against the scripted server |
| Clean copy of the repository files | `npm ci`, typecheck, tests, build, lab, `npm run demo` and the browser checks all pass with no `.env`, no saved state and no build output |
| GitHub Actions | a workflow for Node 20 and 22 is written; **not in the repository yet** (pushing it needs a credential with the `workflow` scope) |
| Scripted showcase (`npm run demo`) | four scenarios, each ending as `scenarios.json` expects; looked at in dark and light, phone to wide desktop |
| `npm run build` | passes |
| `npm run lab` (12 stress scenarios, deterministic path) | 12 of 12 pass, 87 of 87 declared checks |
| Stress Lab through the app (worker processes) | 12 of 12 pass; payment inbox unchanged before and after |
| Live demo run, 16 documents, real models | **partial**: 12 decided before the API credit ran out, 11 as expected; 4 stopped as processing errors with nothing approved |
| Live Stress Lab run | **not completed**: one scenario was tried again on 26 Nov at 22:58 CET and was correctly reported as "could not be judged" (provider refused: no credit) |
| Single-agent versus multi-agent benchmark | **not run** (needs live models) |
| Linter | none in the project |
| Live showcase on this version | **not run** (provider credit). A recorded live run of an earlier version is replayable in the app: 3 of 5 showcase documents reached a decision |

## 1. Financial usefulness — 30 points

**What is implemented**

- A complete accounts-payable workflow: receive, extract, validate against trusted records, audit independently, investigate exceptions, apply policy, enforce, ask a person where the policy wants one, produce a sandbox draft, keep the audit trail.
- Controls for the losses that actually happen: changed beneficiary account, duplicates (same invoice, already paid, same file renamed, near-duplicate), arithmetic, per-payment and daily limits, unknown vendor, missing mandatory field, prompt injection, possible split payment.
- Human review that is enforced on the server: approve, reject, request verification, verify a beneficiary change against a callback record, settle a conflicting amount with a vendor confirmation, run again. A blocked payment cannot be approved.
- Resolution, not only detection: a document that states two amounts is settled by a trusted record that is independent of the document, matched to the vendor, the invoice, the currency and the amount. A record that states the other amount blocks the payment. A reviewer's statement without a record is accepted and labelled as not verified.
- A guided showcase that tells this as one story in four scenarios, with no key (`npm run demo`).
- Exposure reporting that does not overclaim: "blocked payment exposure" per currency, never "money saved".

**Where**: `server/desk.ts` (workflow, human actions), `server/firewall.ts` (controls), `server/draft.ts`, `web/src/components/PaymentDetail.tsx`, `web/src/views/Overview.tsx`.

**Evidence**: `server/test/workflow.test.ts` tests 1 to 18b; `server/test/http.test.ts` drives the ten workflow stages over HTTP; `server/test/resolution.test.ts` (twelve tests on resolving with a record and on what cannot stand in for one); stress scenarios S01 to S09 and S12; the browser checks walk the four scenarios and the resolution.

**Limitations**: sandbox only; the draft is JSON, not ISO 20022; plain-text documents, no PDF or OCR; one reviewer, no roles or four-eyes; vendor matching is token overlap; sixteen synthetic documents, one synthetic company; callback and confirmation records are fixtures, so the step of actually obtaining them from a vendor is outside the application. No measured saving of time or money exists, and none is claimed.

**Self-assessment: 24 of 30.** The workflow and the controls are real and complete for the scope. What holds it back is distance from a real finance stack: no ERP or bank connection, no document parsing beyond text.

## 2. Multi-agent architecture on Mozaik — 30 points

**What is implemented**

- One Mozaik runtime with typed shared state; five agents and three non-model participants joined to it; no orchestrator. Agents react to semantic events through situation handlers.
- Real parallelism: Validator and Auditor start from the same event; every document has its own loops with its own context.
- Independence that matters: the Auditor does not see the Extractor's reading; code compares the two.
- Cross-agent checks that change the outcome: reading disagreement blocks, a Validator report that contradicts the records goes to review, the Investigator is conditional, the Policy agent's recommendation is compared with the controls.
- Tools bound per loop to one case and one attempt; stale writes refused; a superseded loop stops before its next model call.
- Proof of execution: every loop has an execution id, model, real timestamps, status, retries, tokens and trigger; concurrency is derived from those timestamps; dependencies are drawn per payment.

**Where**: `server/desk.ts` (runtime, `startLoop`, `submitTool`, reactions), `web/src/components/Timeline.tsx`, `web/src/views/Activity.tsx`.

**Evidence**: test "the Validator and the Auditor run in parallel after the Extractor" asserts overlapping recorded intervals and that Policy starts after both; test 13 (disagreement blocks and investigates); 13b; 14, 14b, 14c; stress scenario S08 asserts a peak of at least two loops in parallel and the budget invariant across four repeats; S10. The live run recorded 67 loops with a peak of 28 at one instant.

**Where to check quickly**: `ARCHITECTURE_PROOF.md` gives eight claims with file and line and the test for each.

**Limitations**: parallelism with live models was observed once, in the partial live run of an earlier version (replayable in the app for five documents). Whether five agents do better than one is exactly what the benchmark would show, and it has not been run. Mozaik Cloud tracing works when the machine is paired but is not required and is not asserted by tests.

**Self-assessment: 25 of 30.** The Mozaik usage is genuine and specific (events, handlers, interception, shared state, bound tools). The missing piece is measured evidence that the architecture earns its cost.

## 3. Working implementation — 25 points

**What is implemented**

- Runs from the README: `npm ci` and `npm run demo` for the guided showcase with no key, `npm test` and `npm run lab`, or `.env` plus `npm run dev` for live agents. `DEMO_GUIDE.md` is a ten-minute walkthrough.
- 114 automated tests in nine files: unit, workflow on the real runtime, financial safety at the edges, malformed and wrong model output, provider failures, cross-agent challenges, the showcase and its isolation, resolution with trusted records, Stress Lab, and the real server over HTTP under normal and hostile use. Seventeen browser checks of the showcase.
- The server listens on the local machine only and refuses requests from other sites, so a page open in the same browser cannot start a run that spends model credit.
- A deterministic path that needs no credentials and a live path, labelled apart in the UI, the CLI, the API and the reports.
- Failure handling: bounded retries, loop timeouts, fail-closed stages, recoverable cases, persistence across restarts, a heartbeat on the event stream, honest error states in the UI.
- Guard rails on spending: one lab run at a time, bounded concurrency, timeouts, explicit confirmation for live runs.

**Where**: `README.md`, `package.json`, `.env.example`, `server/test/*`, `server/lab/manager.ts`, `server/index.ts`.

**Evidence**: the verification summary above. A defect found by the Stress Lab itself (a leftover loop spinning until its timeout after a document was run again) was fixed and is covered by test 14c, which fails on the previous code.

**Limitations**: live verification is partial and the reason is mundane (API credit). No linter. Browser coverage is a smoke suite of the showcase. No CI in the repository yet. Tested on macOS only; the npm scripts need a POSIX shell. State is JSON files and the inbox is a single process.

**Self-assessment: 20 of 25.** Everything that can be verified without a paid model call has been, repeatedly. The deduction is for the live path not having been seen end to end after the latest changes.

## 4. Financial data integrity — 15 points

**What is implemented**

- Money as integer minor units from parsing to display; exact arithmetic, no tolerance; currencies never added together.
- Every reported value has a ledger reference to a document line, a trusted record, a policy value or a calculation with its inputs.
- An independent integrity verifier that re-reads the source and separates "a reference exists" from "the source supports the value", classifies failures (missing evidence, broken reference, unsupported claim, incorrect normalisation, untraceable calculation), and blocks a payment whose critical evidence fails.
- IBANs read from the quoted line, not from what a model retyped.
- Honest reporting throughout: unavailable metrics are "not reported" or "not measured", never zero; fault injection is labelled wherever its result appears; the benchmark shows nothing until it has run; suspicion is worded as suspicion.

**Where**: `server/money.ts`, `server/lib/iban.ts`, `server/firewall.ts` (`buildReading`, `reportedAmounts`), `server/integrity.ts`, `server/lab/metrics.ts`.

**Evidence**: firewall unit tests; workflow tests 8, 17, 18, 18b and "an account number is read from the quoted line"; lab tests "a clean payment verifies", "each kind of broken evidence is caught" (six mutations, including a citation that exists but does not contain the value), "evidence that fails re-verification blocks the payment", "metrics that were not measured are null, never zero". In the deterministic Stress Lab run: 578 of 578 references resolve and 528 of 529 checkable values are supported by their source; the one that is not is the amount deliberately altered by fault injection in S10, and the verifier names it.

- Four things kept apart for a disputed amount: the value appearing in the document, a citation of its line, a reviewer's assertion, and an independent record. Only the last is ever labelled as a match; an approved contradiction without one is labelled *accepted by a reviewer, not verified*.

**Limitations**: some values cannot be checked mechanically (dates written in words, free-text names) and are reported as unchecked rather than correct. Agent statements are checked for having a citation, not for the citation proving the statement. The reference readings used for field accuracy are hand-written.

**Self-assessment: 13 of 15.**

## Self-assessment total

**82 of 100, self-assessed, not an official score.** (24 + 25 + 20 + 13.) The spread is deliberate: the points we do not give ourselves are almost all for things that are built but not yet observed against live models.

## What could make a knowledgeable judge deduct points

| Weakness | Criterion | Why it is still there |
|---|---|---|
| No run with live models on the final version; no live Stress Lab | Multi-agent, Working implementation | Provider credit. The scripted demo proves orchestration and controls, not model behaviour |
| The benchmark has never completed, so the value of five agents over one is argued, not measured | Multi-agent | Same blocker |
| Text documents only | Financial usefulness | PDF intake was left out of the final sprint on purpose |
| Trusted records for resolution are fixtures | Financial usefulness | Obtaining a confirmation from a vendor is outside the sandbox |
| One synthetic company, sixteen documents | Financial usefulness, Integrity | Scope of a two-day build |
| No CI in the repository yet | Working implementation | The workflow is written; pushing it needs a credential with the `workflow` scope |

## Highest-impact remaining work

| | Work | Why it matters | Status |
|---|---|---|---|
| 1 | Top up API credit; run the demo documents, `npm run lab:live` and `npm run lab:benchmark`; put the recorded results in the README | It converts "built" into "observed" for three of the four criteria, and the benchmark answers the question a jury will ask about multi-agent | blocked on credit; needs no code |
| 2 | Act on what the benchmark shows, whichever way it goes | If one agent does as well, say so and argue the case on independence and auditability; if not, the numbers make the argument | after 1 |
| 3 | Rehearse the three-minute demonstration against live models | Timings in the walkthrough are estimates | after 1 |
| 4 | Automated browser tests beyond the showcase | The showcase has a smoke suite of seventeen checks; the rest of the UI is checked by hand | partly done |
| 5 | Schema-validated ISO 20022 output; roles and four-eyes approval; PDF input | Distance from a real finance stack | out of scope for the hackathon |

Implemented in this round from the previous version of this list: evidence integrity verification with a blocking gate; the Stress Lab with isolated execution; the single-agent baseline and benchmark arithmetic; execution ids and a per-scenario execution record; audit report export; the first-visit guide; an HTTP end-to-end test; the fix for leftover loops.
