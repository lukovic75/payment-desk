# Payment Desk · questions a judge might ask

Short answers, each pointing at what can be checked. Where something was not run, it says so.

**Why five agents?**
Each has one job and its own inputs. The Extractor reads the document. The Validator checks that reading against trusted records and never sees the document. The Auditor reads the document again and never sees the Extractor's reading. The Investigator runs only when a control fails or needs review. The Policy agent recommends a disposition. The split that matters is Extractor against Auditor: two readings that cannot copy each other, compared by code. See `ARCHITECTURE_PROOF.md`, proofs C and D.

**Why not one powerful model?**
One model that misreads an amount will validate, explain and approve that misreading consistently. A second reader with no view of the first makes a misreading visible as a disagreement. That is the design argument. We have **not measured** it: the single-agent benchmark is built (`npm run lab:benchmark`) and has never completed, because the provider account has no credit. We do not claim the multi-agent design scores better.

**How exactly is Mozaik used?**
One Mozaik runtime with a typed shared state, five agent participants plus a Desk, a Firewall and an Observer. Agents subscribe to semantic events (`document.received`, `extraction.completed`, …) and each loop runs through the runtime's `runLoop` with its own model context and case-bound tools. Nothing calls agents in sequence. `server/desk.ts` lines 73, 381, 874 to 898; walkthrough in `ARCHITECTURE_PROOF.md`.

**Do the agents really run in parallel?**
Validator and Auditor are two handlers on the same event, so both loops start when the reading lands. Every loop stores real start and finish times. A test asserts the overlap; the stored live run shows it on all five showcase documents (for example 3.6 s on `INV-2026-1049`). We do not quote a speed-up factor: no sequential baseline was measured.

**What happens when agents disagree?**
Code turns the disagreement into a challenge: both values, the evidence for each, who raised it, what would settle it, a status. A different amount, currency or IBAN between the two readers blocks the payment. A document that contradicts itself is held for a person and sent to the Investigator. The challenge is kept after it ends. Showcase scenario 3 → *Inspect agent challenge*.

**Can an agent approve a fraudulent payment?**
No agent approves anything. The Policy agent recommends; code enforces the stricter of that recommendation and what the controls allow, and a blocked payment has no approve action in the API. What this does not give: detection of fraud the controls do not model. An invoice from a known vendor, to the account on file, for a plausible amount, for goods never delivered, passes. The controls catch changed accounts, duplicates, arithmetic, limits, unknown vendors, missing evidence and contradictions.

**What if an agent hallucinates?**
Three layers. Output is validated against a schema; a second invalid answer fails the document closed. Every reported value needs a verbatim quote, and code checks that the quote is in the document and contains the value. A separate integrity pass re-checks every reference before anything is approved. Citations to evidence that does not exist are removed and recorded; invented policy rules change nothing. Tests: `intelligence.test.ts`.

**What if both readers make the same mistake?**
Then they agree, and agreement is not proof. Two models from one provider can share a blind spot. What still holds: the value must be in the quoted line, the arithmetic must add up, the account must be the one on file, the invoice must not be a duplicate. What does not: a wrong value that is really printed in the document and passes every check. That is why a contradiction needs an independent record, not a second opinion.

**How do you verify an IBAN?**
Two different things. The checksum (ISO 13616, mod 97) says the number is well formed. Ownership is only ever established by the vendor master, or by a callback record for that vendor and that exact account. A valid IBAN that is not the one on file is blocked. The callback records are synthetic fixtures; the application matches a record, it calls nobody.

**How is a contradiction about the amount resolved?**
Not by the invoice itself. A reviewer can attach a verified vendor confirmation: a trusted record for that vendor, that invoice and that currency. If it states the amount the payment would pay, the challenge ends as *matched to a trusted record* and a person approves. If it states another amount, the payment is blocked. Without a record, a person can still approve on a written statement, and that is labelled *accepted by a reviewer, not verified*. The confirmations are synthetic fixtures (`server/data/confirmations.json`). Tests: `resolution.test.ts`.

**How are amounts calculated?**
In integer minor units, never floating point. Net plus tax must equal gross exactly. Sums are per currency and currencies are never added together. Every derived figure is a ledger entry with its inputs and method. `server/money.ts`, `safety.test.ts`.

**What happens if the model provider fails?**
The error is classified. No credit, a bad key or a missing model: not retried, and further calls are held back for 60 seconds so nothing more is spent. A rate limit or an outage: one retry. The document becomes a processing error, nothing is approved, and it can be run again. The application never substitutes scripted output for a live answer.

**How much money does this save?**
We have no measurement and will not invent one. The interface shows *blocked payment exposure*: the sum requested by blocked payments, each counted once. A block is not a loss prevented. The value we can state is narrower: every payment is checked against the same controls, exceptions arrive with their evidence, and every decision records who made it and on what.

**Is it production ready?**
No. It is a hackathon sandbox: synthetic data, one demo reviewer and no sign-in, state in one JSON file, text documents only, drafts as JSON rather than ISO 20022, and it listens only on the local machine. Public or production deployment is out of scope.

**Does it move money?**
No. An approval creates a JSON draft marked `sandbox`. Nothing is sent anywhere.

**Can I run it without an API key?**
Yes: `npm ci && npm run demo`. That is the real Mozaik runtime, loops, tools, events, controls and enforcement with predefined model responses, and every screen says so. It shows the architecture and the workflow, not model quality.

**Has it run with live models?**
An earlier version did, on 26 November 2026: 67 agent loops on 16 documents, 12 decided before the credit ran out. The five showcase documents of that run are replayable in the app (three decided). **The current version has not run with live models.** The last attempt, 26 November 22:58 CET, was refused for lack of credit.

**Has the benchmark run?**
No. The method and the code exist; no result does.

**Does it read PDFs?**
No. Plain-text documents only. Text-layer PDF support was considered for the final sprint and left out: it would add a parser and a new evidence-location problem (pages, reading order) with no time to test it properly.

**What would the next commercial step be?**
A pilot with one accounts payable team on their own approval policy: PDF intake, the vendor master and payment history from their ERP, named reviewers with four-eyes approval, and ISO 20022 output for the bank. None of that exists today.
