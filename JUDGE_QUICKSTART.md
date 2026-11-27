# Payment Desk · judge quickstart

Ten minutes, no API key, no account. Every label below is what the current interface shows.

Prefer to watch first? [`docs/demo/payment-desk-demo.mp4`](docs/demo/payment-desk-demo.mp4): two and a half minutes of the running application, with captions and no narration. It shows the scripted demo and one stored run with a real model, and says which is which.

## 1. Start it

```bash
npm ci
npm run demo        # http://localhost:8799
```

There is no hosted link: it runs on your computer and opens at http://localhost:8799. The README has [every step and what to do if it does not open](README.md#how-to-open-the-application).

Node 20.19+ or 22.12+. `npm run doctor` checks the machine if something does not start. Or, in a container: `docker build -t payment-desk . && docker run --rm -p 127.0.0.1:8799:8799 payment-desk`.

The indicator at the top right reads **Scripted demo**: the Mozaik runtime, the five agents, their tools, the shared state, the controls and the enforcement run for real; the agents' answers are predefined text. Press the indicator for the full explanation.

**The workspace** is synthetic and isolated: seven vendors, payment history, a purchase order, a callback record, vendor confirmations and the policy in [`server/data/`](server/data); sixteen text documents and eight PDFs. Nothing is saved to disk in this mode. **To reset:** **Restart** at the top of the guided demo starts the four scenarios over; stopping and starting `npm run demo` returns everything to the initial state. Nothing outside the sandbox is touched either way.

## 2. Ten workflows

Start each from the state the previous one left, or after a reset. "Scripted" means it works with `npm run demo`.

| # | Do this | Expect | What it shows |
|---|---|---|---|
| 1 | **Start demo**, then **Start demo** on the opening screen | *Payment verified*; under *How the agents worked*, "Validator and Auditor ran at the same time" | A valid invoice goes through. The overlap is read from recorded loop times. Scripted |
| 2 | **Next: Changed account** | *Payment blocked*; under *Check it at the source* the invoice's account beside the one on file, each opening its source; no approve action | A changed bank account is stopped by a control in code. Scripted |
| 3 | **Next: Agents disagree**, then select **p. 1, line 5** | *Held for a person*; the original PDF page opens with the line marked | Two payable amounts in one document, each traced to its page. Scripted |
| 4 | In scenario 3, under *Resolve it with independent evidence*: enter `VC-2026-1126-03`, **Verify payable amount**; then `VC-2026-1126-01`, **Verify payable amount**, **Approve payment** | The first is refused (on record as unverified); the second matches; the approval cites it and a sandbox draft appears | Only a verified trusted record releases a disputed amount. A written statement would not. Scripted |
| 5 | **Next: Duplicate payment** | *Duplicate payment blocked*, citing payment `H-0001` | The same invoice is not paid twice. Scripted |
| 6 | **Stress lab** → **Fault injection** → **Run the test**; read rows F2, F7, F9 | 9 injected errors: 7 stopped by code either way, 1 only by the second reading (F7), 1 not caught (F9, declared limit) | What the independent agent adds, and where both defences end. Scripted answers with deliberate errors; not a model benchmark |
| 7 | In any scenario, **View execution proof**; or **Agent activity** → *Execution details* | Every loop with its trigger, start and finish; Validator and Auditor both triggered by `extraction.completed` | The runtime's own record of what ran. Scripted |
| 8 | **Stress lab** → **Run all 12** | 12 of 12, each judged against what it declared beforehand | Reliability of the workflow and controls; each scenario in its own process. Scripted |
| 9 | Open the three stored runs: `http://localhost:8799/#/showcase/recorded-current`, `…/#/showcase/recorded-previous`, `…/#/showcase/recorded` (the opening screen of the guided demo links to them before the first scenario is started) | Three replays, each labelled with model, date and code: local `qwen2.5:7b` 4 of 4, local `gemma2:9b` 2 of 4, hosted models on earlier code | Real model output as it happened, failures included. Benchmark figures are in the README; the benchmark page shows only runs made on your machine |
| 10 | With real AI only (section 3): **Document** at the top right → upload `server/data/heldout/FA-2026-0331.pdf` → **Process document** | A French PDF no predefined answer exists for is read by the model and decided; about three to five minutes on a laptop | A new document, a real model, the same workflow. On the scripted server the same upload is parsed, shown, and answered with "needs live AI" |

Also worth a minute: **Review queue** → any payment → *Decision report* → **Open** (one record of everything behind a decision), and **Evidence & audit** → *What the desk has done*.

## 3. Real AI, without a key

```bash
ollama pull qwen2.5:7b-instruct
printf 'FROM qwen2.5:7b-instruct\nPARAMETER num_ctx 12288\nPARAMETER temperature 0\n' > Modelfile
ollama create qwen2.5:7b-instruct-12k -f Modelfile
LOCAL_MODEL=qwen2.5:7b-instruct-12k npm run demo:local    # http://localhost:8798
```

The indicator reads **Live local AI**. If Ollama is not running or the model is missing, the server stops at start-up and says which; it does not fall back to predefined answers. `npm run heldout -- http://localhost:8798` then runs the five held-out invoices and compares them with what was declared in advance.

## 4. The checks

```bash
npm run verify         # typecheck, 166 tests, build, 12 stress scenarios, the fault-injection test
npm run test:browser   # 32 browser checks (needs Node 22+ and a local Chrome or Chromium)
```

CI runs install, types, tests, build and the stress scenarios on Node 20 and 22. Run the tests on a machine that is not busy: several of them start server processes and have short timeouts.

## 5. What it is not

- Not a measurement of how well a language model reads invoices. The no-key demo uses predefined answers. Real-model evidence is small and all of it is in the README: three showcase runs (2, 3 and 4 of 4), five held-out invoices (4 of 5), a five-scenario benchmark.
- Not connected to anything. Synthetic data, no bank, no supplier, no money. See [`DATA_PROVENANCE.md`](DATA_PROVENANCE.md).
- Not deployed publicly. [`DEPLOYMENT.md`](DEPLOYMENT.md) says why.
