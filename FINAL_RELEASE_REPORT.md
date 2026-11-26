# Payment Desk · final release report

26 November 2026, late evening CET. This report is part of the release committed on top of `0a0fec6`. Everything marked as run was run in this pass; nothing is carried over from earlier reports without being re-run.

## A. Summary

| | Status | Evidence |
|---|---|---|
| Scripted showcase | **READY** | 17 browser checks, 114 tests, a fresh copy of the repository files runs `npm ci && npm run demo` to four confirmed scenarios |
| Live AI showcase | **BLOCKED** | Two single live calls, at 22:58 and 23:38 CET: both refused, no provider credit. Not retried further |
| Financial safety | **VERIFIED WITHIN TESTED SCOPE** | Sections C and G. Not a claim of absolute safety |
| Local demo | **READY** | Section F |
| GitHub submission | **READY**, with live models unverified | On GitHub. CI passed on commit `4c5b2ba` (Node 20 and 22, Linux): install, types, tests, build, lab. The run before it failed at `npm ci` and found a real defect (section F) |
| Public hosted deployment | **OUT OF SCOPE** | No sign-in; the server answers on the local machine only |
| Production banking deployment | **OUT OF SCOPE** | Synthetic data, sandbox drafts |

Most important changes in this pass: a discrepancy about an amount can now be **resolved with independent evidence** instead of only accepted on a statement; the server no longer listens on the network or accepts requests from other sites; CI, an architecture proof with file and line, a judge Q&A and synchronised pitch documents.

Remaining blocker, external: provider credit (live verification, live Stress Lab, benchmark).

## B. Judging criteria, with evidence and limits

| Criterion | What can be shown | What cannot |
|---|---|---|
| Financial usefulness (30) | Receive, extract, verify, investigate, review, resolve with a trusted record, sandbox draft. Changed account, duplicate, arithmetic, limits, unknown vendor, missing evidence, contradiction, zero or negative amount. `DEMO_GUIDE.md` | No measured saving. Text documents only. Trusted records are fixtures |
| Multi-agent on Mozaik (30) | One runtime, typed shared state, five agents on semantic events, Validator and Auditor in parallel, Auditor independent by input, challenges that start the Investigator, code enforcement. `ARCHITECTURE_PROOF.md` with file and line | No live run on this version. The benchmark of one agent against five has never completed |
| Working implementation (25) | Fresh copy: `npm ci`, typecheck, 114 tests, build, lab, `npm run demo`, 17 browser checks. Node 20.20.2, 22.23.5, 26.8.2. CI workflow | CI not yet run on GitHub. macOS only tested; POSIX shell needed |
| Financial data integrity (15) | Integer minor units; every value with a located quote or record; independent re-verification that blocks; a cited line is never called verification; unmeasured figures shown as unmeasured | Agreement of two readers is not proof; some field kinds cannot be checked mechanically |

Self-assessment, not an official score: 82 of 100 (`HACKATHON_SCORECARD.md`).

## C. Financial safety

**Finding.** Before this pass a document that states two payable amounts could only be *accepted* by a reviewer on a written statement. That was labelled honestly, but the product could detect the problem and not resolve it.

**Change.** A vendor confirmation is a new kind of trusted record (`server/data/confirmations.json`): reference, vendor, invoice number, payable amount, currency, source, time, version, status. A reviewer attaches one with `verify_amount`. Code requires the same vendor, invoice and currency and the status `verified`.

| The record… | Result |
|---|---|
| states the amount the payment would pay | The cross-check becomes `matched_to_record`; a person still approves; the approval cites the record |
| states another amount | The payment is blocked; the record is evidence against it |
| is for another vendor or invoice, is unverified, unknown or malformed | Refused with one message; nothing is attached; the attempt is on record |

A line of the invoice still never settles the question, and a statement without a record is still `accepted_by_reviewer`, not verified. Rule R14 was extended to say this; the policy is `v6`. Both stated amounts and their sources stay on the case.

**Callbacks re-checked.** A callback clears only its own vendor and exact account; another vendor's real reference is refused; the vendor master is never modified; the original discrepancy stays in the history; a person still approves.

**Defect found and fixed (PD-17, P1).** The server listened on every network interface with no sign-in and accepted state-changing requests from any origin. Anyone on the same network could approve a payment, and any web page open in the same browser could start a run that spends model credit. It now listens on 127.0.0.1, refuses foreign hostnames and refuses state-changing requests from other sites.

**Remaining restrictions.** Trusted records are synthetic fixtures; the application contacts nobody. One demo reviewer, no roles.

## D. Live model verification

| | |
|---|---|
| Provider and models configured | Anthropic; `claude-haiku-4-5` (Extractor, Validator, Policy) and `claude-sonnet-5-5` (Auditor, Investigator) |
| Attempts in this pass | One live Stress Lab scenario at 22:58 CET and one at 23:38 CET on 26 Nov: provider refused both, each reported "could not be judged" |
| Stages 1 to 3 (legitimate, account mismatch, contradictory amount) | **Not run** |
| Live Stress Lab | **Not run** |
| Current version verified with live models | **No** |
| What exists | A stored live run of an earlier version, replayable in the app: three of five showcase documents decided |

No `LIVE_VERIFICATION.md` was written, because there is nothing to put in it.

## E. Benchmark

Method unchanged: one agent on the stronger model against the five-agent workflow, same documents, lookup, controls and enforcement; raw recommendations counted apart from enforced outcomes. **Never completed.** No result is shown anywhere, and no superiority is claimed.

## F. Reproducibility

A fresh folder holding only the files that are or would be in the repository (115 when it was run): no `node_modules`, no `.env`, no saved state, no build output.

| Step | Result |
|---|---|
| `npm ci` | installs with npm 10.8.2 on Node 20 and 22, and with npm 11.19.1 on Node 26 |
| `npm run typecheck` | 0 errors |
| `npm test` | 114 of 114 |
| `npm run lab` | 12 of 12 |
| `npm run demo` | serves the app on :8799; four scenarios run to *confirmed* over the API |
| `npm run test:browser` | 17 of 17 |

**What the first CI run found (PD-19).** `npm ci` failed on the runner: npm 10, which ships with Node 20 and 22, rejected the lockfile over an optional peer dependency inside the Mozaik packages. The clean-copy checks above had all been done with npm 11, which accepts it, so they missed this. An `overrides` entry and a lockfile regenerated with npm 10 fix it; the table above was re-run with both npm versions after the fix. Without CI this would have reached the judges.

Node: `^20.19.0 || >=22.12.0` in `package.json`, which is what the build tool requires. The test suite was run on 20.20.2, 22.23.5 and 26.8.2; build and lab also on 20.20.2. The browser checks need Node 22 or newer and say so when run on 20.

## G. Automated testing

| Suite | Result |
|---|---|
| `npm test` | 114 passed, 0 failed, nine files |
| `npm run lab` | 12 passed, 0 failed, 0 not judged |
| `npm run test:browser` | 17 passed, 0 failed |
| Live Stress Lab, benchmark | blocked |
| `npm audit --omit=dev` | 0 vulnerabilities |

New in this pass: `server/test/resolution.test.ts` (12 tests) and one test in `api.test.ts`. The browser suite once ended at startup with an uncaught error when the headless browser was slow; it now retries the browser start once and reports anything that stops it as "not run".

## H. Security, for a local sandbox

| Checked | Result |
|---|---|
| Bind address | Was all interfaces; now 127.0.0.1 (PD-17) |
| Cross-site and foreign-host requests | Now refused; tested |
| Secrets | None in the repository, in Git history (searched for key patterns), in any API response or in the built UI |
| Input | Body size limit, JSON object required, path escapes handled, static files confined to the build folder; references of the wrong type are treated as empty |
| Rendering | Document text and model output are rendered as text, never as HTML |
| Spending | One retry at most; no retry on a credit or key failure and a 60-second hold after one; a scenario cannot run twice; a live Stress Lab run needs explicit confirmation; replay and navigation call no model |
| Dependencies | `npm audit` clean; nothing added |

Not addressed, by design: authentication, roles, rate limiting, TLS. Local demo readiness is not public deployment readiness, and neither is production readiness.

## I. Presentation

| | |
|---|---|
| README | Rewritten top: what it is, who it is for, *What to verify in three minutes* with code and test for each claim |
| `ARCHITECTURE_PROOF.md` | New: eight claims with file, line and test |
| `JUDGE_QA.md` | Twenty-seven questions |
| `DEMO_GUIDE.md`, `DEMO_READINESS.md`, scorecard, QA report, test matrix | Brought in line with this release |
| Pitch (`PITCH.md`, `PITCH-EN.md`, outside the repository) | Rewritten: 15 seconds, 60 seconds, three-minute demonstration on the showcase, and what not to say |
| Showcase | Four acts plus an optional resolution inside the third |

## J. Changed files

| Area | Files | Why |
|---|---|---|
| Resolution with a record | `server/data/confirmations.json`, `server/domain.ts`, `server/data.ts`, `server/firewall.ts`, `server/desk.ts`, `server/challenges.ts`, `server/integrity.ts`, `server/data/policy.json` | Vendor confirmation as a trusted record, the control that applies it, the action that attaches it |
| Local-only server | `server/index.ts`, `web/vite.config.ts` | PD-17 |
| Interface | `web/src/components/PaymentDetail.tsx`, `bits.tsx`, `web/src/views/Showcase.tsx`, `web/src/lib/api.ts`, `web/src/styles/views.css` | The confirmation field, the resolution panel in scenario 3, wording |
| Tests | `server/test/resolution.test.ts`, `api.test.ts`, `lab.test.ts`, `scripts/browser-smoke.mjs` | Regression coverage |
| Release | `.github/workflows/ci.yml`, `package.json`, `package-lock.json` | CI; the Node range that was actually tested |
| Documents | `README.md`, `ARCHITECTURE_PROOF.md`, `JUDGE_QA.md`, `FINAL_RELEASE_REPORT.md`, and the six existing reports | Accuracy |

Decisions worth knowing: text-layer PDF intake was **not** built (a parser plus page-aware evidence locations, with no time to test them properly). The browser checks are **not** in CI (untested on a runner). No dependency was added or upgraded.

## K. Git

| | |
|---|---|
| Branch | `main` |
| Last pushed commit | `0a0fec6`, equal to `origin/main` |
| This release | Committed on top of `0a0fec6` |
| CI workflow | `.github/workflows/ci.yml`. Pushing a workflow file needs a credential with the `workflow` scope |

## L. Owner actions

1. Add provider credit. Then, in order and stopping at the first failure: `npm run dev` → **Start demo** → scenarios 1, 2, 3; then `npm run lab:live`; then `npm run lab:benchmark`. Record what happens, whatever it is.
2. Resubmit the repository on build.jigjoy.ai.
3. Update the repository description on GitHub: it still says "Four concurrent Mozaik agents … SEPA payment drafts".
4. Rehearse the three-minute demonstration once on `npm run demo`.
