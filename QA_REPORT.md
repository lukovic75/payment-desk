# Payment Desk · QA report

Stabilisation pass of 26 November 2026. Everything here was run; nothing is inferred from reading the code. Where a check could not be run, it says BLOCKED and why.

## Environment

| | |
|---|---|
| Runtime | Node 26.8.2, npm, macOS (Apple silicon) |
| Stack | TypeScript, `node:http` server, React 19 + Vite, `@mozaik-ai/core` 6.0.0, state in one JSON file (`.desk-state.json`) |
| Model for tests | Scripted fixture on the real Mozaik runtime. Loops, tools, events, controls and enforcement are the production code; only the agents' words are fixed |
| Live models | **BLOCKED.** The provider answers `400 … credit balance is too low`. Checked again in this pass with one live Stress Lab scenario, which reported "could not be judged" |

## Baseline, before any change in this pass

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 46 of 46 pass |
| `npm run build` | pass |
| `npm run lab` (12 scenarios, scripted) | 12 of 12 pass |
| Lint | NOT APPLICABLE: the project has no linter |
| `npm audit --omit=dev` | 0 vulnerabilities |

After the fixes, the working tree was copied without `node_modules`, `.env` and saved state, and `npm ci`, `npm run typecheck`, `npm test` (64 of 64), `npm run build` and `npm run lab` (12 of 12) all passed in the copy.

A green baseline, and still twelve defects underneath it. None of them was visible to the existing tests.

## Confirmed defects

| ID | Sev | Defect | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| PD-01 | **P0** | An invoice for **0.00** from a known vendor was approved automatically and received a sandbox draft for 0.00 | No control looked at the sign of the amount | New deterministic control `payable_amount` (policy rule R15): zero or negative is blocked, cannot be approved by a person, has no draft | `safety.test.ts`: zero, negative |
| PD-02 | P1 | A payment with conflicting amounts (1,890.00 against 1,980.00) could be approved with one request and no explanation, through the API as well as the UI | `act()` treated every "needs approval" case alike | The server refuses the approval (422) unless the reviewer states how the discrepancy was resolved (at least 10 characters); the approval record cites the evidence the discrepancy rests on. A payment that is only above a limit is unaffected | `api.test.ts`, `http.test.ts` |
| PD-03 | P1 | A person's decision was not on disk when the request returned. State was written after 150 ms of quiet, and never while agents kept working. Killing the server in that window lost the approval | A debounce with no upper bound, shared by agent progress and human decisions | Decisions and refused attempts are written before the response; agent progress is written at the latest 1 s after the first unsaved change; SIGINT and SIGTERM flush | `api.test.ts`: server killed milliseconds after a decision |
| PD-04 | P1 | `POST /api/run` and `/api/reset` were accepted while a run was in progress, replacing the cases under loops that were still running | No guard on the server; only the UI disabled the button | 409 while any demo document is in flight | `api.test.ts` |
| PD-05 | P2 | `reprocess` was accepted for a payment a person had rejected, which silently undid the decision | The action only refused approved payments | Only a blocked or failed document is run again | `api.test.ts` |
| PD-06 | P2 | On a page left open during a run, "Auto-approval limit used" stayed at its old value (observed: 0% against a real 48%) until reload | The total was sent only in the first snapshot | The server sends a `totals` event when the figure changes | `api.test.ts`: an open page compared with server state |
| PD-07 | P2 | On an open page, blocked exposure was 6,740.00 lower than the server's figure until reload | A duplicate stopped at intake gets its amount later, from the original; that change was made without an event | A case is announced when its amount or evidence changes, not only its controls | same test |
| PD-08 | P2 | A JSON body that is not an object (`null`, a number, a string) returned 500 | The body was used without a shape check | 400 | `api.test.ts` |
| PD-09 | P2 | A malformed percent-escape in a case or document address returned 500 | `decodeURIComponent` threw | 400 | `api.test.ts` |
| PD-10 | P3 | The static file guard compared path prefixes without a separator | Hardening only; no way to exploit it was found | Exact prefix with separator | `api.test.ts`: five traversal attempts leak nothing |
| PD-12 | P3 | Searching for an IBAN the way the app displays it ("ES66 2100") found nothing | The search compared against the stored form without spaces | A search matches with or without spaces | browser check |
| PD-13 | P2 | A tool call whose arguments were not valid JSON stopped the loop inside the runtime; the document waited 90 s for the loop timeout before failing | The arguments reached the runtime unparsed | Checked before the runtime sees them: discarded, never repaired, and handled as an invalid result (one correction, then a processing error) | `intelligence.test.ts`: invalid and truncated JSON |
| PD-11 | P3 | On an empty desk, Agent Activity showed "One payment" as selected and disabled | Scope state did not fall back | Shows "Whole inbox" until a payment has run | browser check |

| PD-14 | P1 | A document that states two amounts could be approved by pointing at the line with the payable one, with no written statement, and the cross-check was then shown as "resolved with evidence" | Found in the showcase pass. The line proves the amount is in the document; it does not prove which of the two amounts is owed. Rule R14 as written already required a statement | A written statement is always required. A cited line is still re-read and refused if it is not what would be paid, and is recorded as cited. The cross-check ends as "accepted by a reviewer, not verified". "Resolved with evidence" no longer exists as a status; a changed account that matches a callback record ends as "matched to a callback record", and the interface says the desk matches a record and places no call | `intelligence.test.ts`: citing a line approves nothing by itself; `showcase.test.ts` over HTTP |
| PD-15 | P2 | Running or resetting the demo documents removed every callback verification on the desk, including one a person had verified for a document of their own. That document's approved draft then refused to export | `removeDemo` cleared the whole list | Only verifications that no remaining case refers to are removed | `showcase.test.ts`: the demo leaves a person's own documents, decisions and verifications alone (fails on the previous code) |
| PD-16 | P3 | When the Auditor reported the same two amounts that code had already found at intake, both stayed on record as two cross-checks, one of them stuck as "unresolved" | A cross-check that no longer derived was always kept | Only a challenge against the trusted record is kept once it stops deriving; a superseded one is replaced by the Auditor's finding | `intelligence.test.ts`: one disagreement is on record, not two |

| PD-17 | P1 | The server listened on every network interface with no sign-in, and accepted state-changing requests from any web page: a site open in the same browser could start a run that spends provider credit, and anyone on the network could approve a payment | Found in the final release pass. `listen` had no host, and there was no origin or host check | Listens on 127.0.0.1 unless `HOST` says otherwise; requests under a foreign hostname are refused, and so are state-changing requests from another site | `api.test.ts`: only this machine is answered |
| PD-18 | P3 | The browser suite could end with a raw stack trace when the headless browser was slow to open its debugging port | One start, one fixed wait | A second start on another port; anything that stops the suite is reported as "not run" with the reason, exit code 2 | nine consecutive runs after the change |

Resolved: 18 of 18 (one P0, five P1, seven P2, five P3). PD-13 was found in the agent intelligence pass, PD-14 to PD-16 in the showcase pass and PD-17 and PD-18 in the final release pass; see `AGENT_INTELLIGENCE_REPORT.md` and `DEMO_READINESS.md`. For PD-04 the unsafe acceptance was observed (the second call returned 200 and the cases were restarted); damage beyond the restart was not separately demonstrated.

## Policy changes made in this pass, stated explicitly

1. **R15 added:** "The amount due must be greater than zero." Effect: blocked.
2. **R14 clarified:** a disagreement or conflicting statement is approved only with a written statement of how it was resolved. The disposition (needs approval) is unchanged.
3. The policy file is now `v5`. No control was weakened and no scenario expectation was changed to make a test pass.
5. **Final release pass, R14 extended, policy `v6`:** a conflicting amount can now also be settled by a verified vendor confirmation on record for that vendor, invoice and currency that states the amount to be paid; a confirmation that states another amount blocks the payment. This adds a way to resolve with evidence and a new way to be blocked. It removes nothing: a statement alone is still labelled as not verified, and a person still approves.
4. **Showcase pass, no change to the policy text:** the implementation now does what R14 says. Citing a source line no longer approves a contradictory document without a written statement (PD-14). Two tests that asserted the looser behaviour were rewritten to assert the stricter one; no expected financial outcome changed.

## The critical financial safety question

*Can a payment that states two different amounts bypass verification?* Tested on the synthetic fixture `INV-2026-1049` through the real server:

| Step | Result |
|---|---|
| Both amounts detected | PASS: control `stated_amounts` is `review` |
| Each amount has its own source | PASS: two source lines, each located and containing its value, with two different amounts |
| The exception reaches the Investigator | PASS: an Investigator loop is on the execution record |
| A draft exists before resolution | PASS: none (409) |
| Approve by direct API call, no reason | PASS: refused, 422 |
| Approve with a token note ("ok", "approved", spaces) | PASS: refused, 422 |
| Approve with a stated resolution | Allowed. Recorded with reviewer, time, statement and the evidence references. Five refused attempts are on the record beside it |

**What this is and is not.** The policy lets a person resolve a discrepancy, so the product does too. The resolution is a written statement by a clearly labelled demo reviewer; the system does not verify it against anything. Only the changed-bank-account case has machine-checked evidence (a callback reference matched against the trusted record).

## Agent failures seen earlier (1 Investigator, 3 Policy, 4 documents)

Investigated from the stored execution records of the live run of 26 November, 13:04 UTC:

- 67 loops, 63 completed, 4 failed. All four failures carry the same provider message: `400 … Your credit balance is too low`. They happened between 13:05:10 and 13:05:36, the last seconds of the run.
- This is an external failure, not a defect. The four documents ended as "processing error": nothing was approved, no draft exists, and "Run again" is offered.
- The same records show the workflow behaved as designed while credit lasted: Validator and Auditor overlapped on all 14 documents that reached them (3.4 s to 5.8 s each), no loop started before the loop it depends on had finished, at most 28 loops ran at one instant, and the provider reported usage for 65 of 67 loops (369,556 tokens).

## What was executed

| Suite | Kind | Result |
|---|---|---|
| `firewall.test.ts` | deterministic unit | 6 of 6 |
| `workflow.test.ts` | real runtime, scripted model, some with fault injection | 26 of 26 |
| `safety.test.ts` (new) | real runtime, scripted model, fault injection for four agents | 9 of 9 |
| `lab.test.ts` | real runtime, scripted model, isolated processes | 12 of 12 |
| `http.test.ts` | real server over HTTP | 2 of 2 |
| `api.test.ts` (new) | real server over HTTP: validation, races, restart | 9 of 9 |
| `intelligence.test.ts` (added in the following pass) | real runtime, scripted model with one agent's output corrupted | 26 of 26 |
| `intelligence.test.ts`, after the showcase pass | two tests rewritten for PD-14, one added for PD-16 | 27 of 27 |
| `showcase.test.ts` (showcase pass) | real runtime, scripted model, and the real server in scripted and in keyless live mode | 10 of 10 |
| `resolution.test.ts` (final release pass) | vendor confirmation, callback, currency; in process and over HTTP | 12 of 12 |
| `api.test.ts`, one test added for PD-17 | | 10 of 10 |
| **`npm test` total** | | **114 of 114**, about 4 s; also on Node 20.20.2 and 22.23.5 |
| `npm run test:browser` | headless Chrome against the scripted server, in the repository | 17 of 17 |
| Live Stress Lab, one scenario, 26 Nov 22:58 CET | | **BLOCKED** again (provider credit) |
| `npm run lab` | 12 scenarios, scripted | 12 of 12, 87 checks |
| Live Stress Lab, one scenario | genuine Mozaik with live models | **BLOCKED** (provider credit) |
| Benchmark, single agent against multi-agent | live only | **BLOCKED**, never run |

Browser checks, run with a scripted headless Chromium against the built app on the scripted server (not part of `npm test`): 21 flows, all passing after the fixes. They cover a live run followed in Agent Activity, replay with seek and payment switch, the agent inspector by pointer and keyboard, reduced motion, the resolution rule in the UI, limit-only approval, rejection of a blocked payment, overview figures compared with server state on a page open during the run, the firewall comparison and evidence drawer, the audit trail and scenario check, a Stress Lab run, appearance, back and forward, rapid selection of 48 rows with no identity mismatch, upload validation (empty, short, 30 kB, a PDF), and the server stopped and started under an open page. Separately: no horizontal overflow on ten routes at nine widths from 390 to 1920 px, and text contrast measured from pixels on seven pages in both appearances.

## Not tested, or tested only in part

- **Live model behaviour**: BLOCKED. Extraction accuracy on real model output, real rate limiting and real timeouts were not exercised. Malformed output and provider errors by kind are now covered with fault injection. Provider failure, a superseded loop and a failed dependency are covered with fault injection.
- **An Investigator failure** is covered by the recorded live run and Stress Lab scenario S11 covers an Auditor failure; `safety.test.ts` injects failures into the other four agents.
- **Performance** was not profiled. Observed: sixteen documents settle in about 0.1 s on the scripted model and took 46 s with live models; the production bundle is about 150 kB gzipped.
- **Security** was reviewed within the repository only: input validation, traversal, document text served as `text/plain` and rendered as text, no key in any response, `npm audit` clean. There is no authentication and no rate limiting; the app is a local sandbox.

## Remaining known defects

None open at P0 to P2. Limitations that are by design are in `DEMO_READINESS.md` and the README.
