# Payment Desk · architecture proof

Eight claims, each with the code that makes it true and the test or record that shows it. Line numbers are for this commit. Nothing here needs a model key to check.

## How one document moves through the runtime

1. **A document enters.** `intake` puts the case in shared state and publishes `document.received` on the Mozaik runtime ([server/desk.ts:976](server/desk.ts#L976)). An identical file is stopped here by content hash, before any agent runs.
2. **The Extractor writes its result.** Its handler starts one Mozaik loop ([server/desk.ts:509](server/desk.ts#L509)). The loop's only way to leave a result is its `submit_reading` tool, which is validated with zod, bound to this case and this attempt, and writes the `extraction` slot. Then `extraction.completed` is published ([server/desk.ts:531](server/desk.ts#L531)).
3. **One event starts two independent agents.** Validator and Auditor both subscribe to `extraction.completed` ([server/desk.ts:876](server/desk.ts#L876)). Neither waits for the other.
4. **Shared state receives both findings.** Each writes its own slot (`validation`, `audit`) and publishes its own completion event ([server/desk.ts:674](server/desk.ts#L674), [server/desk.ts:703](server/desk.ts#L703)).
5. **Code compares and derives challenges.** The Firewall participant reacts to both completion events, and acts only when both slots are done ([server/desk.ts:882](server/desk.ts#L882)). `assess` runs the controls and derives cross-agent challenges from shared state ([server/desk.ts:295](server/desk.ts#L295), [server/challenges.ts:17](server/challenges.ts#L17)).
6. **An exception starts the Investigator.** If any control fails or needs review, the Firewall publishes `investigation.requested`; otherwise `policy.requested` ([server/desk.ts:887](server/desk.ts#L887)). The Investigator subscribes only to the first ([server/desk.ts:878](server/desk.ts#L878)).
7. **Policy receives the findings.** It runs on `policy.requested` or `investigation.completed` and is given the controls, the challenges and the investigation ([server/desk.ts:757](server/desk.ts#L757)).
8. **Code decides what is allowed.** `enforce` takes the recommendation and the strictest disposition the controls allow, and keeps the stricter ([server/desk.ts:796](server/desk.ts#L796), [server/firewall.ts:18](server/firewall.ts#L18)).

No function calls the agents in sequence. Removing the Mozaik runtime removes the workflow.

## Proof A: genuine orchestration

| | |
|---|---|
| Runtime | `defineRuntime<DeskState>()` and `initializeRuntime({ state })`, [server/desk.ts:73](server/desk.ts#L73) |
| Agents | Five `createAgent` participants (a sixth, the single-agent baseline, joins only for the benchmark), [server/desk.ts:381](server/desk.ts#L381) |
| Other participants | Desk, Firewall and Observer, joined with the agents at [server/desk.ts:909](server/desk.ts#L909) |
| Event handlers | `setHandlers` with `SituationHandler`s over semantic event types, [server/desk.ts:874](server/desk.ts#L874) |
| Loops | `runLoop(agentId, message, { model, context, tools }, interception)`, one per agent per case, each with its own `ModelContext`, [server/desk.ts:416](server/desk.ts#L416) |
| See it | Agent Activity → Execution details lists every loop and the count of each Mozaik event type the Observer saw |
| Test | `server/test/workflow.test.ts`, every test: the real runtime with a scripted model |

## Proof B: parallel execution

| | |
|---|---|
| Why it is parallel | Two handlers on one event, two loops, no shared await ([server/desk.ts:876](server/desk.ts#L876)) |
| Recorded | Every loop stores real start and finish timestamps on its case (`AgentRun`, [server/domain.ts](server/domain.ts)) |
| Test | "the Validator and the Auditor run in parallel after the Extractor": the recorded intervals overlap and Policy starts after both ([server/test/workflow.test.ts:46](server/test/workflow.test.ts#L46)) |
| Live record | In the stored live run the two loops overlap on all five showcase documents, for example 3.6 s on `INV-2026-1049`. Open *Watch the recorded execution* → scenario 3 → *Execution record* |
| Not claimed | A speed-up factor. Summed agent time divided by wall time is not a measured sequential baseline, and none was measured |

## Proof C: shared state

| | |
|---|---|
| Type | `DeskState extends RuntimeState`: the cases, the trusted records and the policy ([server/desk.ts:56](server/desk.ts#L56)); a case is `PaymentCase` in [server/domain.ts](server/domain.ts) |
| Who writes what | One slot per agent (`extraction`, `validation`, `audit`, `investigation`, `decision`), written only through that agent's submit tool. Controls, ledger, challenges and exposure are written by code |
| Stale writes | A result from an older attempt of the case is discarded ([server/desk.ts:460](server/desk.ts#L460)) |
| Test | "cases stay apart: one document's challenge, output checks and late results never appear on another" (`server/test/intelligence.test.ts`) |

## Proof D: independent verification

| | |
|---|---|
| Code | `runAuditor` starts its loop with the document and its own submit tool, and nothing else ([server/desk.ts:680](server/desk.ts#L680)). The Validator, by contrast, gets the Extractor's reading and never the document ([server/desk.ts:647](server/desk.ts#L647)) |
| Test | The Auditor's captured input contains no value and no tool name from the Extractor ([server/test/intelligence.test.ts:222](server/test/intelligence.test.ts#L222)) |
| Test | Fault injection: the Extractor's amount is altered after the model answered; the Auditor's own reading differs, a challenge is raised, the payment is blocked (`intelligence.test.ts`, "fault injection: an Extractor amount altered…") |

## Proof E: cross-agent challenges change what happens next

Synthetic document `INV-2026-1049`: the cover text asks for EUR 1,980.00, the invoice total is EUR 1,890.00.

| Step | What is on record |
|---|---|
| Auditor | Reports both amounts, each with its line |
| Code | `CH:contradiction:gross:1`, raised by the Auditor: `1980.00` (line 7) against `1890.00` (line 23), status `requires_human_verification` ([server/challenges.ts:17](server/challenges.ts#L17)) |
| Downstream | The Investigator is started; the challenge is in its input and in the Policy agent's input (`challengeBrief`, [server/desk.ts](server/desk.ts)) |
| Enforcement | Held for a person under rule R14 |
| Resolution | A verified vendor confirmation for this vendor, invoice and amount moves the challenge to `matched_to_record`; a reviewer's statement moves it only to `accepted_by_reviewer`; a line of the invoice never settles it |
| See it | Showcase scenario 3 → *Inspect agent challenge* |
| Tests | `server/test/intelligence.test.ts` (challenge protocol), `server/test/resolution.test.ts` (how it ends), `server/test/showcase.test.ts` |

## Proof F: deterministic authority

| | |
|---|---|
| Controls | Every control is a function of shared state, trusted records and the policy. No model is called in [server/firewall.ts](server/firewall.ts) (`evaluate`, line 171) |
| Enforcement | `stricter(recommendation, floor)` ([server/desk.ts:796](server/desk.ts#L796)). A looser recommendation is overridden and logged |
| Human actions | All go through `act` on the server ([server/desk.ts:1118](server/desk.ts#L1118)): a blocked payment cannot be approved, a discrepancy needs a statement or a matching record, a draft exists only for an approved payment ([server/desk.ts:1231](server/desk.ts#L1231)) |
| Tests | In most workflow tests the scripted Policy agent recommends approval for everything, and the controls still hold (`workflow.test.ts` 2, 3, 4, 6, 7, 8). Direct API attempts: `api.test.ts`, `resolution.test.ts` |

## Proof G: evidence integrity

| | |
|---|---|
| Building | Every value an agent reports carries a verbatim quote; code locates the quote in the document and checks that it contains the value ([server/firewall.ts:83](server/firewall.ts#L83)) |
| Re-verification | A separate pass goes back to the document and the trusted records for every ledger entry and blocks the payment if critical evidence does not hold ([server/integrity.ts:51](server/integrity.ts#L51)) |
| Model output | Citations to evidence that does not exist are removed and recorded; invented policy rules change nothing (`knownRefs`, `outputCheck` in [server/desk.ts](server/desk.ts)) |
| See it | Any `line N` reference in the app opens the cited lines; Evidence & Audit shows the integrity counts |
| Tests | `lab.test.ts` ("evidence integrity: each kind of broken evidence is caught", "evidence that fails re-verification blocks the payment"), `intelligence.test.ts` ("well-formed but wrong…") |
| Limit | Code can check that a quote is in the document and contains the value. It cannot know which of two stated values is owed; that takes an independent record |

## Proof H: reproducibility

Run on Node 20.20.2, 22.23.5 and 26.8.2 (macOS, Apple silicon), from a copy that holds only the files in the repository.

| Command | Result |
|---|---|
| `npm ci` | installs from the lockfile |
| `npm run typecheck` | passes |
| `npm test` | 114 of 114, nine files, about 4 seconds |
| `npm run build` | passes |
| `npm run lab` | 12 of 12 stress scenarios |
| `npm run demo` | builds and serves the scripted showcase on http://localhost:8799 |
| `npm run test:browser` | 17 of 17 (Node 22 or newer and a local Chrome or Chromium) |

GitHub Actions runs the first five on Node 20 and 22 ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## What is not proven here

Anything about live language models on this version. The scripted model replays fixed answers, so these proofs cover the orchestration, the controls and the evidence checks. The stored live run is from an earlier version. `DEMO_READINESS.md` and `FINAL_RELEASE_REPORT.md` say exactly what was and was not run.
