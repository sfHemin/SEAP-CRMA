# Capability Upgrade Plan — closing the "generalist agent" gaps

**Status:** Phase 1a BUILT & tested (build-asset-graph). Phase 2 BUILT & tested (wave-rest-get,
19/19 offline acceptance tests pass). Phases 1b–1d are **fully spec'd and build-ready** (see §1.7 —
implementation-ready specs grounded in the real cached-graph shape) but not yet coded. Document-only
capabilities (#4/#5/#6) covered below. See the "Status at a glance" table at the end.
**Branch:** version-extra-changes
**Author intent:** make the CRMA Mastra agent more versatile — specifically give it the
cross-asset / org-wide reasoning and light "improvisation" that a general agent has, WITHOUT
breaking the safety guardrails (deploy gate, preview-first, single-org writes) that make it
trustworthy for a handoff.

---

## 0. Scope decision (agreed)

| # | Gap | Decision |
|---|-----|----------|
| 1 | Cross-asset / org-wide reasoning | **BUILD** (Phase 1) |
| 2 | Dependency & impact analysis (lineage) | **BUILD** (Phase 1 — same feature as #1) |
| 3 | Improvise: read-only one-off REST/SOQL | **BUILD** (Phase 2) |
| 4 | Self-extend (agent writes its own tools) | **DOCUMENT ONLY** (future; not advisable now) |
| 5 | Multi-modal / web fetch | **DOCUMENT ONLY** (future) |
| 6 | Cross-org compare | **DOCUMENT ONLY** (future) |

Design principle throughout: **new capabilities are READ-ONLY.** Nothing here writes to an org.
All existing write paths keep their Tier-2 approval + preview + one-at-a-time gates untouched.

---

## PHASE 1 — Org-wide asset graph + impact analysis  (the big win)

### 1.1 What it delivers (the user-facing questions it answers)
- "Which of the 40 dashboards break if I rename dataset field `Amount`?"
- "Find every recipe that loads the `Opportunity` object."
- "What feeds dataset `DS_Pipeline_Intelligence`, and what consumes it?"
- "If I change recipe X's output, what's the blast radius?"
- "List orphaned datasets (no dashboard reads them) / orphaned dashboards (dataset missing)."

### 1.2 Why it's achievable (verified against real assets)
The lineage endpoints are all present in the JSON we already fetch:
- **Recipe** → inputs = `load` nodes' `dataset.sourceObjectName` / `.name`; output = `save` node's `dataset.name`.
- **Dashboard** → each step's `datasets[].name` (+ SAQL `load "..."`); fields referenced in
  `query.measures/groups/filters` and widget `columnMap`/`measureAxis`.
- **Dataset** → produced by a recipe `save`; described by `get-dataset-fields`.
The building-block tools already exist: `list-recipes`, `list-dashboards`, `get-recipe`,
`get-dashboard`, `get-dataset-fields`. Phase 1 = iterate them + build a graph + query it.

### 1.3 New tools (proposed)
1. **`build-asset-graph`** — iterate `list-recipes` + `list-dashboards`, `get-*` each, parse
   nodes/steps, emit a normalized graph:
   ```
   nodes: [{id, type: recipe|dashboard|dataset|sobject, name, label}]
   edges: [{from, to, kind: loads|produces|reads|references-field}]
   ```
   Cache it in memory for the session (invalidate on demand). Include a `fieldIndex`:
   `{ "<dataset>.<field>": [assetIds that reference it] }`.
2. **`impact-of-change`** — input: an asset or a `dataset.field`. Output: the downstream
   dependents (blast radius) + the exact widgets/steps/nodes that reference it, so the user
   sees *what* would break and *where*.
3. **`find-assets`** — query the graph: "recipes loading object X", "dashboards on dataset Y",
   "orphans", "assets referencing field Z".

### 1.4 Design / safety notes
- **Read-only.** Uses only `list-*`/`get-*`/`get-dataset-fields` REST GETs. No writes.
- **Scale:** `list-recipes?pageSize=200` + N× `get-*`. For big orgs, page + cap with a logged
  "analyzed N of M (capped)" note — never silently truncate.
- **Token cost:** building the graph pulls many definitions. Cache per session; let the agent
  reuse it across follow-up questions instead of re-fetching.
- **Accuracy honesty:** SAQL `load "..."` dataset names and `${...}` template tokens must be
  resolved; where a reference can't be statically resolved, mark the edge `uncertain` rather
  than assert it.

### 1.5 Phasing within Phase 1
- **1a** `build-asset-graph` (+ in-memory cache) + unit test against the RAG sample JSONs (offline, no org).
- **1b** `find-assets` (graph queries).
- **1c** `impact-of-change` (field-level blast radius).
- **1d** Agent instructions: when to reach for these (e.g. before a rename/refactor, or on
  "which/where/what-breaks" questions) + a RAG note.

### 1.6 Acceptance test
Against the committed `reference/Org examples/**` JSON (no org needed):
- graph builds with 0 dangling edges on known-good assets;
- "recipes loading Opportunity" returns CLVRecipe + OpptyRecipe;
- "impact of renaming `Amount`" lists the exact dashboards/steps that reference it;
- orphan detection flags a dataset with no consumer.

---

### 1.7 IMPLEMENTATION-READY SPECS — pending sub-phases 1b, 1c, 1d

> These are build-ready specs, not new design. Phase 1a (`build-asset-graph`) is already
> BUILT & tested; 1b/1c are **pure functions over the cached graph** it produces, and 1d is
> instruction wiring. No org calls are added — everything reads the in-memory `GRAPH`.

### The graph these consume (already produced by `build-asset-graph`)
Source of truth: `src/mastra/tools/graphTools.mjs`. The cached `GRAPH` object has this shape:
```
GRAPH = {
  nodes: [{ id, type: "recipe"|"dashboard"|"dataset"|"sobject", name, label }],
  edges: [{ from, to, kind: "loads"|"produces"|"reads", uncertain?: true }],
  fieldIndex: { "<dataset>.<field>": [assetId, ...] },   // dashboard field references
  notes: [ ...caps / uncertain-resolution notes ],
}
```
Edge directions (verified in `buildGraph`):
- `sobject|dataset  --loads-->    recipe`   (recipe's `load` nodes)
- `recipe           --produces--> dataset`  (recipe's `save`/output node)
- `dataset          --reads-->    dashboard`(dashboard step's dataset)

Shared accessors already exported for sibling tools: **`_getGraph()`** (returns cached graph or
`null`), **`_setGraph(g)`** (test hook). 1b/1c MUST call `_getGraph()`; if it's `null`, return a
clear "run build-asset-graph first" note (do not silently build — keep the build explicit and cached).

`uncertain:true` edges (recipe `${template}` tokens, dashboard SAQL loads by id) MUST be surfaced in
results as uncertain, never asserted as fact.

---

### 1b — `find-assets` (graph queries)  ⏳ PENDING
**File:** add to `src/mastra/tools/graphTools.mjs` (same file as `build-asset-graph`, shares `_getGraph()`).
**Purpose:** answer "which/what" questions by querying the cached graph — no new fetches.

**Input schema (proposed):**
```
{ query: enum(
    "recipes-loading-object",   // needs: target (sobject name, e.g. "Opportunity")
    "dashboards-on-dataset",    // needs: target (dataset name)
    "recipes-producing-dataset",// needs: target (dataset name)
    "assets-referencing-field", // needs: target ("<dataset>.<field>" or bare "<field>")
    "orphan-datasets",          // no target: datasets with NO --reads--> dashboard edge
    "orphan-dashboards",        // no target: dashboards whose dataset node is missing/unproduced
    "list-by-type"              // needs: target ("recipe"|"dashboard"|"dataset"|"sobject")
  ),
  target: string().optional() }
```
**Output:** `{ available:boolean, results:[{id,type,name,label,uncertain?}], count, notes:[] }`.
**Logic (all pure array filters over GRAPH):**
- *recipes-loading-object*: edges where `kind==="loads"` && `from`==sobjectId(target) → map `to` (recipes).
- *dashboards-on-dataset*: edges `kind==="reads"` && `from`==datasetId(target) → map `to`.
- *recipes-producing-dataset*: edges `kind==="produces"` && `to`==datasetId(target) → map `from`.
- *assets-referencing-field*: `fieldIndex[key]` (exact `dataset.field`); if bare field, union all keys
  ending `.<field>`. Return the referenced asset nodes; mark note if the field matched >1 dataset.
- *orphan-datasets*: dataset nodes with no outgoing `reads` edge (nothing consumes them).
- *orphan-dashboards*: dashboard nodes whose incoming `reads` dataset has no `produces` edge (dataset
  never built by a recipe) OR the dataset node is absent → dangling.
- *list-by-type*: nodes filtered by `type`.
Carry `uncertain:true` onto any result reached via an uncertain edge.

**Acceptance (offline, `_setGraph` a fixture built from `reference/Org examples/**`):**
- `recipes-loading-object "Opportunity"` → includes CLVRecipe + OpptyRecipe.
- `orphan-datasets` → flags a dataset with no `reads` edge.
- returns a "run build-asset-graph first" note when `_getGraph()` is null.

---

### 1c — `impact-of-change` (field/asset blast radius)  ⏳ PENDING
**File:** add to `src/mastra/tools/graphTools.mjs`.
**Purpose:** given an asset OR a `dataset.field`, return the downstream dependents + the EXACT places
that reference it, so the user sees *what* breaks and *where* before a rename/refactor.

**Input schema (proposed):**
```
{ kind: enum("field","dataset","recipe"),
  target: string()   // field: "<dataset>.<field>"; dataset: "<name>"; recipe: "<name>"
}
```
**Output:** `{ available, target, kind, directDependents:[{id,type,name,label,via,uncertain?}],
  transitive:[...], where:[{assetId, location}], notes:[] }`.
**Logic (BFS over GRAPH edges, following the arrows downstream):**
- *field*: start from `fieldIndex["<dataset>.<field>"]` → those dashboards are direct dependents
  (`via:"references-field"`). `where` = the asset ids (the exact widget/step lookup is a nice-to-have;
  minimally list the dashboards). If a rename, EVERY listed dashboard must be checked.
- *dataset*: direct = recipes that `produce` it (upstream, would need to change output) +
  dashboards that `read` it (downstream, would break). Transitive = walk `reads`/`loads` outward.
- *recipe*: direct = the dataset(s) it `produces`; transitive = every dashboard reading those datasets
  (the blast radius of changing the recipe's output).
- Mark any path crossing an `uncertain` edge as uncertain in the result + a note.
- Cap the transitive walk (e.g. depth 3 / N nodes) and LOG the cap — never silently truncate.

**Acceptance (offline fixture):**
- `impact-of-change {kind:"field", target:"<ds>.Amount"}` → lists exact dashboards referencing Amount.
- `impact-of-change {kind:"recipe", target:"OpptyRecipe_ttc"}` → its produced dataset + any dashboards
  reading it.
- null-graph → "run build-asset-graph first" note.

---

### 1d — Agent instructions for the graph tools  ⏳ PENDING
**File:** `src/mastra/agents/copilot.mjs` — the "Org-wide reasoning + read-only improvisation" section
already exists (added in Phase 2) and already introduces `build-asset-graph`. 1d = extend it once 1b/1c
land:
- When the user asks **which/what/where-breaks/orphan/blast-radius**, call `build-asset-graph` FIRST
  (once per session — reuse the cache), then `find-assets` / `impact-of-change`.
- Before ANY rename/refactor of a dataset field or recipe output, run `impact-of-change` and SHOW the
  dependents to the user before proceeding.
- Always surface `uncertain` edges as "couldn't statically confirm" rather than asserting.
- Add a one-line RAG note (or `write-reference`) pointing at these tools for lineage questions.
**These tools are READ-ONLY** — they never change the Tier-2 deploy gate or any write path.

---

## PHASE 2 — Read-only REST/SOQL improviser

### 2.1 What it delivers
Answers novel questions that have no pre-built tool, e.g. "how many datasets over 100MB",
"list dashboards not modified in 6 months", "what's the app folder structure" — by letting the
agent issue a **read-only** Salesforce/Wave REST GET or a SELECT, instead of stopping/delegating.

### 2.2 New tool (proposed)
- **`wave-rest-get`** — a generic **GET-only** call to an allowlisted set of `/services/data/
  vXX/wave/*` (+ tooling/query) resources. Hard-blocks POST/PATCH/DELETE. Path allowlist prevents
  arbitrary calls. `run-soql` already exists for SELECTs; this widens read coverage safely.

### 2.3 Safety notes
- **GET/SELECT only**, enforced in code (method + path allowlist) — not just prompt guidance.
- No mutation verbs reachable. Rate/size caps + result truncation with a logged note.
- Explicitly documented as read-only in the tool description so the agent never expects to write via it.

### 2.4 Acceptance test
- `wave-rest-get` rejects any non-GET and any path outside the allowlist (unit test);
- a sample GET (e.g. list dataspaces) returns parsed JSON;
- `run-soql` unchanged.

### 2.5 BUILT — 2026-09-07
**Files:**
- `src/mastra/tools/restTools.mjs` (new) — the `wave-rest-get` tool + pure helpers
  (`checkPath`, `normalizeResource`, `capResult`) + test hooks (`_resetCalls`, `_getCalls`).
- `src/mastra/agents/copilot.mjs` — imported `restTools`, spread into the agent `tools` map;
  added a "What you can do → ORG-WIDE (READ-ONLY)" line and a new instruction section
  "Org-wide reasoning + read-only improvisation" (when to use build-asset-graph vs wave-rest-get
  vs run-soql, allowlist rules, truncation honesty).

**How the safety is enforced (in code, not just prompt):**
- **GET-only:** the tool has no `method` input and only ever calls `sfRestGet`, which shells
  `sf api request rest <path>` with NO `--method` flag → always GET. No reachable POST/PATCH/PUT/DELETE.
- **Path allowlist** (`ALLOW_PREFIXES`): `/wave/*`, `/query`, `/queryAll`, `/tooling/query`, `/limits`.
  Everything else is rejected, plus an explicit banned-prefix check for mutation/exec surfaces
  (`/apexrest`, `/actions/`, `/composite/`, `/tooling/sobjects/`, `/tooling/executeAnonymous`).
- **Path normalization:** accepts bare (`/wave/datasets`) or fully-qualified
  (`/services/data/v62.0/wave/datasets`) — the version prefix is stripped before the allowlist check.
- **Size cap:** arrays (top-level or object props like `{datasets:[…]}`) truncated to `limit`
  (default 50, max 500) with an explicit note — never silent.
- **Rate cap:** `MAX_CALLS_PER_SESSION = 200` per process; a warning note fires at 90%.
- **Non-throwing rejects:** disallowed path / rate cap / REST error return `{ok:false, error}` so the
  agent can read the reason and pick a valid path, rather than crashing the turn.

**Test:** 19/19 offline pure-function assertions pass (allowlist accept/reject incl. mutation surfaces,
normalization, array truncation with notes). No org needed. Re-run with the inline `node --input-type=module`
harness in the build notes, or add a permanent test later.

**Note:** requires an **agent server restart** to load the new tool (tools are registered at boot).

---

## DOCUMENT-ONLY (future capabilities — how they *could* be done, not built now)

### #4 Self-extending agent (writes/loads its own tools)
- **Why not now:** an agent that generates and loads executable code needs a real sandbox,
  code review, and a trust model. For a handoff product that also holds a deploy gate, this is a
  large security surface. **Recommendation: keep tool-authoring a human/architect task.**
- **If ever pursued:** a constrained "propose a tool spec" flow (agent writes a JSON tool *spec*
  + tests; a human reviews and merges) — never auto-load generated code.

### #5 Multi-modal / web
- **Web fetch:** feasible as a **curated allowlist** of Salesforce documentation domains (check
  API version, syntax). Overlaps with RAG; add only if RAG gaps recur. Must be GET + allowlist.
- **Image input (screenshot of a broken dashboard):** depends on the host platform wiring an
  image-capable model into the agent loop — likely the **integrating architect's** decision, not
  a tool we add here.

### #6 Cross-org
- Single-org-per-process is a **deliberate safety choice** (prevents cross-org write accidents).
- **Feasible future:** a read-only "compare mode" that connects to a second org alias for
  **diffing assets** (storm vs prod), while all *writes* stay locked to the one target org.
- Requires: a second read-only SF connection context + explicit UI/flag so it's never ambiguous
  which org a write would hit.

---

## What is explicitly NOT changing
- Deploy gate (Tier-2 approval word), dry-run default, one-recipe/one-dashboard-at-a-time,
  mandatory dashboard preview → ask → deploy → diagnose. **All untouched.**
- Single-org **writes**. (Phase 1/2 add read-only breadth only.)
- Existing tool contracts. (The 2 new tools — `build-asset-graph`, `wave-rest-get` — are additive
  and read-only; nothing existing was altered. Live tool count is now **31**, see README.)

## Rollout
1. ✅ Approve this plan.
2. ✅ Build **Phase 1a** (`build-asset-graph`) → tested offline against RAG samples.
3. ✅ Build **Phase 2** (`wave-rest-get`) → 19/19 offline tests pass.
4. ⏳ Iterate **1b → 1c → 1d** (specs in §1.7 above), each verified offline before the next.
5. ✅ README updated (architect handoff) with the new tools + the document-only roadmap
   (tool count corrected 29→31). Update again when 1b–1d land.

## Status at a glance
| Phase | Capability | Tool(s) | State |
|-------|-----------|---------|-------|
| 1a | Asset dependency graph | `build-asset-graph` | ✅ BUILT & tested |
| 1b | Graph queries (which/what/orphans) | `find-assets` | ⏳ spec ready (§1.7) |
| 1c | Field/asset blast radius | `impact-of-change` | ⏳ spec ready (§1.7) |
| 1d | Agent instructions for graph tools | (copilot.mjs) | ⏳ spec ready (§1.7) |
| 2  | Read-only REST improviser | `wave-rest-get` | ✅ BUILT & tested |
| #4 | Self-extending agent | — | 📄 document-only |
| #5 | Multi-modal / web fetch | — | 📄 document-only |
| #6 | Cross-org compare | — | 📄 document-only |
