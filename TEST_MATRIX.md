# Payment Desk · test matrix

Status of each behaviour as of 26 November 2026. PASS means the named test or check was run and passed. "Scripted" means the real Mozaik runtime with fixed agent output. "Browser" means a scripted headless-browser check against the built app on the scripted server; these are not part of `npm test`.

Run everything automated with `npm test`; run one file with `node --import tsx --test server/test/<file>`.

## Financial safety

| ID | Scenario | Expected | Status | Where |
|---|---|---|---|---|
| F-01 | Clean invoice, known vendor, within limits | Approved automatically, sandbox draft | PASS | `workflow.test.ts` 1, `safety.test.ts` control case |
| F-02 | Changed beneficiary IBAN | Blocked whatever the Policy agent recommends | PASS | `workflow.test.ts` 2 |
| F-03 | Changed IBAN, wrong callback reference | Stays blocked (422) | PASS | `workflow.test.ts`, `http.test.ts` |
| F-04 | Changed IBAN, matching callback reference | Moves to needs approval, callback in the ledger | PASS | `workflow.test.ts` |
| F-05 | Invalid IBAN checksum | Blocked | PASS | `firewall.test.ts` 3, `workflow.test.ts` 3 |
| F-06 | Unknown vendor | Blocked, no approve action | PASS | `workflow.test.ts` 7 |
| F-07 | Duplicate invoice in the inbox | Not authorised twice | PASS | `workflow.test.ts` 4 |
| F-08 | Invoice already in payment history | Blocked | PASS | `workflow.test.ts` 4b |
| F-09 | Same document under another file name | Stopped at intake, no agent run | PASS | `workflow.test.ts` 5 |
| F-10 | Total does not add up | Detected, shown with its inputs | PASS | `workflow.test.ts` 6 |
| F-11 | Two different amounts in one document | Needs approval; both amounts sourced; Investigator called | PASS | `api.test.ts` |
| F-12 | Approving F-11 with no statement, or a token one | Refused (422), also by direct API call | PASS | `api.test.ts`, `http.test.ts` |
| F-13 | Approving F-11 with a stated resolution | Allowed; record cites the evidence | PASS | `api.test.ts` |
| F-14 | Missing mandatory field (IBAN) | Blocked; no value taken from another record | PASS | `workflow.test.ts` 8 |
| F-15 | Above the per-payment limit | Needs approval; a person can approve | PASS | `workflow.test.ts` 9 |
| F-16 | Daily limit with decisions landing together | Total never exceeds the budget | PASS | `workflow.test.ts` 10+11, `lab.test.ts` |
| F-17 | Possible split across related requests | Reviewed, not called fraud | PASS | scenario S12, `lab.test.ts` |
| F-18 | Prompt injection in a document | Policy unchanged even if agents go along | PASS | `workflow.test.ts` 12 |
| F-19 | **Zero amount** | Blocked; no draft; a person cannot approve | PASS (was FAIL: PD-01) | `safety.test.ts` |
| F-20 | **Negative amount (credit note)** | Blocked; no draft | PASS | `safety.test.ts` |
| F-21 | Very large amount | Exact in minor units; needs approval | PASS | `safety.test.ts` |
| F-22 | Other currency | Blocked; kept apart from EUR totals | PASS | `workflow.test.ts` 18b, `firewall.test.ts` 18 |
| F-23 | Money arithmetic | Integer minor units; 0.10 + 0.20 = 0.30; an oversize number is refused, not rounded | PASS | `firewall.test.ts`, `safety.test.ts` |
| F-24 | Evidence that fails re-verification | Blocks the payment whatever the agent says | PASS | `lab.test.ts` |
| F-25 | Every reported amount has a ledger entry | Each resolves to a source, a record or a calculation | PASS | `workflow.test.ts` 17 |

## Decisions, drafts and state

| ID | Scenario | Expected | Status | Where |
|---|---|---|---|---|
| D-01 | Approve a blocked payment | Refused (409), recorded | PASS | `http.test.ts`, `safety.test.ts` |
| D-02 | Approve the same payment five times at once | One applied, four refused | PASS | `api.test.ts` |
| D-03 | Approve and reject at the same instant | Exactly one wins; state and draft agree with it | PASS | `api.test.ts` |
| D-04 | Draft for a blocked, waiting, rejected or non-payment case | None (409) | PASS | `api.test.ts`, `workflow.test.ts` 16 |
| D-05 | Draft content | Sandbox flag; amount equals the authorised amount | PASS | `api.test.ts`, `http.test.ts` |
| D-06 | Reprocess an approved payment | Refused | PASS | `workflow.test.ts` 15, `api.test.ts` |
| D-07 | Reprocess a payment a person rejected | Refused | PASS (was FAIL: PD-05) | `api.test.ts` |
| D-08 | Reprocess a blocked document | Same answer; nothing counted twice | PASS | `workflow.test.ts` 15 |
| D-09 | Start a run while one is in progress | Refused (409); each document ends once, as expected | PASS (was FAIL: PD-04) | `api.test.ts` |
| D-10 | Server killed milliseconds after a decision | Decision, review history, evidence and execution records survive the restart; still not approved twice | PASS (was FAIL: PD-03) | `api.test.ts` |
| D-11 | A page open during a run | Holds the same state, amounts, evidence and approved total as the server | PASS (was FAIL: PD-06, PD-07) | `api.test.ts` |
| D-12 | Every decision and refusal is in the audit trail | Reviewer, time, from, to, reason | PASS | `http.test.ts`, `api.test.ts` |

## Agents and orchestration

| ID | Scenario | Expected | Status | Where |
|---|---|---|---|---|
| A-01 | Validator and Auditor after the Extractor | Run in parallel | PASS (scripted); observed in the recorded live run on 14 of 14 documents | `workflow.test.ts`, `QA_REPORT.md` |
| A-02 | Auditor reads a different amount | Blocked and investigated | PASS | `workflow.test.ts` 13, scenario S10 |
| A-03 | Validator report contradicts the records | Caught and reviewed | PASS | `workflow.test.ts` 13b |
| A-04 | Extractor, Validator, Auditor or Policy fails | Processing error; nothing approved; runs again cleanly | PASS (fault injection) | `safety.test.ts` |
| A-05 | Loop left over from a superseded attempt | Stops before its next model call | PASS | `workflow.test.ts` 14c |
| A-06 | Expected outcomes never reach an agent | Not in any prompt | PASS | `lab.test.ts` |
| A-07 | Stress Lab run is isolated | Own process; inbox untouched | PASS | `lab.test.ts`, `http.test.ts` |
| A-08 | Genuine execution with live models | Workflow completes | **BLOCKED**: provider credit exhausted | `npm run lab:live` |
| A-09 | Single agent against multi-agent benchmark | Recorded comparison | **BLOCKED**: live only, never run | `npm run lab:benchmark` |
| A-10 | Malformed output: invalid or truncated JSON, missing field, wrong type, unknown disposition, nesting, oversize, refusal, empty | Never an approval; one correction, then a processing error; the failure is recorded | PASS (fault injection; invalid JSON was FAIL: PD-13) | `intelligence.test.ts` |
| A-11 | Well-formed but wrong: unsupported amount, negative amount, unknown currency | Blocked | PASS (fault injection) | `intelligence.test.ts` |
| A-12 | Invented rule, control and evidence ids in a recommendation | Removed, recorded, no effect on enforcement | PASS (fault injection) | `intelligence.test.ts` |
| A-13 | Provider says no credit, or refuses the key | Not retried; later calls not sent; nothing approved; clears when a person runs a document again | PASS (fault injection) | `intelligence.test.ts` |
| A-14 | Provider outage | Retried once; completes, or stops after the second try | PASS (fault injection) | `intelligence.test.ts` |
| A-15 | A disagreement becomes a challenge with two sides and their evidence | One challenge per disagreement; reaches the Investigator and the Policy agent | PASS | `intelligence.test.ts` |
| A-16 | The Auditor's input | The document, and nothing from the Extractor | PASS | `intelligence.test.ts` |
| A-17 | Extractor amount altered after the model answered | Challenged by the Auditor's reading; blocked; investigated; labelled | PASS (fault injection) | `intelligence.test.ts` |
| A-18 | Settling by source line | Wrong line refused; right line recorded as resolved with evidence; both sides kept | PASS | `intelligence.test.ts`, Browser |
| A-19 | Settling by statement | Recorded as an assertion; challenge stays unresolved | PASS | `intelligence.test.ts` |
| A-20 | Changed account settled by a matching callback | Challenge kept and marked as matched to a callback record | PASS | `workflow.test.ts` |
| A-21 | Challenges, output checks and evidence stay on their own case | No cross-case reference | PASS | `intelligence.test.ts` |

## API and input handling

| ID | Scenario | Expected | Status | Where |
|---|---|---|---|---|
| I-01 | Body is `null`, a number, a string, an array, or not JSON | 400 | PASS (was FAIL: PD-08) | `api.test.ts` |
| I-02 | Malformed percent-escape in an address | 400 | PASS (was FAIL: PD-09) | `api.test.ts` |
| I-03 | Unknown case, document, action, scenario or run | 404 or 400 | PASS | `api.test.ts` |
| I-04 | Oversized request | 413 | PASS | `api.test.ts` |
| I-05 | Empty, short, binary or over-long document | 400, 415 or 413; no case created | PASS | `api.test.ts` |
| I-06 | Hostile file name and HTML in the text | Safe identifier; text stored and served as plain text; not approved | PASS | `api.test.ts` |
| I-07 | Path traversal against the static server | Nothing outside the built UI is served | PASS | `api.test.ts` |
| I-08 | Model key in any response | Absent | PASS | `api.test.ts` |
| I-09 | Live Stress Lab run without confirmation | Never started | PASS | `api.test.ts` |
| I-10 | PDF or image upload | Refused with a plain explanation | PASS | Browser |

## Interface

| ID | Scenario | Expected | Status | Where |
|---|---|---|---|---|
| U-01 | Overview figures against server state, page open during a run | Equal | PASS (was FAIL) | Browser, `api.test.ts` |
| U-02 | Review Queue: discrepancy | Primary action is to request verification; approval disabled until a resolution is written | PASS | Browser |
| U-03 | Review Queue: limit only | Plain approve | PASS | Browser |
| U-04 | Blocked payment | No approve action; reject works | PASS | Browser |
| U-05 | Rapid selection of rows | Detail always belongs to the selected payment | PASS | Browser |
| U-06 | Search by vendor, invoice and IBAN (with or without spaces, padded, hostile text), status filter, arrow keys | Work; an empty result says so | PASS (IBAN with spaces was FAIL: PD-12) | Browser |
| U-07 | Evidence reference | Opens the inspector; Escape closes; inert when closed | PASS | Browser |
| U-08 | Payment Firewall | Differing account groups marked; findings expand | PASS | Browser |
| U-09 | Agent Activity, live | States and handoffs follow real events | PASS (scripted) | Browser |
| U-10 | Agent Activity, replay | Recorded order; pause, seek, payment switch leaves no stale handoff; calls no agent | PASS | Browser |
| U-11 | Agent inspector | Opens by pointer and by keyboard | PASS | Browser |
| U-12 | Reduced motion | No handoffs, no movement, states still change | PASS | Browser |
| U-13 | Evidence & Audit | Filters, grouping, scenario check | PASS | Browser |
| U-14 | Stress Lab | A scenario runs and reports | PASS (scripted) | Browser |
| U-15 | Appearance, back and forward | Work | PASS | Browser |
| U-16 | Server stops and returns under an open page | Says so, pauses actions, reconnects, shows the server's real state | PASS | Browser |
| U-17 | Horizontal overflow, ten routes, nine widths | None | PASS | Browser |
| U-18 | Text contrast, seven pages, both appearances | WCAG AA | PASS | Browser, measured from pixels |
| U-19 | Automated browser suite in the repository | A smoke suite of the showcase | PASS, 16 of 16 | `npm run test:browser` |

## Interactive showcase

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| S-01 | Four scenarios, one at a time | Each result is the outcome the controls enforced, compared with `scenarios.json` | PASS | `showcase.test.ts`, browser |
| S-02 | Same scenario started twice, or two at once, or a second demo start mid-run | One run, one approval; the rest refused with 409 | PASS | `showcase.test.ts` (in process and over HTTP) |
| S-03 | A scenario whose agent fails | Reported as an execution failure, never as confirmed; earlier results unaffected; can be run again as a second attempt | PASS | `showcase.test.ts`, browser |
| S-04 | An outcome the scenario file does not expect | Reported as unexpected | PASS | `showcase.test.ts` |
| S-05 | A person approves the held payment afterwards | The scenario result stays what the workflow decided | PASS | `showcase.test.ts` |
| S-06 | Demo start, restart and reset next to a person's own document | Their document, decisions, draft and callback verification are untouched (was FAIL: PD-15) | PASS | `showcase.test.ts` |
| S-07 | A person's document already uses a scenario's id | The scenario does not take it over | PASS | `showcase.test.ts` |
| S-08 | Execution mode | A scripted server says scripted everywhere and never "Live AI"; a live server without a key runs nothing and substitutes nothing | PASS | `showcase.test.ts`, browser |
| S-09 | Recorded execution | Served as stored; not on the desk; no action possible; no model call; documents served only when they are the recorded ones | PASS | `showcase.test.ts`, browser |
| S-10 | Citing the line with the payable amount on a contradictory document | Not an approval without a written statement; never shown as verified (was FAIL: PD-14) | PASS | `intelligence.test.ts`, `showcase.test.ts` |
| S-11 | Auditor and code find the same two amounts | One cross-check on record (was FAIL: PD-16) | PASS | `intelligence.test.ts` |
| S-12 | A figure in the showcase | Opens the cited line of the document or the trusted record | PASS | browser |
| S-13 | Provider refuses every call (injected, labelled) | Banner with the kind and the advice; scenario failed; nothing approved; nothing confirmed | PASS | browser |
| S-14 | Showcase at 375 to 1920 px, dark and light, reduced motion | No horizontal overflow; outcome before the tall stage on a phone; no automatic replay with reduced motion | PASS | Browser, looked at |
| S-15 | A showcase scenario with live models | | BLOCKED (provider credit) | |
