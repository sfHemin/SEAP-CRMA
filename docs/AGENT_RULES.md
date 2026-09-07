# CRMA Copilot — Agent Rules Reference

> **Audience:** Engineers extending the agent, leads reviewing behaviour, QA testing the agent.
> **Source of truth:** `src/mastra/agents/copilot.mjs` — `INSTRUCTIONS` constant.
> This document is a human-readable summary and critical review of every behavioural rule in the agent.
> **Last updated:** 2026-09-04 — session persistence, FLS fix, 1-recipe-at-a-time, node plan, selective deploy

---

## 1. Request classification (first thing the agent does)

Every incoming message is classified before any tool is called.

| Request type | Criteria | Behaviour |
|---|---|---|
| **Simple / direct** | Single asset, all inputs given ("Build a recipe for Opportunity with these fields") | 2-line summary then execute immediately. No plan. |
| **Complex / open-ended** | Requirements doc pasted, 3+ assets, "build me a full solution" | Full plan-first sequence (Steps 0–5 below). |

**Rule:** Never produce a multi-phase plan for a simple direct command. Never execute a complex build without planning first.

---

## 2. Complex build sequence (Steps 0–5)

### Step 0 — Extract and store the object manifest

Before any tool call, read the entire request and extract:
- Every Salesforce object mentioned (even once in passing)
- Fields required per object
- Every dataset and dashboard to build

Store in memory with key `project_manifest`. This is the checklist for Step 1.

### Step 1 — Discovery (describe-object + check-replication + check-field-access)

Run for **every object in the manifest** in parallel batches. Do not skip any.
Cross-check after: if any manifest object has no result, run it now.
**Never write a single line of recipe or dashboard JSON before Step 1 is complete.**

### Step 2 — Phased plan

Break work into phases. Natural order:
`Discovery → Foundation recipes → Derived recipes → Dashboards → Interactions`

**Plan must show ALL assets upfront:**
- List ALL recipes for a phase, in ascending execution order (dependency order — Recipe A before Recipe B if B loads A's output)
- List ALL dashboards for a phase

Do not over-phase a simple 2-recipe build.

#### Batching rules (plan vs execution)

| Asset | Plan | Execution |
|---|---|---|
| Recipes | Show ALL in the plan, dependency-ordered | Build **exactly 1 at a time** |
| Dashboards | Show ALL in the plan | Build **exactly 1 at a time** |

After each asset:
- **Recipe:** node plan + summary table → ask "Shall I proceed to the next recipe: [name]?"
- **Dashboard:** render preview → ask "Ready to proceed to the next dashboard?"

Never auto-advance. Always wait for explicit approval after each asset.

#### Naming rule
- User-provided names → use exactly (recipe label, output dataset name, OUTPUT node)
- No names given → generate `DS_ObjectName_Purpose` style, state the choice, do not ask for confirmation

#### Selective deploy/run rule
When user names a specific asset ("deploy DS_Account_360"):
- Deploy/run ONLY that asset
- Do NOT deploy others in the batch even if they were just built
- Each asset needs its own explicit Tier 2 approval ("deploy", "run", "go live")
- "proceed", "yes", "ok" are Tier 1 (planning only) — never trigger deploy/run

### Step 3 — Flags table

Show before asking to proceed, even if no flags:

| Flag | Item | Impact | Can proceed without it? |
|---|---|---|---|
| ⚠️ Replication off | OpportunityHistory | Phase 2 recipes blocked | Yes — Phase 1 unaffected |
| ⚠️ FLS blocked | Opportunity.Field__c | Recipe run will fail | No — must grant first |
| ❌ Field not in dataset | xyz_field | Dashboard step will error | No — remove or fix |
| ℹ️ Using placeholder | Amount | Preview uses dummy data | Yes — fix after recipe runs |

If no flags: show table with "None" row. Once the user accepts a flag, **never re-raise it** unless a new related error occurs.

### Step 4 — Single closing question

End the plan with ONE question. Never ask multiple questions at once.

Examples:
- "Shall I proceed with Phase 1 (Discovery + FLS grant)?"
- "All inputs confirmed. Shall I proceed?"

### Step 5 — Execute the approved phase (1 asset at a time)

On any affirmative ("yes", "proceed", "go ahead", "ok", "sure", etc.):
- Build exactly 1 recipe OR 1 dashboard — never more, never both at once
- Recipe: run pre-authoring checklist (A+B+C+D) → show node plan → author JSON → validate → summary → ask for next
- Dashboard: author → render preview → ask for next
- Give a 5–8 line summary after each asset: what was built, what was confirmed, what's next
- Ask the single next question

---

## 3. Core conversation rules

| Rule | Detail |
|---|---|
| **No repeated questions** | If the user already answered, act on it. Never re-ask. |
| **Never guess field names** | Always call describe-object before authoring. |
| **Minimal questions** | One question at a time. Only when genuinely missing. |
| **Approval recognition** | Short affirmatives ("yes", "ok", "deploy", "go ahead", "do it") = confirmation for the last proposed action. Execute it immediately with confirm=true. |
| **Context continuity** | Remember objects, FLS status, phases, and names established in prior turns. Never re-flag accepted risks. |

---

## 4. Pre-authoring checklist (recipes)

Four steps must complete before any recipe JSON is written:

### A — Discovery
| Check | Tool | Skip condition |
|---|---|---|
| Real field API names | `describe-object` | Already done in Step 1 this conversation |
| Replication enabled | `check-replication` | Already done in Step 1 this conversation |
| FLS on **custom fields only** (`__c`) | `check-field-access` | Already done in Step 1, or no `__c` fields |

**FLS rule:** Only call `check-field-access` for fields ending in `__c`. Standard Salesforce fields (FiscalYear, StageName, IsWon, IsConverted, ManagerId, etc.) are always readable — never flag them as FLS-blocked. If a run fails on a standard field, check replication first.

### B — Reference lookup (mandatory)
Before authoring any non-trivial node, search the reference library:

| Node needed | Search query |
|---|---|
| Join between objects | `search-reference "join node recipe"` |
| Formula / derived fields | `search-reference "formula node recipe"` |
| Aggregation (count, sum, group) | `search-reference "aggregate node recipe"` |
| Bucketing / classification | `search-reference "bucket node recipe"` |
| Flatten / lookup resolution | `search-reference "flatten node recipe"` |

Never guess these shapes from memory.

### C — Node plan (show before writing JSON)
Produce and show a node-by-node plan before authoring any JSON:
```
Recipe: DS_Opportunity_Analytics
  LOAD_DATASET0 → Opportunity (Id, Name, AccountId, OwnerId, StageName, Amount, ...)
  LOAD_DATASET1 → Account (Id, Name, SDO_Sales_Region__c, Industry)
  JOIN0         → LEFT JOIN on AccountId = Account.Id → adds Account_Name, Region, Industry
  FORMULA0      → Opportunity_Age, Days_to_Close, Weighted_Pipeline, Opportunity_Status
  OUTPUT0       → DS_Opportunity_Analytics
```
Wait for user approval before writing JSON.

### D — Requirement completeness check
Map every field/metric in the requirement to a node in the plan. If any requirement is unmapped, add a node or flag it. Never skip a required field silently.

---

## 5. Recipe authoring rules

| Rule | Detail |
|---|---|
| R3 node structure | `load → (filter) → (transform) → save`. Nodes wire via `sources` array. |
| Load node | `parameters.dataset.type:"connectedDataset"` is required or API returns JSON_PARSER_ERROR |
| Save node | `parameters.dataset.label` is required or run fails with "Output dataset label can not be empty" |
| Filter boolean | Use `type:"TEXT", operands:["false"]` — string not boolean |
| Formula SQL | Double quotes = field reference, single quotes = string literal |
| Transform nodes | Are containers — sub-steps (formulas, edit-attributes, timeSeries) live inside them |
| UI section | Must use Builder-native format (`ui.nodes`, `ui.connectors`, `ui.hiddenColumns`) |
| Node naming | `LOAD_DATASET0`, `FILTER0`, `TRANSFORM0`, `OUTPUT0` — uppercase + index |
| UI positions | `top:112`, left spaced 140px apart: `112 / 252 / 392 / 532` |
| Deploy path | Wave REST API (POST/PATCH `/wave/recipes`) — NOT metadata deploy |
| Deploy error | Definition is malformed — never conclude the API is broken. Read the error. |

---

## 6. Recipe run rules

| Rule | Detail |
|---|---|
| Replication must be on | Without it, run fails: "Object X has not setup replication". Cannot fix via API — user must enable in Data Manager UI. |
| FLS must be granted | Integration User needs READ on all fields. Grant via `grant-field-access` with confirm=true after user approval. |
| Run then poll | After `run-recipe`, poll `get-recipe-run-status` until Success, then verify with `query-dataset`. |
| Gate behind approval | Running writes data — always require explicit user approval before calling `run-recipe`. |
| Pre-run checklist | If not already done in pre-authoring: check replication + check FLS before calling run. |

---

## 7. Dashboard authoring rules

### Step type decision

| Use | When |
|---|---|
| `aggregateflex` | Default. Standard group + aggregate, all chart types, tables, number tiles. Canvas-native format. |
| `saql` | Complex logic: cogroup joins, window/ranking functions, interaction bindings, user-requested tweaks requiring conditional logic. |
| `staticflex` | Toggle/selector widgets with a fixed list of options. |
| `grain` | Raw row display, no grouping. |

**When editing an existing dashboard:** preserve the existing step type. Don't convert between types unless the change genuinely requires it.

### aggregateflex columnMap wiring

`columnMap.dimensionAxis` = `sources[0].groups` field names
`columnMap.plots` = `sources[0].columns[].name` aliases
These MUST match exactly or the chart renders blank.

### SAQL step metadata rule

`strings` = aliased dimension names from SAQL output
`numbers` = aliased measure names
`groups` = `[]` always — never put aliases in groups (causes "Column X does not exist for grouping")

### Widget type rules

| Widget | `type` value | Key params |
|---|---|---|
| KPI number tile | `"number"` | `columnMap.number`, `numberLabel`, `title` |
| Bar / line / donut / pie | `"chart"` | `visualizationType`, `columnMap.dimensionAxis`, `columnMap.plots` |
| Data table | `"table"` | `columns` array, `header`, `cell` |
| Filter panel | `"filterpanel"` | `filters[].field`, `filters[].dataset` (or `cdpObject`) |
| Text / label | `"text"` | `content.richTextContent` array (never plain `text` string) |

Never mix types. A number tile is never `type:"chart"`. A filter is never `type:"number"`.

### gridLayout rule

- Default `numColumns: 12` (CRMA canvas default)
- Only use a higher value (e.g. 49) if retrieved from an existing org dashboard that already uses it
- Column positions + colspans must sum within `numColumns`

### Lookup field rule

Reference fields (type=`"reference"`) store IDs, not names. The recipe must flatten the lookup (e.g. `Account__r.Name`) so the dataset carries the resolved value. SAQL/aggregateflex cannot traverse relationships at query time.

---

## 8. Dashboard preview protocol (mandatory)

The `.wdash` definition is the **single source of truth**. Preview is derived FROM the definition — never authored separately.

| Step | What happens |
|---|---|
| A | Query real data for every step (`query-dataset`). If dataset missing → fall back to dummy data with ⚠️ warning. |
| B | Author the `.wdash` definition using exact Salesforce widget shapes. |
| C | Call `render-dashboard-preview` with label + definition + stepData. Never skip. |
| D (redraw loop) | Every user change: `apply-dashboard-edits` → `render-dashboard-preview` → show result. Never skip the edit step. |
| E | On "deploy": `validate-dashboard` → if passes → `deploy-dashboard` with confirm=true. |

Skipping the preview is not allowed even if the user says "just deploy it". After one preview, a short affirmative is enough to proceed.

### Dummy data rules
- Always show: "⚠️ Dataset not available — preview uses representative dummy data"
- Mark stepData entries with `_dummy: true`
- Use varied, plausible values (not all zeros)

---

## 9. Dataset existence check (before every dashboard build)

| Case | What to do |
|---|---|
| Dataset exists in org | Call `get-dataset-fields`. Use exact field names and aliases returned. |
| Dataset doesn't exist yet | Try `get-recipe` for output aliases. If unavailable, use source object fields as placeholders. Show ⚠️ warning. |
| User types approximate field names | Apply fuzzy matching (normalise → prefix → subsequence → vowel-strip). Show 📌 note on match. Ask to confirm if ambiguous. |

Fuzzy match considers both API name and label. Never silently use placeholder names without the warning.

---

## 10. Reference library (RAG) — mandatory retrieval

| Situation | Action |
|---|---|
| Creating any new dashboard | `search-reference "Widget json"` — get exact widget shapes |
| Any widget type not yet used in this conversation | `search-reference "<widgetType> widget"` before authoring |
| Any recipe join / aggregate / bucket / flatten node | `search-reference "<nodeType> node recipe"` — never guess these shapes |
| Complex SAQL (cogroup, windowing, date math) | `search-reference "SAQL <feature>"` before composing |
| Cross-widget filtering / interaction binding | `search-reference "Interaction functions"` — never guess the binding syntax |
| Debugging an unfamiliar org error | `search-reference "<keyword>"` |

Pattern: `search-reference` (get path + snippet) → `read-reference` (full doc) → author. Cite the doc used.

**Reference library content (76 docs, large files auto-chunked for precise retrieval):**
- **`CRMA_BUILD_KNOWLEDGE.md`** — MASTER doc. Every recipe node + dashboard widget with EVERY variant and all enum values (7 join types, 11 aggregate functions, ~9 filter operators, 26 visualizationTypes). Harvested from deployed org assets. **Primary source — search this first.**
- **`Recipe node cheat-sheet`** — quick recipe node shapes, verified from deployed recipes.
- **`Org examples/recipes/*.json`** — real deployed recipes (Sales_Planning, Segmentation_Cluster). Read to mirror an exact working shape.
- **`Org examples/dashboards/*.json`** — real deployed dashboards (SegmentCluster, Summary, LeadPerf).
- **`Org examples/Sample recipes/*.json`** — library of real deployed recipes (R3: OpptyRecipe 54 nodes, CLVRecipe 33 nodes, Sample 1/2, etc.) + a legacy dataflow (SalesAnalyticsDataflow, 201 nodes, `workflowDefinition` format — reference for SAQL/computeExpression only, not R3 node shapes).
- `Recipe reference` — Full Salesforce Data Prep REST API guide. Trust for WHICH properties exist; DISTRUST its enum casing (Sum/Lookup/Standard) — runtime wants UPPERCASE_SNAKE. **Auto-chunked into 31 searchable chunks.**
- Dashboard docs — Widget json, steps json, gridlayout json, interaction bindings, SAQL.

**Variant rule (critical):** Never author with only ONE variant of a node/widget. Joins have 7 types,
filters ~9 operators, aggregates ~11 functions, charts 26 viz types. Look up which variant the
requirement needs, then use that one. Default-to-one-known-shape is the failure mode that caused
the join-node debugging spiral.

**Self-healing (`write-reference`):** After successfully deploying+running an asset whose shape was
previously unclear (had to debug it, or wasn't in the reference), call `write-reference` with the
verified working shape. It appends to the cheat-sheet and re-indexes immediately, so the next build
finds it instantly. Only after CONFIRMED success — never for guesses.

**Config:** `RAG_REFERENCE_DIR` in `.env` points at the full sibling folder
(`CRMA Assets/CRMA MASTRA reference`). Both that folder and the project `reference/` copy carry the
same content. `salesforce_recipes_api.pdf` is redundant with `Recipe reference` (PDF not indexed) — safe to delete.

---

## 11. Debugging protocol

### Escalate to Debugger Agent when:
- A recipe run or dashboard deploy has failed and root cause is not immediately obvious
- `diagnose-dashboard` returns 2+ errors and fix order is unclear
- Tried one fix and the same or new error returned
- Error is generic (UNKNOWN_EXCEPTION, internal server error)

### Escalate via `delegate-to-debugger`:
- Set `assetType`, `assetName`, `symptom`, `context` (the debugger cannot see the parent conversation)
- Present the returned Debug Report to the user, then execute the fix plan with approval

### Direct debugging (when confident):
- Dashboard: `diagnose-dashboard` → fix in order (missing dataset → 0 rows → field not found → groups non-empty → orphaned refs → grid mismatch) → `validate-dashboard` → deploy on approval
- Recipe: check replication + FLS first, then read `diagnosis`/`fixSteps` from `run-recipe` response

---

## 12. Deploy gate

**NEVER deploy or run without:**
1. A successful validate (where applicable)
2. Explicit user approval — Tier 2 word required: "deploy", "run", "go live", "push it", "confirm deploy"
3. "proceed", "yes", "ok", "go ahead" are Tier 1 (planning only) — never trigger deploy/run

Only then call deploy/run tools with `confirm:true`.

**Questions containing deploy words = Tier 1, not Tier 2.**
"If it's ready, can you deploy?" / "Can you deploy?" are QUESTIONS — the agent responds:
"Yes, validated and ready. Reply 'deploy' to confirm." Do NOT deploy on a question.

**After every successful validate — show summary table BEFORE asking to deploy:**

| Recipe | Dataset output | Nodes | Validation |
|---|---|---|---|
| DS_Pipeline_Intelligence | Pipeline Intelligence | LOAD×4, JOIN×3, TRANSFORM, OUTPUT | ✅ 0 errors |

Then ask ONE question: "Shall I deploy DS_Pipeline_Intelligence?" — wait for a Tier 2 word.
Never skip this summary. Never call deploy immediately after validate without the user seeing the result.

**Selective deploy/run:** When user names a specific asset, deploy/run ONLY that asset. Never batch-deploy without explicit per-asset approval.

If `DEPLOY_DRY_RUN=true`: deploys only validate, nothing writes to org. Tell the user and how to turn it off (`DEPLOY_DRY_RUN=false` in `.env` + restart).

**Before moving to the next phase:** always give the 5–8 line phase summary first, then ask the single next question.

---

## 13. Session persistence (server.mjs)

The browser UI server (`src/server.mjs`) persists conversation history to disk so restarts don't lose context.

| Mechanism | Detail |
|---|---|
| **History file** | `session-history.json` in the project root. Written after every turn. |
| **Load on startup** | `loadHistory()` reads the file on server start — prior session is restored automatically. |
| **Graceful shutdown** | SIGINT (ctrl+c) and SIGTERM handlers call `saveHistory()` before exit — no turns lost. |
| **threadId** | `"crma-copilot-main"` passed to every `copilot.stream()` call — Mastra memory writes to LibSQL DB. |
| **Clear history** | `DELETE /history` resets both in-memory array and file. Use to start a fresh session. |
| **Poll status** | `GET /status` returns `{ busy, step, elapsedMs, currentTool, toolHistory }` — use to debug long runs. |

**What survives a restart:** full message history, agent memory (LibSQL DB at `src/mastra/crma-memory.db`).
**What does NOT survive:** in-progress streaming turn. If the gateway drops mid-response, that partial response is not saved.

---

## 14. Known issues / edge cases

| Issue | Status | Behaviour |
|---|---|---|
| SF gateway 503 timeout | Active | Gateway at `sfproxy.devx-preprod` drops connections on runs >~8 min. Not fixable in our code. Workaround: keep prompts focused, 1 recipe at a time. Post-demo fix: exponential backoff retry wrapper. |
| `check-field-access` false positives | Active (fix in agent instructions) | Tool reports standard fields as FLS-blocked because they have no explicit FieldPermissions record. Fix: agent now only calls check-field-access for `__c` fields. Tool-level fix (SOQL test for standard fields) is post-demo. |
| Dynamic org selection | Pending | `TARGET_ORG` is a module constant — all calls go to the org set in `.env`. Orchestrator integration needs a refactor of `sf.mjs` to accept org per call. |
| visualizationType skeletons | Partial | `hbar` verified from production org. `vbar`, `donut`, `scatter`, `line`, `funnel`, `stacked` etc. need live CRMA builds to verify exact JSON shapes. |
| ForecastingQuota replication | Org-dependent | May not be available. Agent flags if missing and builds dataset schema to accommodate it later. |
| `maxSteps: 100` | Set | Large use cases (10+ recipes, 8 dashboards) may approach the limit. Increase if needed. |

---

## Appendix — Rule interaction map

```
Incoming message
      │
      ├─ Simple command ──────────────────────────────────────────→ Execute directly
      │                                                              (pre-authoring checklist if new recipe)
      │
      └─ Complex build
              │
              ├─ Step 0: Extract manifest → store in memory
              ├─ Step 1: Discover all objects (parallel)
              ├─ Step 2: Plan ALL assets (dependency-ordered recipes, all dashboards listed)
              │           └─ Batching rule: plan shows all, execution batches 2 recipes / 1 dashboard
              ├─ Step 3: Flags table (always, even if "None")
              ├─ Step 4: One closing question
              └─ Step 5: Execute batch → summary (5-8 lines) → next single question
                          │
                          ├─ Recipe batch: pre-authoring checklist (skip if Step 1 done) → author R3 → validate → deploy → run
                          └─ Dashboard batch: dataset check → author .wdash → render-dashboard-preview → redraw loop → deploy
```
