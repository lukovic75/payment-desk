# Payment Desk · judge quickstart

Ten minutes, no API key, no account. Every label below is what the current interface shows.

Prefer to watch first? [`docs/demo/payment-desk-demo.mp4`](docs/demo/payment-desk-demo.mp4): two and a half minutes of the running application, with captions and no narration. It shows the scripted demo and one stored run with a real model, and says which is which.

## 1. Start it

```bash
npm ci
npm run demo
```

Node 20.19+ or 22.12+. Open http://localhost:8799. The indicator at the top right reads **Scripted demo**: the Mozaik runtime, the five agents, their tools, the shared state, the controls and the enforcement run for real; the agents' answers are predefined text. Press the indicator for the full explanation.

## 2. The guided demo (three minutes)

1. **Start demo**, then **Start demo** again on the opening screen. Scenario 1: a valid invoice is approved. Under *How the agents worked* the line "Validator and Auditor ran at the same time" is read from the recorded start and finish of the two loops.
2. **Next: Changed account.** The invoice names an account that is not the one on file. *Payment blocked.* Under *Check it at the source* the two accounts stand side by side, each with a reference that opens its source. There is no approve action.
3. **Next: Agents disagree.** A two-page PDF: the cover text asks for 1,980.00, the invoice total says 1,890.00. Select **p. 1, line 5**: the original page opens with the line marked. Then **Inspect agent challenge**: both sides, who raised it, its status.
4. Still in scenario 3, under *Resolve it with independent evidence*: enter `VC-2026-1126-03` and press **Verify payable amount** (refused: on record as unverified). Enter `VC-2026-1126-01` (matched), then **Approve payment**. A written statement or a line of the invoice would not have released it.

## 3. The proofs behind it

| What to check | Where |
|---|---|
| Real Mozaik execution: every loop with its trigger, start and finish | In a scenario, **View execution proof**; or **Agent activity** → a payment → *Execution details* |
| What the second agent adds that code does not | **Stress lab** → **Fault injection** → **Run the test**. Nine injected agent errors, each run with one agent and with five. Read rows F2, F7 and F9: caught by code, caught only by the second reading, and not caught |
| Reliability | **Stress lab** → **Run all 12**. Each scenario declared its outcome before it ran; each runs in its own process |
| One record of a decision | **Review queue** → any payment → *Decision report* → **Open** |
| What the desk did, in numbers | **Evidence & audit** → *What the desk has done* |
| Runs with real models, as they happened | Guided demo opening → *Watch the recorded run of this version* (local `qwen2.5:7b`: four of four scenarios as expected), *Watch the earlier local run* (`gemma2:9b`: two of four) and *Watch the recorded execution* (hosted models, an earlier version) |

## 4. The checks

```bash
npm test               # 165 tests on the real Mozaik runtime with a scripted model, about a minute
npm run lab            # the twelve stress scenarios
npm run experiment     # the fault-injection test, as a table
npm run test:browser   # 32 browser checks (needs Node 22+ and a local Chrome or Chromium)
```

CI runs install, types, tests, build and the stress scenarios on Node 20 and 22.

## 5. What it is not

- Not a measurement of how well a language model reads invoices. The no-key demo uses predefined answers. Three runs on small local models were made on 27 November: two, three and four of four scenarios as expected, in that order; the first and the last replay in the app, and the README describes all three.
- Not connected to anything. Synthetic data, no bank, no supplier, no money. See [`DATA_PROVENANCE.md`](DATA_PROVENANCE.md).
- The live single-agent against multi-agent benchmark has not been run. The fault-injection test is a different thing and says so.
