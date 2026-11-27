# Payment Desk · deployment

**Status: the no-key scripted demo is public at https://payment-desk.onrender.com.** This page says what that deployment is, what it is not, and what a public version with real AI would still need.

## The public demo

| | |
|---|---|
| Address | https://payment-desk.onrender.com |
| Host | Render, free instance, Frankfurt, built from this repository's [`Dockerfile`](Dockerfile) |
| Code | commit `dd768fb`, deployed 27 November 2026, 22:47 CET. It does not redeploy on its own, so later commits are not on it unless someone deploys them |
| Mode | scripted demo: real Mozaik runtime, agents, tools, controls; predefined model answers; no provider key on the server; nothing persisted |

Checked on the public address right after it came up: the health endpoint, the interface and its live connection, all four guided scenarios to their expected results (*Payment verified*, *Payment blocked*, *Held for a person*, *Duplicate payment blocked*), the fault-injection test in its worker process, the stored recordings, and that a state-changing request from another site is refused (403). Not checked there: the twelve stress scenarios, PDF upload, and how it behaves with several visitors at once.

What a visitor should know:

1. **One workspace, no sign-in.** Every visitor shares one desk: you may see another visitor's runs, **Restart** in the guided demo starts it over for everyone, and anyone can act as the reviewer. That is harmless with synthetic data, but it is a demo, not a multi-user product.
2. **It sleeps and it restarts.** The free instance stops when idle, so the first load after a pause can take a minute, and the host may restart it at any time. State is in memory, so a restart returns it to the initial state.
3. **No model runs there.** There is no provider key on the server, so nothing can be spent and uploads of unregistered documents are answered with "needs live AI". Real AI stays on a local machine: with a key on a public server, the endpoints that start agent runs would be open to whoever reaches them, and there is no per-visitor budget for that.

If the public demo is slow, busy or down, run it locally (two commands) or in a container; the video and the evidence need nothing at all.

## What is ready and verified: the container

```bash
docker build -t payment-desk .
docker run --rm -p 127.0.0.1:8799:8799 payment-desk
# http://localhost:8799
```

Checked on 27 November 2026 (Docker 29.6, Apple silicon): the image builds from a clean context, the container reports healthy, serves the interface, runs a showcase scenario to its decision through the real runtime, runs the fault-injection test in a worker process, refuses a state-changing request from another site (403), and runs as a non-root user. Image size about 273 MB.

It is the **scripted demo only**: no key, no model, nothing persisted. The environment is set in the [`Dockerfile`](Dockerfile); there is no secret to configure.

## What the application needs from a host

| Requirement | Why |
|---|---|
| A long-lived Node process (20.19+ or 22.12+) | agent loops run for seconds to minutes; state is in memory |
| Streaming responses | the interface follows the desk over Server-Sent Events (`/api/events`) |
| Child processes and worker threads | each stress scenario and the fault-injection test runs in its own process; PDFs are parsed in a worker thread |
| One instance | state is not shared between instances |

A static host or short-lived serverless functions do not fit. A container host that keeps one instance running does; the public demo above runs on one.

## If you deploy the scripted demo yourself

- Build from the `Dockerfile`; port `8799`; health check `GET /api/health`.
- Do not add a provider key. Without one the server cannot spend anything, and it says "Scripted demo" on every page.
- Say on the page you link from that it is one shared demo workspace: visitors see each other's runs, **Restart** in the guided demo starts it over for everyone, and the host may restart it at any time.
- Requests that change state are accepted only from the page's own origin; that check stays on.

## What a public version with real AI would need (not built)

- A workspace per visitor, created by the server, with no way to read or reset another one.
- A budget: requests per visitor and in total, a cap on model calls and tokens per run, a queue with a limit, and a clear "unavailable" state when the budget is used up. Never a silent switch to predefined answers.
- Uploads restricted to the synthetic set, or an upload path with its own limits and no retention.
- The provider key only in the host's secret store, never in a `VITE_` variable, a response or a log. The interface already gets no credential: the browser only ever calls this server.

None of that exists yet, and it was not worth risking a working submission to build it in the last hours.
