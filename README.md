# CRMA Copilot (Mastra)

A conversational AI agent that **gets, edits, debugs, transforms, creates, and
deploys** CRM Analytics **recipes** and **dashboards** in a Salesforce org —
built on the [Mastra](https://mastra.ai) agent framework, running on **Claude
(Sonnet 4.6 + Opus)**.

> **Status:** working end-to-end. Verified live against the `storm-org` org:
> lists recipes/dashboards, retrieves full definitions, analyzes and debugs
> them, runs dry-run validation, and gates every write behind confirmation.

---

## What it does

| Area | Capabilities |
|---|---|
| **Recipes** | list · get full R3 definition · edit/transform (surgical node ops) · debug (dry-run validate → org errors) · create new · deploy |
| **Dashboards** | list · get · edit · debug · **answer questions** · query datasets (SAQL) · create new · deploy · cross-org dataset remap |
| **Safety** | deploy is dry-run by default; live writes require `confirm:true` **and** `DEPLOY_DRY_RUN=false` |

---

## How it's wired (architecture)

```
   You (chat)
      │
      ▼
  Mastra Agent  ── "CRMA Copilot", model = Claude Opus (Sonnet selectable)
      │  tool calls
      ├──────────────► recipeTools / dashboardTools
      │                     │
      │                     ▼
      │                 sf.mjs  (Salesforce I/O via the `sf` CLI)
      │                     ├─ REST:      sf api request rest   (list / query)
      │                     └─ Metadata:  sf project retrieve/deploy (.wdpr / .wdash)
      ▼
  models.mjs  ── provider switch:
     • "gateway"   → Salesforce internal model gateway (LiteLLM, OpenAI-compatible /v1)   ◄ default
     • "anthropic" → public Anthropic API (ANTHROPIC_API_KEY)
```

Two deliberate design choices:

1. **Model access without a personal key.** Default provider is the **Salesforce
   internal model gateway** (a LiteLLM proxy exposing an OpenAI-compatible API).
   It serves `claude-sonnet-4-6` and `claude-opus-4-8-vertex`. No developer
   pastes an Anthropic key; all traffic is corporate-governed. A one-line switch
   (`LLM_PROVIDER=anthropic`) falls back to a direct Anthropic key if wanted.

2. **Salesforce access without an OAuth app.** The agent reuses the **already
   authenticated `sf` CLI**. Reads go over Wave REST; **writes go over the
   Metadata API** (`.wdpr` recipes, `.wdash` dashboards) — the reliable write
   path (the Wave REST PATCH/POST is unreliable on these orgs).

---

## Setup

```bash
cd "CRMA Mastra"
npm install
# ensure the org is authed in the CLI:
sf org login web --alias storm-org      # (already done if `sf org list` shows it)
```

Edit `.env` (already scaffolded — **never commit it**):

| Var | Meaning |
|---|---|
| `LLM_PROVIDER` | `gateway` (default) or `anthropic` |
| `SF_GATEWAY_TOKEN` / `SF_GATEWAY_BASE_URL` | gateway creds (base ends in `/v1`) |
| `GATEWAY_MODEL_SONNET` / `GATEWAY_MODEL_OPUS` | `claude-sonnet-4-6` / `claude-opus-4-8-vertex` |
| `NODE_EXTRA_CA_CERTS` | Salesforce CA bundle (**required** for the gateway TLS) |
| `ANTHROPIC_API_KEY` | only when `LLM_PROVIDER=anthropic` |
| `SF_TARGET_ORG` | org alias from `sf org list` |
| `DEPLOY_DRY_RUN` | `true` = validate only (safe default); `false` = allow live writes |

## Run

Three ways to talk to the **same** Mastra agent:

```bash
# 1. Mastra Studio — the official browser playground (chat + tool inspection + API explorer)
npm run dev            # → http://localhost:4111  (Swagger at /swagger-ui)

# 2. Custom browser chat UI (zero extra deps; simple demo window)
npm run ui             # → http://localhost:4111

# 3. Terminal chat (multi-turn; keeps context so get→edit→validate→deploy works)
npm run chat

# 4. One-shot
npm run ask -- "Get recipe Segmentation_Cluster_Analysis_Account_Segmentation1 and debug the formula nodes"
```

> `npm run dev` and `npm run ui` both use port 4111 — run one at a time.
> For leadership, `npm run dev` (**Mastra Studio**) is the most polished: it's
> Mastra's own UI, shows the agent + its 14 tools, and includes a live API explorer.

## Example prompts

- `List my recipes and dashboards.`
- `Get recipe <name> — how many nodes, what do the OUTPUT nodes write, what's the cluster count?`
- `Debug recipe <name>: run a dry-run validation and explain any errors.`
- `In recipe <name>, change the clustering to 4 clusters, validate, and show me the result.`
- `Get dashboard <name>. Rename the chart_1 title to "…" and validate.`
- `How many rows are in the Clustered_Accounts dataset?` (uses SAQL)
- `Create a new recipe that loads Account, filters to AnnualRevenue > 0, and writes a dataset.`
- `Deploy it.` → the agent validates first and asks for explicit approval.

---

## Safety model (for review)

- **Read-first:** the agent always retrieves the live definition before editing.
- **Surgical edits:** changes are node/path operations, not blind rewrites — auditable.
- **Dry-run debugging:** validation is a metadata `--dry-run`; it never writes.
- **Two-key deploy gate:** a real write needs *both* `DEPLOY_DRY_RUN=false` in
  config *and* the agent calling deploy with `confirm:true` after the user
  approves in chat. With the default config, the worst case is a no-op validation.
- **Least privilege:** the agent can only touch what the authed `sf` user can.
- **No secrets in code:** token/key live in `.env` (gitignored); the gateway
  path uses no personal Anthropic key at all.

## Built on Mastra

This is a Mastra-framework app: `Agent` + `createTool` + a `Mastra` instance +
`.generate()`, and it runs in **Mastra Studio** (`npm run dev`). For a line-by-line
mapping to the official Mastra docs (and the one intentional deviation — the
model provider object for the SF gateway), see [docs/MASTRA_MAPPING.md](docs/MASTRA_MAPPING.md).

## Repo contents (Version-1)

| What | Detail |
|---|---|
| No secrets | `.env` excluded; `.env.example` included with all required variables |
| No runtime data | `crma-memory.db*` excluded; `.sfdx-work/` excluded |
| No build output | `node_modules/`, `.mastra/` excluded |
| 84 files, 25,380 lines | Full source + docs + RAG reference library |

---

## Integrating into an existing Mastra orchestration

Both agents are plain Mastra `Agent` instances — drop them into any existing `Mastra` instance alongside other agents.

```js
import { copilot } from './CRMA Mastra/src/mastra/agents/copilot.mjs';
import { debugger_ } from './CRMA Mastra/src/mastra/agents/debugger.mjs';

// Add to your existing Mastra instance:
const mastra = new Mastra({
  agents: { ...existingAgents, crmaCopilot: copilot, crmaDebugger: debugger_ },
  // ...
});
```

**Hard dependencies:**

1. **`reference/` folder** — the RAG knowledge base the agents search at runtime. It lives inside this project as `CRMA Mastra/reference/`. The default path is auto-resolved; if you move it, set `RAG_REFERENCE_DIR=/absolute/path` in `.env`.

2. **`sf` CLI** — must be installed and authenticated (`sf org login web --alias your-org`) on the machine running the agent. The agent shells out to it for all Salesforce I/O.

3. **`.env` variables** — copy `.env.example` to `.env` and fill in `SF_TARGET_ORG`, `LLM_PROVIDER`, and the relevant model gateway or Anthropic credentials.

**Agent exports:**

| Export | File | Model | Role |
|---|---|---|---|
| `copilot` | `src/mastra/agents/copilot.mjs` | Sonnet 4.6 | Primary conversational agent — handles all recipe + dashboard operations |
| `debugger_` | `src/mastra/agents/debugger.mjs` | Opus | Specialist sub-agent — invoked by copilot on hard errors; returns structured fix plans |

---

## Version note

Runs on the current Mastra line: `@mastra/core@^1.61`, `mastra@^1.26`, **AI SDK v7**
(`ai@^7`, `@ai-sdk/openai-compatible@^3`, `@ai-sdk/anthropic@^4`).
- **Install guard:** if this machine's `~/.npmrc` has `min-release-age`, the
  project's local `.npmrc` (`min-release-age=0`) lets the current Mastra line install.
- Opus/Sonnet on the gateway require `temperature: 1` (they reject `0`) — the runners set this.
- Studio prints an "in-memory storage" note — harmless for the demo (nothing needs
  to persist across restarts). Add `@mastra/libsql` or `@mastra/pg` for durable storage.
