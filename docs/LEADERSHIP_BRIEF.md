# CRMA Copilot — Leadership Brief

**A conversational AI agent for CRM Analytics.** It lets a user *talk* to their
Salesforce org and get, understand, fix, build, and ship **recipes** and
**dashboards** — in plain English.

---

## The problem

CRM Analytics recipes and dashboards are complex JSON graphs (30–90+ nodes).
Today, working with them means hand-editing JSON, hunting through the Data Prep
UI, and manually promoting changes between orgs. It's slow, error-prone, and
requires deep specialist knowledge. Common CRMA mistakes (e.g. formula
single-vs-double quotes) silently produce wrong data.

## The solution

An AI agent that does the specialist work through conversation:

| Ask it to… | It…|
|---|---|
| *"What does this recipe do? Any issues?"* | retrieves the live definition, traces the lineage, and flags real bugs |
| *"Debug it."* | runs a validation against the org and explains the actual errors |
| *"Change the clustering to 4 and validate."* | makes a surgical edit, re-validates, shows the result |
| *"Build a new recipe that…"* | authors a valid recipe, validates it, and (on approval) deploys |
| *"How many rows in this dataset?"* | runs a live query and answers |
| Same for **dashboards** | get / edit / debug / **answer questions** / create / deploy |

## Why it's credible (not a toy)

- **Runs on Claude Sonnet 4.6 + Opus** via **Salesforce's own internal model
  gateway** — no personal API keys, corporate-governed traffic.
- **Uses the real Salesforce write path** (Metadata API) that we proved reliable
  on live orgs — not a fragile REST hack.
- **Verified live today** against a real org: it listed, retrieved, analyzed,
  debugged, and dry-run-validated the Segmentation recipe — and *proactively
  caught a latent formula-quoting bug* on its own.

## Safety — built in, not bolted on

- **Read-before-write:** always fetches the live definition first.
- **Surgical, auditable edits** (node/path operations), never blind rewrites.
- **Debug = dry-run:** validation never writes to the org.
- **Two-key deploy gate:** a live write requires a config flag *and* explicit
  in-chat approval. Default configuration cannot write — worst case is a no-op.
- **Least privilege:** limited to what the signed-in Salesforce user can do.

## Architecture in one picture

```
  User  ─chat─►  Mastra Agent (Claude Opus/Sonnet)  ─tools─►  Salesforce org
   (Studio UI)          │                                         ▲
                        │                                    sf CLI (authed)
                        └── model via Salesforce gateway      REST + Metadata API
                            (Sonnet 4.6 / Opus, no personal key)
```

- **Mastra** = the agent framework (tools, multi-step tool use, chat). Runs in
  **Mastra Studio**, Mastra's own browser UI (`npm run dev` → localhost:4111),
  which shows the agent and all 14 tools plus a live API explorer.
- **Model gateway** = Salesforce-internal, OpenAI-compatible; governed access to Claude.
- **`sf` CLI** = reuses existing auth; reads via REST, writes via Metadata API.

> "Are we really on Mastra?" — yes, every core building block (`Agent`,
> `createTool`, the `Mastra` instance, `.generate()`, and Studio). A line-by-line
> mapping to Mastra's official docs is in `docs/MASTRA_MAPPING.md`.

## What's built vs. next

**Built & working:** list / get / analyze / debug (dry-run) / edit / create /
gated deploy — for **both** recipes and dashboards; dataset Q&A via SAQL;
cross-org dataset remap; provider switch (gateway ↔ direct Anthropic).

**Natural next steps:** a web chat UI (Mastra dev playground already exists);
multi-org promotion workflows; a recipe-diff tool call (reuse the existing diff
engine) so the agent can compare two orgs; approval routing / audit logging for
enterprise deploys.

## The ask

Approve moving from this working prototype to a piloted internal tool: pick 2–3
CRMA teams, run it against sandbox orgs with `DEPLOY_DRY_RUN` on, and measure
time saved on recipe/dashboard debugging and authoring.
