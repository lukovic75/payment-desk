# Payment Desk · agent intelligence report

26 November 2026. What each agent is for, what it is given, what it may do, how the agents check each other, and what has and has not been verified. Five kinds of evidence appear below and are never interchangeable:

| Label | Meaning |
|---|---|
| **Scripted** | Real Mozaik runtime, loops, tools, events, controls and enforcement; the model's words are a fixed fixture |
| **Fault injection** | Scripted, with one agent's output deliberately corrupted or its provider call made to fail. Always labelled in the case's own log |
| **Deterministic** | Code only, no model |
| **Recorded live** | Stored execution records of the live run of 26 Nov 2026, 13:04 UTC (Haiku 4.5 and Sonnet 5.5 through Mozaik), before the changes in this report |
| **Live** | A fresh run with real models. **BLOCKED**: the provider answers `400 … credit balance is too low` |

## Architecture as implemented

```
document.received
      │
  Extractor ──────────────── reads the document, cites a line for every value
      │ extraction.completed
      ├── Validator ───────── given the Extractor's reading and a lookup tool; never the document
      └── Auditor ─────────── given the document only; never the Extractor's reading
      │ validation.completed + audit.completed
  Compare (code) ──────────── controls, evidence re-verification, cross-agent challenges
      │
      ├── Investigator ────── only if a control fails or needs review
      │
  Policy ──────────────────── recommends a disposition, citing rules
      │
  Enforce (code) ──────────── keeps the stricter of the recommendation and what the controls allow
```

Agents are Mozaik agents joined to one runtime. They react to semantic events; no function calls them in sequence. Shared state is the payment case: one slot per agent, written only through that agent's own submit tool, discarded if the case has moved on to a newer attempt.

## The five agents

| Agent | Model | Receives | May do | May not do |
|---|---|---|---|---|
| **Extractor** | fast | The document | Report facts, each with a verbatim one-line quote | Fill a missing value, choose silently between two amounts, judge safety |
| **Validator** | fast | The Extractor's reading; `lookup_trusted_records` | Report what the records show, cite their evidence ids | See the document, describe a record it was not given, approve, call anything fraud |
| **Auditor** | careful | The document, and nothing else | Read the critical values itself; report where the document contradicts itself, both sides | See any other agent's output; decide which side is right |
| **Investigator** | careful | The case file: both readings, findings, failing controls, cross-checks, trusted records, the document | Sort verified from conflicting from unknown; say what would settle each cross-check | Explain why a difference exists without a record that says why; choose a value; approve |
| **Policy** | fast | Controls, cross-checks, the investigation, the policy | Recommend a disposition, naming rules that exist | Invent a rule or a threshold; loosen what the controls require |

Why two readers: the Extractor's reading drives everything downstream, so one misread amount would be validated, investigated and approved consistently wrong. The Auditor reads the same document with no view of the first reading, and code compares the two. Agreement is then two independent observations; disagreement is a challenge.

### What changed in the prompts, and why

| Agent | Change | Reason |
|---|---|---|
| Extractor | Two candidate amounts: report the invoice total, say that another is stated and where; never pick silently. "You report facts; you do not judge." | A silent choice hides the very discrepancy the system exists to surface |
| Auditor | Report both sides of a contradiction; do not decide which is right | Deciding belongs to a person with evidence |
| Validator | Report only what the lookup returned | Closes the door on describing records from memory |
| Investigator | Address every open cross-check; no cause without a record ("no verified account-change evidence is available" is a finding); do not choose between values | An invented explanation reads as a fact to the next reader |
| Policy | Open cross-checks and what they imply; only rule ids, control ids and limits it was given | Rule ids are now checked in code as well |

## Auditor independence

Enforced by input, not by instruction. The Auditor's loop is started with the document and its own submit tool; the Extractor's result is not in its context. **Scripted** test: the Auditor's prompt is captured and contains no value or tool name from the Extractor. **Fault injection**: the Extractor's amount is altered after the model answers; the Auditor's reading differs, code raises `CH:reading:gross`, the payment is blocked and the Investigator is called. **Recorded live**: Validator and Auditor overlapped on 14 of 14 documents (3.4 s to 5.8 s), with no loop starting before the one it depends on.

## Cross-agent challenge protocol (`server/challenges.ts`)

A challenge is a structured disagreement about financial evidence. It is **derived by code** from shared state; no model writes one.

| Field | Content |
|---|---|
| `id`, `caseId` | Stable per case, for example `CH:reading:gross` |
| `raisedBy` | The agent whose independent finding differs (Auditor, Validator) or the comparison in code |
| `category` | `reading_disagreement`, `document_contradiction`, `trusted_record_mismatch`, `report_mismatch` |
| `challenged`, `observed` | Each side: who states it, the value, the evidence reference |
| `required` | What would settle it |
| `status` | `open` → `confirmed_discrepancy` / `requires_human_verification` → `matched_to_record` / `accepted_by_reviewer` / `unresolved` |

Sources: the two readings differing on a field; the Auditor finding the document stating a value two ways; code finding a second payable amount (merged with the Auditor's when it is the same pair); the document's account differing from the vendor master; the Validator's report contradicting the computed check.

Both sides are kept for the life of the case. A settled challenge still shows the two values and how it ended. Challenges reach the Investigator and the Policy agent in their inputs, the Verification tab ("Agent cross-checks", each side linked to its evidence), the workspace narrative, and Agent Activity's collaboration figures.

## How a challenge ends

Revised in the showcase pass (defect PD-14 in `QA_REPORT.md`). Four things are kept apart: evidence that a value is in the document, evidence of which value is authoritative, a reviewer's assertion, and a match with an independent record.

| What happens | What code checks | Recorded as | Is it verification? |
|---|---|---|---|
| A person approves on a **written statement** | That a statement of at least ten characters exists (R14) | `accepted_by_reviewer`, basis `assertion` | No |
| The same, and the person **cites one of the two disputed lines** | Also: the line is one of the two, the quote is in the document, and its value is the amount the payment would pay | `accepted_by_reviewer`, basis `source_cited`, with the line | No. The line shows the value is in the document, not which of two stated values is owed |
| A verified **vendor confirmation** held by the desk matches the vendor, the invoice, the currency and the amount the payment would pay (conflicting amounts only; added in the final release pass) | The reference against `confirmations.json`: vendor, invoice number, currency, status, amount | `matched_to_record`. If the record states another amount: `confirmed_discrepancy`, and the payment is blocked | A match with a record that is independent of the document. The desk does not contact the vendor; the record is a synthetic fixture |
| A **callback record** held by the desk matches the vendor and the exact IBAN (changed account only) | The reference, the vendor and the IBAN against `callbacks.json` | `matched_to_record` | A match with a record. The desk does not place or verify the call, and in this sandbox the record is a synthetic fixture |
| The payment is rejected | | `unresolved` | |

Citing a line is never enough by itself: without the statement the approval is refused. Citing the line that states a *different* amount is refused outright, because the payment would pay something else. A critical reading disagreement (amount, currency, IBAN) and a changed account cannot be accepted by a statement at all. A line of the document never settles which of two amounts is owed; only the vendor confirmation does. Tests: `server/test/resolution.test.ts`.

## Structured output reliability

| Failure | Handling | Evidence |
|---|---|---|
| Arguments not valid JSON, or truncated | Discarded, never repaired; treated as an invalid result. **Was a defect:** the loop died inside the runtime and the document waited for the 90 s loop timeout | Fault injection |
| Missing field, wrong type, unknown disposition, unexpected nesting, oversized, empty object | Schema check fails; one correction is requested; a second failure closes the run as a processing error | Fault injection, 10 variants |
| Refusal or empty answer | "Answered without submitting a result": processing error | Fault injection |
| Invalid once, then valid | The corrected result is used; the first failure stays in `outputChecks` | Fault injection |
| Well-formed, amount not in the quoted line | Evidence control fails; blocked even when both readers "agree" | Fault injection |
| Well-formed, negative amount or unknown currency | Blocked by R15 or R6 | Fault injection |
| Invented rule ids, control ids, evidence ids | Removed, recorded, and without effect on enforcement | Fault injection |

In every case above nothing was approved and no draft existed. Every rejection is in the case's `outputChecks` and its log.

## Provider failures

`classifyProviderError` reads the provider's message: insufficient credit, invalid credentials, permission, unsupported model (none retried, all account-wide); rate limit, outage, network (retried once). An account-wide failure sets a block for 60 seconds: further calls fail locally without reaching the provider, the app says why and what to do, and the block lifts when a person runs a document again. **Fault injection**: with no credit, one request reaches the provider and none follows; with an outage, the second try succeeds, or it stops after two. Completed findings are kept; nothing is approved. The app does not show a balance, because the provider interface used here does not expose one.

Limit: loops that are already in flight when the first refusal arrives have already sent their request. In the recorded live run that would have saved the last few calls, not the first.

## Collaboration figures (Agent Activity → Execution details)

Counts over stored records, no scores: critical fields read twice and in agreement; cross-checks raised, resolved with evidence, waiting for a person; recommendations the controls overrode; output checks. Each has its definition on hover.

## Benchmark: single agent against multi-agent

Unchanged in this pass and **never run**. One agent on the careful model against the five-agent workflow, same documents, same lookup, same controls, same enforcement; raw recommendations are counted apart from enforced outcomes so that the controls are not credited to either architecture; unmeasured figures show as "not measured". The two fault-injection scenarios are excluded. Confounds stated in the app: different model mix, ten scenarios, no repetition. Scripted results cannot compare intelligence and are not offered as if they could.

## Executed in this pass

| | Result |
|---|---|
| `npm test` | **90 of 90** (was 64): 26 new in `server/test/intelligence.test.ts`. After the showcase pass: 101 of 101. After the final release pass: 114 of 114 |
| `npm run lab` | 12 of 12 scenarios, scripted |
| `npm run typecheck`, `npm run build` | pass |
| Browser, scripted server | Cross-checks view; refusal when the other amount is chosen; resolution with evidence; collaboration figures |
| Live | **BLOCKED.** Last attempt 26 Nov, about 20:30: `400 … credit balance is too low`. Not retried since |

## Not verified, and what it would take

| Claim | Status | Command once credit exists |
|---|---|---|
| The revised prompts behave as intended on real models | Unverified | `npm run dev`, then **Run demo** |
| Live Stress Lab | Unverified | `npm run lab:live` |
| Single agent against multi-agent | Unverified | `npm run lab:benchmark` |
| Repeatability of the same scenario | Not attempted | `npm run lab:live -- --only S02,S05` twice |

## Known limits

- A model can still misread a value that both readers misread the same way, when the quote happens to contain it.
- The evaluation set was not extended in this pass; the twelve scenarios and sixteen documents stand.
- A reviewer's assertion remains possible for discrepancies that are not a critical reading disagreement or a changed account. It is labelled for what it is: accepted, not verified.
- The predefined responses of the scripted showcase (`server/test/showcase-responses.ts`) are written text. They pass through the same output checks as a live answer, and say nothing about model quality.
- The 60-second provider block is per server process; Stress Lab workers are separate processes and each learns of a refusal on its own first call.
