# Payment Desk · product context

Written from the hackathon brief and the design brief supplied on 26 November 2026. Where something is an assumption rather than stated in those briefs, it says so.

## What it is

A multi-agent accounts-payable desk. Four agents on the Mozaik runtime (Extractor, Validator, Auditor, Policy) read inbound supplier documents, extract the payment, check it against the vendor master and the original document, and route it: approve automatically, hold for a person, or reject. A deterministic guard enforces the policy floor. Approved payments become SEPA drafts; nothing is ever sent.

## Who uses it

- **The reviewer** (assumption: an accounts-payable clerk or finance controller at a small or mid-sized company). Works through many documents, needs to see exceptions first, decide in seconds and leave a trail.
- **The hackathon jury**: a banking founder, an enterprise-platform VP, an innovation adviser, engineers, and the authors of Mozaik. They judge usefulness, genuine concurrency on Mozaik, whether it runs from the README, and care with financial data.

## What it must feel like

Institutional, precise, fast, trustworthy. References for quality, not for copying: Linear, Stripe Dashboard, Vercel Observability, Ramp.

## Hard constraints

- Synthetic or public data only; no real money moves.
- Every number has a source; nothing is fabricated, including metrics and status indicators.
- Not financial advice.
- Every visible control works; no placeholder pages.
- Dark and light themes, reduced motion, keyboard access.

## Not in scope

PDF or image parsing, persistence, editing the policy or the vendor master from the UI, sending payments to a bank.
