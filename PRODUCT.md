# Payment Desk · product context

Written from the hackathon brief, the design brief and the payment-firewall brief supplied on 26 November 2026. Where something is an assumption rather than stated in those briefs, it says so.

## What it is

A payment firewall for accounts payable. Five agents on the Mozaik runtime (Extractor, Validator, an independent Auditor, an Investigator called only on exceptions, Policy) read inbound payment requests, check them against trusted records and against each other, and recommend a disposition. A deterministic control layer decides what is allowed: approve automatically, hold for a person, or block. The stricter of the agent's recommendation and the controls is enforced. An approved payment becomes a sandbox draft; nothing is ever sent.

## Who uses it

- **The reviewer** (assumption: an accounts-payable clerk or finance controller at a small or mid-sized company). Works through many documents, needs to see exceptions first, decide in seconds and leave a trail.
- **The hackathon jury**: a banking founder, an enterprise-platform VP, an innovation adviser, engineers, and the authors of Mozaik. They judge usefulness, genuine concurrency on Mozaik, whether it runs from the README, and care with financial data.

## What it must feel like

Institutional, precise, fast, trustworthy. References for quality, not for copying: Linear, Stripe Dashboard, Vercel Observability, Ramp.

## Hard constraints

- Synthetic or public data only; no real money moves.
- Every number has a source; nothing is fabricated, including metrics and status indicators. No confidence scores.
- An agent never has the authority to approve a payment the controls stop. Uncertainty is never treated as approval.
- Suspicion is worded as suspicion: "confirmed discrepancy" or "suspected", never an accusation of fraud.
- Not financial advice.
- Every visible control works; no placeholder pages.
- Dark and light themes, reduced motion, keyboard access.

## Not in scope

PDF or image parsing, authentication (one "Demo reviewer"), ISO 20022 XML, editing the policy or the vendor master from the UI, sending payments to a bank.
