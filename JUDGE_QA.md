# Payment Desk · questions a judge might ask

Short answers, each pointing at what can be checked. Where something was not run, it says so.

**Why is this a real financial problem?**
Accounts payable pays what arrives. The two expensive mistakes are paying the same invoice twice and paying to an account that is not the vendor's because a message said the bank had changed. Catching them means comparing every invoice with the vendor master, the payment history and its own arithmetic, under time pressure. We cite no loss statistics: none were measured here.

**Who would use it?**
An accounts payable clerk or a finance controller who has to decide, invoice by invoice, whether a payment may go out, and a finance manager who has to show afterwards why it did.

**Why five agents?**
Each has one job and its own inputs. The Extractor reads the document. The Validator checks that reading against trusted records and never sees the document. The Auditor reads the document again and never sees the Extractor's reading. The Investigator runs only when a control fails or needs review. The Policy agent recommends a disposition. The split that matters is Extractor against Auditor: two readings that cannot copy each other, compared by code. See `ARCHITECTURE_PROOF.md`, proofs C and D.

**Why not one powerful model?**
One model that misreads an amount will validate, explain and approve that misreading consistently. A second reader with no view of the first makes a misreading visible as a disagreement. That is the design argument. We have **not measured** it: the single-agent benchmark is built (`npm run lab:benchmark`) and has never completed, because the provider account has no credit. We do not claim the multi-agent design scores better.

**How exactly is Mozaik used?**
One Mozaik runtime with a typed shared state, five agent participants plus a Desk, a Firewall and an Observer. Agents subscribe to semantic events (`document.received`, `extraction.completed`, …) and each loop runs through the runtime's `runLoop` with its own model context and case-bound tools. Nothing calls agents in sequence. `server/desk.ts` lines 73, 381, 874 to 898; walkthrough in `ARCHITECTURE_PROOF.md`.

**Do the agents really run in parallel?**
Validator and Auditor are two handlers on the same event, so both loops start when the reading lands. Every loop stores real start and finish times. A test asserts the overlap; the stored live run shows it on all five showcase documents (for example 3.6 s on `INV-2026-1049`). We do not quote a speed-up factor: no sequential baseline was measured.

**How do agents exchange information?**
They do not message each other. Each writes a validated result into its own slot of the shared case state through its own submit tool, and publishes a completion event. The next agent is started by that event and reads what it is allowed to read from the case. The Auditor is deliberately given less: the document only.

**What happens when agents disagree?**
Code turns the disagreement into a challenge: both values, the evidence for each, who raised it, what would settle it, a status. A different amount, currency or IBAN between the two readers blocks the payment. A document that contradicts itself is held for a person and sent to the Investigator. The challenge is kept after it ends. Showcase scenario 3 → *Inspect agent challenge*.

**Can an agent approve a fraudulent payment?**
No agent approves anything. The Policy agent recommends; code enforces the stricter of that recommendation and what the controls allow, and a blocked payment has no approve action in the API. What this does not give: detection of fraud the controls do not model. An invoice from a known vendor, to the account on file, for a plausible amount, for goods never delivered, passes. The controls catch changed accounts, duplicates, arithmetic, limits, unknown vendors, missing evidence and contradictions.

**How do you prevent duplicate approvals, and decisions that land at the same time?**
Every decision goes through one synchronous function on the server. A payment that is already approved cannot be approved again; five simultaneous approvals over HTTP give one success and four refusals. Automatic approvals take the daily budget inside the same synchronous step, so two that land together cannot both see the same remaining budget. A scenario cannot be run twice, and a duplicate invoice is blocked on vendor plus invoice number, the payment history, or the content hash. Tests: `api.test.ts`, `resolution.test.ts`, `lab.test.ts` (S08), `workflow.test.ts` 10, 11 and 11b.

**Where do the financial values come from?**
From the document, a trusted record, the policy, or a calculation over those. Every reported value has a ledger entry: a quoted line with its line number, a record id, or the inputs and method of a calculation. Select any reference in the app to open it.

**What if an agent hallucinates?**
Three layers. Output is validated against a schema; a second invalid answer fails the document closed. Every reported value needs a verbatim quote, and code checks that the quote is in the document and contains the value. A separate integrity pass re-checks every reference before anything is approved. Citations to evidence that does not exist are removed and recorded; invented policy rules change nothing. Tests: `intelligence.test.ts`.

**What if both readers make the same mistake?**
Then they agree, and agreement is not proof. Two models from one provider can share a blind spot. What still holds: the value must be in the quoted line, the arithmetic must add up, the account must be the one on file, the invoice must not be a duplicate. What does not: a wrong value that is really printed in the document and passes every check. That is why a contradiction needs an independent record, not a second opinion.

**How do you verify an IBAN?**
Two different things. The checksum (ISO 13616, mod 97) says the number is well formed. Ownership is only ever established by the vendor master, or by a callback record for that vendor and that exact account. A valid IBAN that is not the one on file is blocked. The callback records are synthetic fixtures; the application matches a record, it calls nobody.

**How is a contradiction about the amount resolved?**
Not by the invoice itself. A reviewer can attach a verified vendor confirmation: a trusted record for that vendor, that invoice and that currency. If it states the amount the payment would pay, the challenge ends as *matched to a trusted record* and a person approves. If it states another amount, the payment is blocked. Without a record nothing releases it: a written statement or a line of the invoice is refused (policy v7), and the reviewer rejects the payment and asks for a corrected invoice. The confirmations are synthetic fixtures (`server/data/confirmations.json`). Tests: `resolution.test.ts`.

**How are amounts calculated?**
In integer minor units, never floating point. Net plus tax must equal gross exactly. Sums are per currency and currencies are never added together. Every derived figure is a ledger entry with its inputs and method. `server/money.ts`, `safety.test.ts`.

**What happens if the model provider fails?**
The error is classified. No credit, a bad key or a missing model: not retried, and further calls are held back for 60 seconds so nothing more is spent. A rate limit or an outage: one retry. The document becomes a processing error, nothing is approved, and it can be run again. The application never substitutes scripted output for a live answer.

**How much money does this save?**
We have no measurement and will not invent one. The interface shows *blocked payment exposure*: the sum requested by blocked payments, each counted once. A block is not a loss prevented. The value we can state is narrower: every payment is checked against the same controls, exceptions arrive with their evidence, and every decision records who made it and on what.

**Is it production ready?**
No. It is a hackathon sandbox: synthetic data, one demo reviewer and no sign-in, state in one JSON file, text and text-layer PDF documents only (no OCR), drafts as JSON rather than ISO 20022, and it listens only on the local machine. Public or production deployment is out of scope.

**Does it move money?**
No. An approval creates a JSON draft marked `sandbox`. Nothing is sent anywhere.

**Can I run it without an API key?**
Yes: `npm ci && npm run demo`. That is the real Mozaik runtime, loops, tools, events, controls and enforcement with predefined model responses, and every screen says so. It shows the architecture and the workflow, not model quality.

**Has this version run with a real model?**
Yes, with local ones, three times on 27 November, on the same laptop through Ollama with no cloud provider. `gemma2:9b`: two of four scenarios as expected, two processing errors. `qwen2.5:7b-instruct`: three of four, with a valid invoice held because the Auditor called the total and one of its line items a contradiction. `qwen2.5:7b-instruct` on the final code: four of four. In that last run both readers had every critical field right on every document, the Auditor found the real contradiction on its own, and it also raised three false ones that code recognised and removed, on record. The Policy agent recommended only "needs approval" for the changed account and the controls kept it blocked. The first and the last run replay in the app. Hosted models have not been run on this version.

**Where does the data come from? Are these real invoices or real accounts?**
Everything is synthetic and written for this project: sixteen text documents, eight PDFs generated from a description file and regenerated byte for byte in the tests, and seven small files of records. No customer data and no real invoice. The account numbers are test numbers that payment providers publish for their sandboxes (eight of thirteen) or per-country examples from documentation (five, one confirmed at its source). Three numbers whose origin could not be established were replaced on 27 November. No well-formed number can be shown to belong to no one, which is why the safeguard is that the application cannot reach an account at all. `DATA_PROVENANCE.md` lists all of it.

**What makes a trusted record trustworthy? Do you contact suppliers?**
In this sandbox, nothing beyond being a row in a fixture file. The application matches a reference to a row for the right vendor, invoice, currency and amount; it places no call and contacts no one. In a deployment those rows would come from an ERP and a recorded verification process. The design point is which evidence is allowed to release a payment, not where the rows are stored.

**Can it read an invoice it has never seen?**
On 27 November five held-out synthetic invoices with no predefined answer were run once on a local model (`qwen2.5:7b-instruct`). All five were processed; 24 of 25 critical fields were right and one was invented; four of five ended as declared in advance. The one that did not was a valid French PDF, read correctly and then held for a person because the second reader filed the amount under "net". Two findings matter more than the count: on one document the Auditor found a second payable amount that the control in code missed, and on another the Extractor invented an amount and the controls blocked it. Five documents, one run: an observation, not a rate.

**What does "500 of 556 values verified" mean, and what about the other 56?**
The integrity verifier re-reads every value against its source. 115 of the 556 are critical: a decision rests on them. All 115 are verified. The 56 that a program cannot check are 30 dates, 20 sentences written by agents and 6 quoted passages; none is critical, and none is counted as verified. No approval rests on a value that could not be checked.

**A quote can contain a number that is the wrong field. Does the code catch that?**
Partly, and the fault-injection test shows where the line is. A line item quoted correctly and reported as the total is held by a control that reads the document's own labelled total line. On a document whose total is labelled in words that control does not know, the same error passes every code control and is stopped only because the Auditor read the document independently. If both readers make that mistake on such a document, nothing here catches it: that case is in the test, reported as not caught. The limits and a person on larger amounts are what is left.

**Does the blocked amount mean money saved?**
No. It is the sum of payments that are blocked right now, per currency. Some are duplicates of invoices already paid. Nothing measures prevented loss or time saved.

**Has the fix for the local-model failure been tested on a real model?**
Yes. The stored `gemma2:9b` run failed because the adapter removed list limits from the schema the model server enforces. With the limits kept, a direct request to the model server returned a list within its limit on three installed models, and in the later runs the Investigator returned a valid result every time it was called (seven of seven).

**Has it run with hosted models?**
An earlier version did, on 26 November 2026: 67 agent loops on 16 documents, 12 decided before the credit ran out. The five showcase documents of that run are replayable in the app (three decided). **The current version has not run with hosted models**; the last attempt, 26 November 23:56 CET, was refused for lack of credit. It has run with a local model, as described above.

**What does the benchmark establish?**
A little, and not all of it flattering. It ran once on 27 November, on five of the ten scenarios, both configurations on the same small local model. Final outcomes: the five-agent workflow ended four of five as declared, the single agent three of five; the difference was a valid invoice the single agent held for a person. Neither blocked the invoice whose net and tax do not add up to its total, because neither reader reported net and tax and the arithmetic control had nothing to add. The single agent's raw recommendations were closer to the required outcome (three of five against two of five); the controls enforced the same result. Five agents took about twice the time. Too few cases for any rate. Beside it, and labelled as something else, there is a controlled fault-injection test (`npm run experiment`, or Stress lab → Fault injection): nine scripted agent errors, each run with one agent and with five. Seven were stopped by code controls either way. One, a line item reported as the total on a document whose total label the code does not know, passed every control with one agent and was approved for the wrong amount; with an independent Auditor the two readings differed and the payment was blocked. One, where both readers make that mistake, was not caught and is declared as a limit. That shows the mechanism, not how often a model errs. The method and the code exist (one agent on the stronger model against the five-agent workflow, same documents, records, controls and enforcement, with raw recommendations counted apart from enforced outcomes). If it runs, it will say how often each configuration recommends something unsafe or misses a discrepancy on ten synthetic scenarios, which is too few for statistical claims.

**Does it read PDFs?**
Yes, PDFs with a text layer, up to 2 MB and 10 pages. The file is validated by its signature and parsed on this machine in a worker thread; the agents get the extracted text only. Every located reference carries its page and line (`p. 2, line 12`), opens the original page, and is marked there when the parser measured a box for that line. Scanned PDFs are refused: there is no OCR. In the scripted demo only the registered synthetic PDFs are interpreted; another PDF is parsed and shown and says it needs live AI, which has not been verified on this version.

**How do you know the highlight is in the right place?**
It is not drawn from anything a model said. The parser measures a box for each line of text; an agent's quote is located in the text by code; the marker is that line's box, scaled with the page. Where there is no box (rotated text, a quote across two pages) there is no marker, and the interface says so. It marks the line, not the single value.

**Which parts are solid and which are sandbox only?**
Solid within its scope: the deterministic controls, exact money arithmetic, evidence location and re-verification, the server-side decision rules, the orchestration. Sandbox only: the data, the trusted records (fixtures), the reviewer (one, no sign-in), storage (one JSON file), the payment draft (JSON, not a bank format), and hosting (local machine only).

**What is the strongest advantage?**
The authority boundary, and that it can be checked. Agents investigate and explain; code decides, and the code path is the same whether the model is live, scripted or wrong. A judge can verify it without an API key: script the Policy agent to approve everything and the controls still hold, which is what most of the workflow tests do.

**What would the next commercial step be?**
A pilot with one accounts payable team on their own approval policy: scanned documents (OCR), the vendor master and payment history from their ERP, named reviewers with four-eyes approval, and ISO 20022 output for the bank. None of that exists today.
