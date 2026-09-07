# CRMA Copilot (Mastra)

A conversational AI agent that **gets, edits, debugs, transforms, creates, and
deploys** CRM Analytics **recipes** and **dashboards** in a Salesforce org —
built on the [Mastra](https://mastra.ai) agent framework, running on **Claude
Opus 4.8** (Sonnet 4.6 selectable).

> **Status:** working end-to-end. Verified live against the `storm-org` org:
> builds/deploys multi-widget dashboards and recipes, renders a live pre-deploy
> **chart preview** (ECharts), self-verifies every deployed widget via
> `diagnose-dashboard` (live query + wiring checks), and gates every write behind
> confirmation.

> **For the integrating architect:** read **[§ Integrating into an existing Mastra
> orchestration](#integrating-into-an-existing-mastra-orchestration)** first — it has
> the exports, the RAG dependency, env vars, the single-org-per-server limitation,
> and the version-alignment step. This README is written to be read top-to-bottom as the complete handoff.

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
| `DEPLOY_DRY_RUN` | `true` = validate only, never writes to the org (safe default for dev/test); `false` = live writes enabled. **Must be `false`** for the agent to actually create or deploy recipes and dashboards. Even with `false`, every deploy still requires explicit `confirm:true` in the tool call after the user approves in chat — both gates must be open simultaneously. |

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

## Repo contents / what to push to git

Everything the agent needs to run is **in this repo and committed** — it is self-contained. What's tracked vs. ignored:

| Category | Path | Committed? |
|---|---|---|
| **Agent source** | `src/mastra/` (`index.js`, `models.mjs`, `sf.mjs`, `reference.mjs`, `agents/`, `tools/`) | ✅ yes |
| **Entry surfaces** | `src/server.mjs` (browser UI + ECharts preview), `src/chat.mjs`, `src/ask.mjs` | ✅ yes |
| **RAG knowledge base** | `reference/` — **109 files** the agent reads at runtime via `search-reference` | ✅ yes (ships in-repo) |
| **Dependency manifest** | `package.json`, `package-lock.json`, `.npmrc` | ✅ yes |
| **Config template** | `.env.example` (all required vars, no secrets) | ✅ yes |
| **Docs** | `README.md`, `docs/` | ✅ yes |
| **Secrets** | `.env` (tokens, gateway URL, org alias) | ❌ gitignored |
| **Runtime data** | `crma-memory.db*`, `.mastra/`, `.sfdx-work/`, `session-history.json`, `components-built.json` | ❌ gitignored |
| **Deps** | `node_modules/` | ❌ gitignored (restore with `npm install`) |

> ⚠️ **RAG is a hard runtime dependency.** The agent's dashboard/recipe correctness comes from
> `reference/` (verified widget skeletons, SAQL patterns, deploy gotchas). It now lives **inside the
> repo** and auto-resolves — do **not** strip it when integrating. See [Hard dependencies](#hard-dependencies).

---

## Current capabilities (what the agent does today)

Beyond basic CRUD, these behaviors are built in and matter for integration:

- **Pre-deploy chart preview (ECharts).** `render-dashboard-preview` emits a `<chart-preview>` block that the browser UI (`server.mjs`) renders as **live charts, tables, KPI tiles and filter dropdowns** — every widget drawn as its true type (bar/line/combo/donut/scatter/funnel/waterfall/heatmap/stacked + table/number/filter). It is a **read-only view of the dashboard JSON** with placeholder data — it proves LAYOUT/shape, never mutates the deploy JSON, and never proves renderability by itself.
- **Post-deploy self-verification.** `diagnose-dashboard` executes **every step's query live** against `/wave/query` AND checks **chart wiring** (widget-viz vs step-viz, and whether the data-binding form matches the viz type). A dashboard is not "done" until it returns "No issues found." This catches both red-box query errors and blank-widget wiring mismatches without a human opening the dashboard.
- **One-dashboard-at-a-time build gate.** The agent builds a single dashboard, shows the preview, and **asks before deploying** — a standing gate that a task prompt ("build both") cannot override. Deploys require `confirm:true` **and** `DEPLOY_DRY_RUN=false`.
- **RAG-grounded authoring.** For any chart type beyond hbar/vbar it reads the verified JSON skeleton from `reference/` before authoring (per-type `columnMap` keys differ; guessing renders broken widgets).
- **Resume safety.** On a new session it verifies remembered assets against the live org before acting (memory can drift from reality).

---

## Integrating into an existing Mastra orchestration

Both agents are plain Mastra `Agent` instances — the same primitive every other agent in your cluster uses. If your orchestration platform already runs on Mastra, this is a drop-in. No adapters, no API shims, no restructuring.

---

### How the agents fit into your cluster

```
Your Mastra orchestrator
        │
        ├── Agent A  (your existing agents)
        ├── Agent B
        ├── Agent C
        ├── crmaCopilot   ◄── this repo
        └── crmaDebugger  ◄── this repo (internal — orchestrator never calls it directly)
```

The orchestrator calls `crmaCopilot` when the user needs anything CRMA-related. Internally, `crmaCopilot` escalates to `crmaDebugger` (Opus) when it hits a hard error. The orchestrator never needs to know the debugger exists.

---

### 1. Register alongside your existing agents

```js
import { Mastra } from '@mastra/core';
import { copilot } from './CRMA Mastra/src/mastra/agents/copilot.mjs';
import { debugger_ } from './CRMA Mastra/src/mastra/agents/debugger.mjs';

// One merge — nothing else changes in your Mastra instance.
const mastra = new Mastra({
  agents: {
    ...existingAgents,
    crmaCopilot:  copilot,
    crmaDebugger: debugger_,  // optional at this level — copilot calls it internally
  },
  storage: existingStorage,   // share your storage — our memory works with any LibSQL/PG store
  logger:  existingLogger,
});
```

> **Two things travel with the import, not just the code:**
> 1. **The `reference/` RAG folder must be present on disk** relative to `reference.mjs` (it auto-resolves to `<repo>/reference`), or set `RAG_REFERENCE_DIR`. If you vendor only `src/` into another tree, copy `reference/` too (or point the env var at it). Without it, `search-reference` returns "reference folder not found" and authoring quality degrades badly.
> 2. **The `sf` CLI + `.env`** — the agent shells out to `sf` for all Salesforce I/O and reads model/gateway/org config from env. These are process-level, not passed through Mastra. See [Salesforce org connection](#salesforce-org-connection).

> **The ECharts chart preview is a UI-layer feature, not an agent-layer one.** `render-dashboard-preview` returns a `<chart-preview>{…json…}</chart-preview>` text block in the agent's output; the **rendering** lives in this repo's `src/server.mjs` (browser UI). If your orchestrator calls `crmaCopilot.generate()` headlessly and surfaces output in **your** frontend, you must render that block yourself (port the ECharts logic from `server.mjs`, ~150 lines) or the user sees raw JSON. The deploy path does not depend on the preview at all.

---

### 2. Call from your orchestrator — native Mastra pattern

Since all agents are on the same Mastra instance, the orchestrator calls ours exactly like any other agent:

```js
// Inside your orchestrator agent's tool execution
const crmaAgent = mastra.getAgent('crmaCopilot');

const result = await crmaAgent.generate(
  [{ role: 'user', content: task }],
  {
    memory: {
      thread:   threadId,    // pass the same threadId across calls — agent remembers context
      resource: resourceId,
    }
  }
);

return result.text;
```

Or expose it as a tool your orchestrator can call by name:

```js
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const crmaTool = createTool({
  id: 'crma-copilot',
  description:
    'Handle any CRM Analytics task: get, edit, debug, create, or deploy ' +
    'CRMA recipes and dashboards in a Salesforce org.',
  inputSchema: z.object({
    task:       z.string().describe('The CRMA task to perform'),
    threadId:   z.string().optional().describe('Conversation thread ID for memory continuity'),
    resourceId: z.string().optional().describe('User/resource ID for memory continuity'),
  }),
  execute: async (input) => {
    const agent  = mastra.getAgent('crmaCopilot');
    const result = await agent.generate(
      [{ role: 'user', content: input.task }],
      { memory: { thread: input.threadId, resource: input.resourceId } }
    );
    return { response: result.text };
  },
});
```

---

### 3. Memory continuity across orchestrator calls

The agent uses LibSQL-backed memory. Pass the same `threadId` + `resourceId` on every call and the agent remembers the full conversation — including what it built in a previous call.

```js
// Call 1 — orchestrator asks CRMA agent to build Recipe 1
await crmaAgent.generate(
  [{ role: 'user', content: 'Build the Opportunity Analytics recipe.' }],
  { memory: { thread: 'crma-build-001', resource: 'user-123' } }
);

// Call 2 — later, same thread — agent remembers Recipe 1 was built
await crmaAgent.generate(
  [{ role: 'user', content: 'Now build a Pipeline Health dashboard on top of it.' }],
  { memory: { thread: 'crma-build-001', resource: 'user-123' } }  // same thread
);
```

For large builds (many recipes + dashboards), break the work across calls on the same thread rather than sending the full specification in one message. Each call stays within the 200K token context window; memory stitches the sessions together.

---

### 4. Shared storage — use your existing store

If your platform has a central LibSQL or Postgres store, pass it directly. Our agent's memory works with either:

```js
// Option A — share your existing LibSQL store
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';

// In your platform's agent factory:
export function createCrmaCopilot(storage) {
  return new Agent({
    name: 'crma-copilot',
    instructions: INSTRUCTIONS,      // exported from copilot.mjs
    model: sonnet(),
    memory: new Memory({ storage, options: { lastMessages: 40 } }),
    maxSteps: 100,
    tools: { ...recipeTools, ...dashboardTools, ...referenceTools, ...debuggerTools },
  });
}

// Option B — keep our standalone DB (default, no change needed)
// Our copilot.mjs creates its own LibSQL file at src/mastra/crma-memory.db
```

---

### 5. `DEPLOY_DRY_RUN` in a shared environment

| Environment | Setting | Effect |
|---|---|---|
| Dev / test | `DEPLOY_DRY_RUN=true` | All deploys are dry-run only — safe for iteration |
| Staging / demo | `DEPLOY_DRY_RUN=false` | Live deploys enabled — still requires per-deploy chat approval |
| Production | `DEPLOY_DRY_RUN=false` | Same as staging — two-gate system is the safety layer |

Even with `DEPLOY_DRY_RUN=false`, the agent **never deploys silently**. It always shows a preview, waits for explicit user approval, then calls deploy with `confirm:true`. Both the env flag and the in-chat approval must be open simultaneously.

---

### 6. Long-running calls — streaming option

Complex dashboard builds (multiple dataset queries + preview rendering) can take 30–90 seconds. If your orchestrator needs to show progress to the user rather than waiting for a complete response:

```js
// Use stream() instead of generate() — works identically on the Mastra Agent
const stream = await crmaAgent.stream(
  [{ role: 'user', content: task }],
  { memory: { thread: threadId, resource: resourceId } }
);

for await (const chunk of stream.textStream) {
  // pipe chunk to your UI — user sees the agent thinking in real time
}
```

---

### Hard dependencies

1. **`reference/` folder** — the RAG knowledge base (**109 files**, ~1.4MB). **Ships committed inside this repo at `./reference/`** and auto-resolves at runtime (the code checks the in-repo path first). Override with `RAG_REFERENCE_DIR=/absolute/path` only if you relocate it. **This is not optional** — the agent's widget shapes, SAQL patterns, and deploy-crash avoidance all come from here via the `search-reference` / `read-reference` tools. Notable contents: `DASHBOARD_PATTERNS.md` (deploy gotchas + crash fixes), `Dashabord/Widget visualizationType skeletons` (verified JSON for all 23 chart types), `SAQL_PATTERNS.md`, `Success log/` (verified-dashboard records), `EChart/` (preview renderer references).

2. **`sf` CLI** — must be installed and authenticated on the server running the Mastra instance. The agent shells out to it for all Salesforce I/O. Install: `npm install -g @salesforce/cli`. Auth: `sf org login web --alias your-org`.

3. **Environment variables** — 6 required vars. Copy `.env.example` to `.env`:

| Var | Required | Purpose |
|---|---|---|
| `SF_TARGET_ORG` | Always | Org alias from `sf org list` |
| `LLM_PROVIDER` | Always | `gateway` (SF internal) or `anthropic` |
| `SF_GATEWAY_TOKEN` / `SF_GATEWAY_BASE_URL` | When `gateway` | SF internal model gateway credentials |
| `NODE_EXTRA_CA_CERTS` | When `gateway` | Path to SF CA bundle PEM for gateway TLS |
| `ANTHROPIC_API_KEY` | When `anthropic` | Direct Anthropic API key |
| `DEPLOY_DRY_RUN` | Always | `true` = safe default; `false` = live writes |
| `RAG_REFERENCE_DIR` | Optional | Override reference folder path |

---

### Agent exports

| Export | File | Model | maxSteps | Role |
|---|---|---|---|---|
| `copilot` | `src/mastra/agents/copilot.mjs` | **Opus 4.8** (`opus()`; swap to `sonnet()` for cheaper/faster) | 100 | Primary agent — all recipe + dashboard operations, fuzzy field matching, dummy-data fallback, pre-deploy **ECharts preview**, post-deploy `diagnose-dashboard` self-verification |
| `debugger_` | `src/mastra/agents/debugger.mjs` | Opus 4.8 | 30 | Specialist sub-agent — invoked by copilot on hard errors; returns structured fix plans. Orchestrator never calls this directly. |

**Tools (29 total), wired in `copilot.mjs`:** 13 recipe (`list/get/apply-edits/validate/deploy/run` recipes, field-access, SOQL, describe, replication) · 11 dashboard (`list/get/apply-edits/validate/deploy/create` + `query-dataset`, `get-dataset-fields`, `remap-dataset-ids`, **`render-dashboard-preview`**, **`diagnose-dashboard`**) · 4 reference/RAG (`search`/`read`/`list`/`write-reference`) · 1 debugger delegate. The model tier is set at the bottom of `copilot.mjs` (`model: opus()`), importing `opus`/`sonnet` from `models.mjs`.

---

### Version alignment

This project runs on:

```
@mastra/core         ^1.61
mastra               ^1.26   (dev — Studio)
ai                   ^7      (AI SDK v7)
@ai-sdk/openai-compatible  ^3
@ai-sdk/anthropic    ^4
@mastra/memory       ^1.27
@mastra/libsql       ^1.21
```

**Before integrating, align on `@mastra/core` version with the architect.** If the platform is on a different minor version, the `Agent` API, memory shape, or tool call signature may differ. Check:

```bash
# Your platform
cat package.json | grep "@mastra/core"

# This repo
# @mastra/core@^1.61
```

If versions differ, either pin this repo to the platform version or coordinate an upgrade.

---

## Switching the LLM

The agent runs on **Claude Opus 4.8** by default. All model selection lives in **one file — `src/mastra/models.mjs`** — which exposes two tiers, `sonnet()` and `opus()`, behind a provider switch. The agents just ask for a tier; they don't care which backend serves it. There are three levels of change, from trivial to a small code edit.

### A. Change the Claude tier (no code — one line in an agent)

`copilot.mjs` sets `model: opus()` at the bottom. Swap to `sonnet()` for cheaper/faster, or back to `opus()` for deepest reasoning. That's the only change.

### B. Switch how Claude is delivered (env only — no code)

Set `LLM_PROVIDER` in `.env`:

| `LLM_PROVIDER` | Backend | Keys needed in `.env` |
|---|---|---|
| `gateway` (default) | Salesforce internal model gateway (LiteLLM, OpenAI-compatible) | `SF_GATEWAY_TOKEN`, `SF_GATEWAY_BASE_URL` (ends in `/v1`), `NODE_EXTRA_CA_CERTS` |
| `anthropic` | Public Anthropic API | `ANTHROPIC_API_KEY` |

Optionally override the exact model IDs without touching code: `GATEWAY_MODEL_OPUS`, `GATEWAY_MODEL_SONNET` (gateway) or `ANTHROPIC_MODEL_OPUS`, `ANTHROPIC_MODEL_SONNET` (anthropic).

### C. Run on a NON-Claude model (e.g. your platform's LLM — small code edit)

Both built-in providers serve Claude. To run the agent on a different vendor (OpenAI GPT, Google Gemini, Azure OpenAI, Bedrock, another LiteLLM/OpenAI-compatible gateway, etc.), edit **`models.mjs` only** — nothing in the agents or tools changes, because they consume `sonnet()`/`opus()` abstractly.

1. **Add the AI-SDK provider package** (all are AI SDK v7 compatible):
   ```bash
   npm install @ai-sdk/openai      # or @ai-sdk/google, @ai-sdk/azure, @ai-sdk/amazon-bedrock, …
   ```
2. **Add a builder in `models.mjs`** mirroring the existing `buildGateway()` / `buildAnthropic()` — it must return an object with `sonnet` and `opus` functions:
   ```js
   import { createOpenAI } from "@ai-sdk/openai";
   function buildOpenAI() {
     const a = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
     return {
       sonnet: () => a(process.env.OPENAI_MODEL_FAST || "gpt-4o-mini"), // "fast" tier
       opus:   () => a(process.env.OPENAI_MODEL_DEEP || "gpt-4o"),      // "deep reasoning" tier
     };
   }
   ```
3. **Wire it into the provider switch** (the `impl` line):
   ```js
   const impl = PROVIDER === "anthropic" ? buildAnthropic()
              : PROVIDER === "openai"    ? buildOpenAI()      // ← add
              :                            buildGateway();
   ```
4. **Set the key + provider in `.env`:** `LLM_PROVIDER=openai` and `OPENAI_API_KEY=sk-...`

That's the entire change. The agents keep calling `opus()`/`sonnet()`; only what those return is different.

> ⚠️ **Caveat — model capability, not wiring.** This agent's correctness depends on **strong tool-use + long-context reasoning** (multi-step recipe/dashboard authoring, JSON surgery, self-verification loops with `maxSteps: 100`). It was tuned on Claude Opus. A weaker model may wire up fine but produce lower-quality recipes/dashboards or loop. Validate against the `Use case` test docs before trusting a swapped model in production. Also confirm the provider supports **streaming tool calls** (used by the browser UI).

---

## Troubleshooting — where integration commonly gets stuck

Ordered by how likely they are to bite on a fresh clone. Each is a real property of this repo, not hypothetical.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | `SyntaxError: Unknown option '--env-file'` or env vars all `undefined` | The run scripts use **`node --env-file=.env`**, which needs **Node ≥ 20.6** (ideally 20 LTS+). There is **no `engines` field** enforcing this. | Use Node 20.6+ (dev'd on Node 22–26). If your platform loads env differently (e.g. dotenv, container env), you don't need `--env-file` at all — just ensure the vars are in `process.env` before importing the agent. |
| 2 | `postinstall` fails or does nothing | `npm install` runs a **postinstall hack** that patches Mastra Studio's bundled `maxSteps:15`→`100` so long agent runs aren't truncated in **Studio**. It's wrapped in try/catch and is **Studio-only** — irrelevant if you import the agent into your own orchestrator. | Safe to ignore its output. If it errors on your CI, it won't block the agent — the agent's own `maxSteps: 100` is set in `copilot.mjs`, not by this patch. You can delete the postinstall script when vendoring. |
| 3 | `SF_TARGET_ORG is not set` / all Salesforce calls fail | The agent shells out to the **`sf` CLI** and needs (a) the CLI installed, (b) an **authenticated org**, (c) `SF_TARGET_ORG` set to that org's alias. None of this is bundled. | `npm i -g @salesforce/cli` → `sf org login web --alias your-org` → set `SF_TARGET_ORG=your-org` in `.env`. Confirm with `sf org list`. |
| 4 | Deploys silently do nothing / "dry run" | `DEPLOY_DRY_RUN` **defaults to `true`** when unset (fail-safe). Live writes need it explicitly `false` **and** the tool call must pass `confirm:true`. | Set `DEPLOY_DRY_RUN=false` in `.env` for real deploys. Both gates must be open. (Keeping the default `true` in shared/CI envs is the safe choice.) |
| 5 | Agent works but recipes/dashboards are low quality or it "doesn't know" widget shapes | The **`reference/` RAG folder is missing or not resolving** (you vendored only `src/`). `search-reference` returns "reference folder not found." | Ship `reference/` alongside the code (auto-resolves to `<repo>/reference`) or set `RAG_REFERENCE_DIR` to its absolute path. See [Hard dependencies](#hard-dependencies). |
| 6 | Two users / two requests clash on the wrong org, or org can't be chosen per-call | **Single org per process** — `SF_TARGET_ORG` is read into a module constant at import, and `.sfdx-work/` is one shared scratch DX project. Not safe for concurrent multi-org use as-is. | See [Current limitation — single org per server start](#current-limitation--single-org-per-server-start) for the small `sf.mjs` refactor to make org per-call. |
| 7 | Gateway calls fail with TLS / cert errors | The SF model gateway needs `NODE_EXTRA_CA_CERTS` pointing at the SF CA bundle PEM. Easy to forget. | Set `NODE_EXTRA_CA_CERTS=/path/to/sf-ca-bundle.pem` in `.env` (only for `LLM_PROVIDER=gateway`). Not needed for `anthropic`. |
| 8 | Gateway `Connect Timeout` / `UND_ERR_CONNECT_TIMEOUT` | The gateway is a **corp-network endpoint** — needs VPN/network reachability; the default connect timeout is tight. | Confirm VPN is up and the host resolves. If the endpoint is reliably slow, retry (the SDK marks these retryable) or switch `LLM_PROVIDER=anthropic` to isolate network vs. model issues. |
| 9 | Wave REST API version drift | `sf.mjs` calls a **pinned API version (`v62.0`)**; deployed dashboard JSON may reference other versions (e.g. `v67.0` in dataset URLs — harmless, org-generated). | If the target org is on a newer API, bump the version string in `sf.mjs`. Usually not required — `v62.0` is widely compatible. |
| 10 | Chart preview shows raw JSON, not charts | The **ECharts preview renderer lives in `src/server.mjs` (the browser UI)**, not in the agent. A headless orchestrator gets a `<chart-preview>{…}</chart-preview>` text block. | Render that block in your frontend (port ~150 lines from `server.mjs`) or treat it as an optional preview. The deploy path does not depend on it. |
| 11 | Memory doesn't persist / "forgets" across orchestrator calls | The agent's LibSQL memory keys on a **thread/resource id**. If the orchestrator doesn't pass a stable `thread`+`resource` per conversation, each call starts fresh. | Pass the same `{ memory: { thread, resource } }` across calls — see [Memory continuity](#3-memory-continuity-across-orchestrator-calls). Or share your platform's storage adapter. |

---

## Salesforce org connection

### How it currently works

The agent connects to Salesforce through the **already-authenticated `sf` CLI** on the machine. No OAuth app or session token is needed in code — the agent reuses the CLI's stored credentials.

The target org is set once in `.env`:

```
SF_TARGET_ORG=storm-org   ← org alias from `sf org list`
```

This is read as a module-level constant at server startup (`sf.mjs` line: `export const TARGET_ORG = process.env.SF_TARGET_ORG`). Every tool call — REST queries, Metadata retrieve/deploy — passes `--target-org storm-org` to the `sf` CLI. **The org is fixed for the lifetime of the process.**

### Embedding on a platform where ONE Salesforce org is shared by all agents (recommended integration)

This is the common multi-agent-platform model: the platform is connected to **a single Salesforce org**, and every Mastra agent on it (including this one) operates against that same org. **Our agent's current single-org design is a direct fit for this — no refactor needed.** The architect only has to make our agent point at the platform's shared org. There are two clean ways to do that; pick whichever matches how the platform already holds its Salesforce connection.

**Option 1 — the platform authenticates the `sf` CLI once (simplest, matches today's design).**
The agent reuses whatever org the `sf` CLI is authenticated against — it stores no credentials of its own. So on the platform host/container:

```bash
# once, at platform provisioning (or in the image build):
sf org login web --alias platform-org          # or: sf org login sfdx-url --sfdx-url-file <auth-url> --alias platform-org
sf org list                                     # confirm "platform-org" is present + connected
```

Then set the shared org alias in the environment every agent process inherits:

```
SF_TARGET_ORG=platform-org      # same value for our agent as for the rest of the platform
```

That's the entire integration for the shared-org case. Every tool call our agent makes will target `platform-org`. **The single-org-per-process behavior is exactly what you want here** — there is nothing to change in `sf.mjs`.

> Non-interactive hosts (CI, containers, no browser): don't use `sf org login web`. Authenticate once with an **SFDX auth URL** (`sf org login sfdx-url --sfdx-url-file ./auth.url --alias platform-org`) or a **JWT bearer flow** (`sf org login jwt --client-id <connected-app> --jwt-key-file server.key --username <user> --alias platform-org`), then set `SF_TARGET_ORG=platform-org`. The auth URL / JWT key is a secret — inject it via the platform's secret store, never commit it.

**Option 2 — the platform holds the Salesforce connection itself and injects the alias.**
If the platform manages org auth centrally and exposes a per-deployment alias, it only needs to set one env var before our agent process starts:

```js
// in the platform's agent-bootstrap, before importing/starting the CRMA agent:
process.env.SF_TARGET_ORG = platform.salesforce.orgAlias;   // the one shared org
```

Because `TARGET_ORG` is read at import time, set it **before** the agent module loads. The `sf` CLI must still be authenticated against that alias on the host (Option 1's login step) — `SF_TARGET_ORG` only *names* the org; the CLI session is what actually authorizes the calls.

**What the architect must guarantee for the shared-org model to work:**
1. `sf` CLI is installed on the agent host (`npm i -g @salesforce/cli`).
2. The shared org is authenticated in that CLI (`sf org list` shows it as connected) — this is platform-level setup, done once.
3. `SF_TARGET_ORG` is set to that org's alias in the agent's environment.
4. The authenticating `sf` user has CRM Analytics permissions (create/edit recipes & dashboards) and the **Analytics Cloud Integration User** has field read on the objects recipes will load (see the FLS helper in `sf.mjs` — `checkIntegrationUserFieldAccess` / `grantIntegrationUserFieldAccess`).
5. `DEPLOY_DRY_RUN` is set intentionally (default-safe `true` = validate only; `false` = real writes). See [`DEPLOY_DRY_RUN` in a shared environment](#5-deploy_dry_run-in-a-shared-environment).

If instead the platform lets the **end user choose** an org per request (many orgs, not one shared), that's the dynamic case below — a small refactor.

### Current limitation — single org per server start

There is no mechanism today for the user to switch orgs mid-conversation or for the orchestrator to pass a different org per call. If you restart the server with a different `SF_TARGET_ORG` in `.env`, the agent points at the new org.

### What is needed for dynamic org selection (architect integration)

In the master agent platform, the user selects an org from the UI. That org alias needs to flow through to this agent's tool calls. The fix requires a small refactor in `sf.mjs`:

```js
// Current — org is a module constant, fixed at startup
export const TARGET_ORG = process.env.SF_TARGET_ORG || "";

// Required — org is resolved at call time so the orchestrator can set it per request
export function getTargetOrg() {
  return process.env.SF_TARGET_ORG || "";
}
```

The orchestrator then sets `process.env.SF_TARGET_ORG` to the user-selected alias before calling `copilot.generate()`. Since Node's `process.env` is mutable at runtime, this works without restarting the server.

**This change is noted as a pending integration task** — implement it when wiring the CRMA agent into the master platform's org-selection flow.

---

## Phase-based execution for complex requirements

### The idea

When a user gives the agent a large, multi-part requirement (multiple recipes + multiple dashboards), the agent should not attempt to execute everything in one response. Instead it should:

1. **Analyse the full requirement** and break it into numbered phases
2. **Present the phase plan** to the user — what each phase covers, why that order
3. **Ask for approval** to proceed with Phase 1
4. **Execute Phase 1** — completely, with validation and confirmation
5. After Phase 1 is confirmed done, **ask if ready to proceed with Phase 2**
6. Continue phase by phase until complete

### Why this makes sense

| Without phases | With phases |
|---|---|
| Agent tries to build 10 recipes + 8 dashboards in one context window | Each phase fits within context limits |
| User gets a giant plan but no execution | User sees tangible output after each phase |
| If something fails mid-way, hard to resume | Each phase is a clean checkpoint — resume from last completed phase |
| Orchestrator has no visibility into progress | Orchestrator gets a result per phase, can track status |
| Context fills up before dashboards are built | Recipes are confirmed working before dashboards are built |

### Natural phase order for a full CRM Analytics build

```
Phase 1 — Discovery
  Check which source objects exist and are replicated in the org
  Identify missing objects / FLS issues upfront
  Output: confirmed object list, replication status

Phase 2 — Foundation recipes (independent, no cross-dataset joins)
  Recipe per source domain: Opportunity, Account, Product
  Run each, confirm row counts
  Output: 3 base datasets confirmed live

Phase 3 — Derived recipes (depend on Phase 2 datasets)
  Stage History, Lead Funnel, Sales Rep Performance
  These join or reference Phase 2 outputs
  Output: 3 derived datasets confirmed live

Phase 4 — Complex recipes (multi-source, formula-heavy)
  Risk Score, Customer Revenue, Forecast Analytics
  Depend on Phase 2 + Phase 3 datasets
  Output: complete dataset layer

Phase 5 — Core dashboards (depend on Phase 2-3 datasets)
  Executive, Pipeline Health, Sales Performance
  Output: 3 dashboards deployed and previewed

Phase 6 — Advanced dashboards
  Forecast & Risk, Customer 360, Product Intelligence
  Output: 3 more dashboards

Phase 7 — Operational dashboards
  Lead Funnel, Sales Ops Command Center, Data Quality
  Output: full dashboard layer complete

Phase 8 — Filters, drill-downs, interactions
  Wire cross-widget filters and drill-down paths across all dashboards
  Output: fully interactive application
```

### Status

Phase-based execution is a **planned instruction enhancement**. The agent currently responds to each prompt individually — if you paste a full requirements document, it will produce a phase plan in its response but will not automatically gate execution per phase.

The planned behaviour (to be implemented):
- Agent detects a multi-phase requirement (multiple recipes or dashboards in one prompt)
- Outputs the phase plan as a numbered list
- Executes Phase 1 immediately after presenting the plan
- Ends each phase with a summary of what was built and asks "Ready for Phase 2?"
- Stores phase state in memory so the build can resume in a later session

---

## Version note

Runs on the current Mastra line: `@mastra/core@^1.61`, `mastra@^1.26`, **AI SDK v7**
(`ai@^7`, `@ai-sdk/openai-compatible@^3`, `@ai-sdk/anthropic@^4`).
- **Install guard:** if this machine's `~/.npmrc` has `min-release-age`, the
  project's local `.npmrc` (`min-release-age=0`) lets the current Mastra line install.
- Opus/Sonnet on the gateway require `temperature: 1` (they reject `0`) — the runners set this.
- Studio prints an "in-memory storage" note — harmless for the demo (nothing needs
  to persist across restarts). Add `@mastra/libsql` or `@mastra/pg` for durable storage.
