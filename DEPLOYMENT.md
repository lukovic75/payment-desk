# Payment Desk · deployment

**Status: there is no public deployment.** This page says why, what is ready, and what would have to be true before one is safe. Nothing below claims a URL that does not exist.

## Why it is not on the public internet

1. **One workspace, no sign-in.** The application is a single-machine sandbox: one desk, one reviewer, state in memory. On a public address every visitor would share that desk: one judge's restart would clear another judge's demo, and anyone could act as the reviewer. That is harmless with synthetic data, but it is not something to present as a multi-user product.
2. **Real AI on a public address would spend someone's quota.** With a provider key on the server, the endpoints that start agent runs are open to whoever reaches them. There is no per-visitor budget, queue limit or upload restriction for that case. It listens on `127.0.0.1` by default for exactly this reason.
3. **An account and its terms are the owner's decision.** Creating a hosting account, accepting a provider's terms or adding a billing method was not done on anyone's behalf.

So the three ways to evaluate the project are: run it locally (two commands), run the same thing in a container, or watch the video and read the evidence.

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

A static host or short-lived serverless functions do not fit. A container host that keeps one instance running does. No provider's free tier was checked for this document, so none is recommended by name.

## If you deploy the scripted demo anyway

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
