# CRMA Copilot — Recipe Feature: Technical Reference

> **Audience:** Engineers building on, extending, or debugging the recipe capability.
> **Status:** Phase 1 — complete and verified live against storm-org (2026-08-25).

---

## Architecture Overview

```
User (Mastra Studio / browser UI / terminal)
        │
        ▼
  crma-copilot (Mastra Agent)
  model: Claude Sonnet 4.6 via SF gateway or direct Anthropic
  maxSteps: 50 (agent definition) / 100 (Studio frontend patch)
        │
        ├── recipeTools (13 tools)  ──→  sf.mjs  ──→  sf CLI
        ├── dashboardTools                              │
        └── referenceTools                             ▼
                                              Salesforce org
                                       (Wave REST + Metadata API)
```

---

## File Map

```
CRMA Mastra/
├── src/
│   ├── mastra/
│   │   ├── agents/
│   │   │   └── copilot.mjs          ← agent definition, instructions, memory
│   │   ├── tools/
│   │   │   ├── recipeTools.mjs      ← all 13 recipe tools
│   │   │   ├── dashboardTools.mjs   ← dashboard tools (Phase 2)
│   │   │   └── referenceTools.mjs   ← RAG search/read/list
│   │   ├── sf.mjs                   ← all Salesforce I/O (REST + Metadata)
│   │   ├── models.mjs               ← LLM provider selection
│   │   ├── reference.mjs            ← RAG index builder
│   │   └── index.js                 ← Mastra instance registration
│   ├── chat.mjs                     ← terminal REPL
│   ├── server.mjs                   ← browser UI (http://localhost:4111)
│   └── ask.mjs                      ← single-shot CLI question
├── package.json                     ← scripts + postinstall Studio patch
├── .env                             ← SF_TARGET_ORG, LLM_PROVIDER, keys
└── .sfdx-work/                      ← scratch DX project (auto-created)
    └── force-app/main/default/
        └── wave/                    ← .wdpr and .wdash files land here
```

---

## The 13 Recipe Tools

### `list-recipes`
**File:** `recipeTools.mjs`
**SF call:** `GET /services/data/v62.0/wave/recipes?pageSize=200`
**Returns:** `{ recipes: [{name, label, id}] }`
**Notes:** Returns all recipes in the org. No filtering — agent filters in memory.

---

### `get-recipe`
**File:** `recipeTools.mjs`
**SF call:** `sf project retrieve start --metadata WaveRecipe:{name}` (Metadata API)
**Returns:** `{ name, nodeCount, nodeIds, definition, metaXml }`
**Notes:**
- Uses Metadata retrieve, not Wave REST, because the REST response (file endpoint) returns the same payload and CLI handles auth/streaming cleanly.
- `definition` is the parsed R3 JSON: `{ version, nodes, ui, runMode }`.
- `nodes` is keyed by node id (e.g. `LOAD_DATASET0`, `FILTER0`, `OUTPUT0`).
- The retrieved `.wdpr` file lands in `.sfdx-work/force-app/main/default/wave/`.

---

### `apply-recipe-edits`
**File:** `recipeTools.mjs`
**SF call:** None (in-memory transform)
**Returns:** `{ definition, applied, errors }`
**Operations:**
```
{ action: "setValue",      node: "FILTER0", path: "parameters.filterExpressions.0.operands.0", value: "false" }
{ action: "addNode",       node: "TRANSFORM0", definition: { ... } }
{ action: "replaceNode",   node: "FILTER0",    definition: { ... } }
{ action: "deleteNode",    node: "TRANSFORM0" }
```
**Notes:**
- `setValue` uses a dot-path within the node object (not the full definition path — the node root is assumed).
- Errors are non-fatal; failed ops are reported in `errors[]`, successful ops are counted.
- Does NOT deploy. Caller passes the returned definition to `validate-recipe` then `deploy-recipe`.

---

### `validate-recipe`
**File:** `recipeTools.mjs`
**SF call:** `sf project deploy start --metadata WaveRecipe:{name} --dry-run`
**Returns:** `{ ok: boolean, output: string }`
**Notes:**
- Forces `DEPLOY_DRY_RUN=true` for this call regardless of the `.env` setting. Safe by design.
- `ok` is `true` if output contains "Succeeded".
- Writes the `.wdpr` file to `.sfdx-work/force-app/main/default/wave/` before deploying.
- Always call this before asking the user to approve a deploy.

---

### `deploy-recipe`
**File:** `recipeTools.mjs`
**SF call:** `POST /wave/recipes` (new) or `PATCH /wave/recipes/{id}` (existing)
**Returns:** `{ deployed, action, recipeId, dataflowId, message }`
**Notes:**
- Auto-detects create vs update: calls `waveFindRecipe(name)` first. If found → PATCH; if not → POST.
- **Critical:** New recipes MUST use Wave REST POST, not Metadata deploy. A Metadata deploy of a new WaveRecipe fails with `"A Recipe must specify a Dataflow"`. This was proven on storm-org.
- Existing recipes CAN be updated via Metadata deploy but Wave REST PATCH is used for consistency.
- `DEPLOY_DRY_RUN=true` blocks this entirely and returns a message explaining how to enable live writes.
- Gated by `confirm=true`. The agent only passes this after explicit user approval.
- The returned `dataflowId` (= `targetDataflowId`) is needed for `run-recipe`.

---

### `run-recipe`
**File:** `recipeTools.mjs`
**SF call:** `POST /wave/dataflowjobs { dataflowId, command:"start" }`
**Returns:** `{ started, jobId, status, message, error?, diagnosis?, fixSteps?, autoFixable? }`
**Notes:**
- Accepts either `name` (looks up `targetDataflowId` via `waveFindRecipe`) or `dataflowId` directly.
- On failure, calls `diagnoseRunError(errMsg, recipeName)` which pattern-matches against known errors and returns structured diagnosis + fix steps.
- Auto-fixable errors: FLS blocking, empty dataset label.
- Non-auto-fixable: replication not set up (Data Manager UI required), unknown exceptions.
- Gated by `confirm=true`.

**Error diagnosis patterns (in `diagnoseRunError`):**
| Pattern matched | `autoFixable` | Suggested action |
|---|---|---|
| `/has not setup replication/i` | `false` | Data Manager UI steps |
| `/isn't accessible to the Integration User/i` | `true` | `check-field-access` + `grant-field-access` |
| `/Output dataset label can not be empty/i` | `true` | Edit save node, re-deploy, re-run |
| `/UNKNOWN_EXCEPTION/i` | `false` | Check replication first, retry |

---

### `get-recipe-run-status`
**File:** `recipeTools.mjs`
**SF call:** `GET /wave/dataflowjobs/{jobId}`
**Returns:** `{ status: string, progress: number }`
**Notes:** `status` values: `Queued`, `Running`, `Success`, `Failed`. `progress` is 0–1.

---

### `check-replication`
**File:** `recipeTools.mjs`
**SF call:** `GET /wave/dataConnectors`, then `GET /wave/dataConnectors/{id}/sourceObjects/{objectName}`
**Returns:** `{ connectorId, results: [{object, replicated}], unreplicated: [], allReady: bool, fixInstructions: string|null }`
**Notes:**
- Finds the SFDC_LOCAL connector by `connectorType === "SfdcLocal"` or `name === "SFDC_LOCAL"`.
- Checks each object individually. `replicated: false` means the object hasn't been connected.
- Replication can only be enabled via Data Manager UI — the REST API exposes `sourceObjects` as GET/HEAD only.
- **Always call this before `run-recipe` for any custom object (`__c`).**
- The `fixInstructions` field contains copy-pasteable steps for the user.

---

### `check-field-access`
**File:** `recipeTools.mjs`
**SF call:** SOQL `SELECT Field FROM FieldPermissions WHERE ... AND ParentId IN (...AssigneeId='{integrationUserId}')`
**Returns:** `{ integrationUserId, results: [{field, readable, grantedBy}], blocked: [] }`
**Notes:**
- Finds the Analytics Cloud Integration User: `SELECT Id FROM User WHERE Profile.Name='Analytics Cloud Integration User'`.
- Checks FieldPermissions granted via any PermissionSet assigned to that user (covers profile-based permission sets too).
- `blocked` = fields where `readable === false`. These will cause run-time failures.
- The `field` value is `ObjectAPI.FieldAPI` format (e.g. `Apartment__c.Rent__c`).

---

### `grant-field-access`
**File:** `recipeTools.mjs`
**SF call:** `sf project deploy start --metadata PermissionSet:CRMA_Integration_FLS`, then SOQL + `sf data create record PermissionSetAssignment`
**Returns:** `{ applied, dryRun, permissionSet, output }`
**Notes:**
- Builds an XML permission set granting `readable=true`, `editable=false` on the specified fields.
- Writes to `.sfdx-work/force-app/main/default/permissionsets/CRMA_Integration_FLS.permissionset-meta.xml`.
- Deploys, then assigns to the Integration User via `PermissionSetAssignment`.
- NEVER includes required/system fields (always readable; they 400 in FLS).
- Gated by `confirm=true`. This is a security-config write.
- `DEPLOY_DRY_RUN=true` causes a dry-run deploy only (no assignment).

---

### `describe-object`
**File:** `recipeTools.mjs`
**SF call:** `sf sobject describe --sobject {objectName} --json`
**Returns:** `{ objectName, label, fieldCount, fields: [{name, label, type, required}] }`
**Notes:**
- The agent calls this automatically before authoring any new recipe. Never guesses field names.
- `type` is the Salesforce field type: `string`, `double`, `boolean`, `reference`, `date`, `datetime`, `currency`, etc.
- `reference` type = lookup field. The raw value is a record ID, not a name. When grouping/displaying a reference field, the recipe must include the relationship name field (e.g. `Apt_Location__r.Name`).

---

### `list-custom-objects`
**File:** `recipeTools.mjs`
**SF call:** `sf sobject list --sobject-type custom --json`
**Returns:** `{ objects: [string] }` — array of API names ending in `__c`

---

### `run-soql`
**File:** `recipeTools.mjs`
**SF call:** `sf data query --query "{soql}" --json`
**Returns:** `{ records: any[], count: number }`
**Notes:** Used to verify actual data values before building filter conditions (e.g. what values does `Occupied__c` actually hold?).

---

## R3 Recipe Format

The agent authors and reads recipes in **R3 format** (CRMA's native recipe JSON).

```json
{
  "version": "62.0",
  "runMode": "full",
  "nodes": {
    "LOAD_DATASET0": {
      "action": "load",
      "sources": [],
      "parameters": {
        "fields": ["Name", "Rent__c", "Occupied__c", "Beds__c"],
        "dataset": {
          "type": "connectedDataset",
          "connectionName": "SFDC_LOCAL",
          "sourceObjectName": "Apartment__c"
        },
        "sampleDetails": { "sortBy": [], "type": "TopN" },
        "label": "Apartment"
      }
    },
    "FILTER0": {
      "action": "filter",
      "sources": ["LOAD_DATASET0"],
      "parameters": {
        "filterExpressions": [
          { "type": "TEXT", "field": "Occupied__c", "operator": "EQUAL", "operands": ["false"] }
        ]
      }
    },
    "OUTPUT0": {
      "action": "save",
      "sources": ["FILTER0"],
      "parameters": {
        "fields": [],
        "measuresToCurrencies": [],
        "dataset": {
          "type": "analyticsDataset",
          "name": "Vacant_Units_Analysis",
          "label": "Vacant Units Analysis",
          "folderName": "SharedApp"
        }
      }
    }
  },
  "ui": {
    "nodes": {
      "LOAD_DATASET0": { "label": "Apartment", "type": "LOAD_DATASET", "top": 112, "left": 112 },
      "FILTER0":       { "label": "Filter",    "type": "FILTER",       "top": 112, "left": 252 },
      "OUTPUT0":       { "label": "Output",    "type": "OUTPUT",       "top": 112, "left": 392 }
    },
    "connectors": [
      { "source": "LOAD_DATASET0", "target": "FILTER0" },
      { "source": "FILTER0",       "target": "OUTPUT0" }
    ],
    "hiddenColumns": []
  }
}
```

**Critical R3 rules enforced in agent instructions:**

| Rule | Detail |
|---|---|
| `dataset.type` on load node | MUST be `"connectedDataset"` — omitting it causes `JSON_PARSER_ERROR` |
| `dataset.label` on save node | MUST be present — omitting it causes `"Output dataset label can not be empty"` at run time |
| Filter boolean values | Use `type:"TEXT"`, `operands:["false"]` (string "false", not boolean) |
| Formula SQL quoting | Double quotes = field reference, single quotes = string literal |
| `ui.nodes` types | Must be `LOAD_DATASET`, `FILTER`, `TRANSFORM`, `OUTPUT` (uppercase) |
| Node naming | Convention: `LOAD_DATASET0`, `FILTER0`, `TRANSFORM0`, `OUTPUT0` |
| `ui.hiddenColumns` | Must always be present (empty array) |
| `sampleDetails` | Required on load node: `{ "sortBy": [], "type": "TopN" }` |

---

## Salesforce I/O Layer (`sf.mjs`)

All Salesforce calls go through `sf.mjs`. It never uses OAuth or HTTP directly — it shells out to the `sf` CLI which uses the existing authenticated session.

```
sf.mjs exports:
  sfRestGet(path)              → GET  /services/data/v62.0{path}
  sfRestPost(path, body)       → POST /services/data/v62.0{path}
  sfRestSend(method, path, body) → PATCH/PUT/DELETE
  waveCreateRecipe(...)        → POST /wave/recipes
  waveUpdateRecipe(...)        → PATCH /wave/recipes/{id}
  waveFindRecipe(name)         → GET /wave/recipes?pageSize=200 + find by name
  waveRunDataflow(dataflowId)  → POST /wave/dataflowjobs
  waveDataflowJobStatus(jobId) → GET /wave/dataflowjobs/{jobId}
  sfDescribeObject(name)       → sf sobject describe ...
  sfListCustomObjects()        → sf sobject list --sobject-type custom
  sfSoql(soql)                 → sf data query ...
  checkIntegrationUserFieldAccess(obj, fields) → SOQL FieldPermissions query
  grantIntegrationUserFieldAccess(obj, fields) → Metadata deploy + PermissionSetAssignment
  checkReplicationStatus(objects) → GET /wave/dataConnectors + sourceObjects
  metadataRetrieve(type, name)    → sf project retrieve start
  metadataDeploy(type, name, def, xml) → sf project deploy start [--dry-run]
  ensureProject()                 → sf project generate (lazily, once)
  listLocalWave()                 → readdirSync(.sfdx-work/.../wave)
```

**Double-serialization guard in `metadataDeploy`:**
```js
const obj = typeof definitionObj === "string" ? JSON.parse(definitionObj) : definitionObj;
writeFileSync(..., JSON.stringify(obj));
```
If the LLM passes `definition` as a string (already JSON), this prevents double-encoding.

**Body file for REST calls:** All POST/PATCH/DELETE bodies are written to `.sfdx-work/_body.json` then referenced as `--body @path`. This sidesteps shell quoting issues with large JSON payloads.

---

## Agent Configuration (`copilot.mjs`)

```js
export const copilot = new Agent({
  name: "crma-copilot",
  instructions: INSTRUCTIONS,   // ~180 lines of rules
  model: sonnet(),              // Claude Sonnet 4.6 (gateway or direct Anthropic)
  memory,                       // LibSQL at absolute path (crma-memory.db)
  maxSteps: 50,                 // for AgentController sub-agent path
  tools: { ...recipeTools, ...dashboardTools, ...referenceTools },
});
```

**Memory:**
```js
const memory = new Memory({
  storage: new LibSQLStore({ id: "crma", url: "file:/absolute/path/crma-memory.db" }),
  options: { lastMessages: 40 },
});
```
- Absolute path is critical — Mastra Studio and the custom server run from different working directories. A relative path splits conversation history between two separate DB files.
- Memory is on the **agent** (not just the Mastra instance). Mastra Studio auto-creates a thread+resource per chat session when memory is on the agent.

---

## Studio maxSteps Patch

Mastra Studio's bundled frontend hardcodes `maxSteps:15` in its generate call. The agent's `maxSteps:50` only applies to sub-agent delegation (AgentController path), not to direct Studio calls. The call site value wins via `deepMerge`.

**Fix:** postinstall script in `package.json` patches both copies of the bundled JS:
```json
"postinstall": "node -e \"const f=require('path').join('node_modules','mastra','dist','studio','assets','main-CYSBLcdQ.js');require('fs').writeFileSync(f,require('fs').readFileSync(f,'utf8').replace(/maxSteps:15/g,'maxSteps:100'))\""
```
Both `node_modules/mastra/dist/studio/assets/` and `.mastra/output/studio/assets/` must be patched. The postinstall handles `node_modules`; if `.mastra/output/` is regenerated by `mastra dev`, run `npm install` again to re-apply.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SF_TARGET_ORG` | Yes | — | Salesforce org alias (from `sf org list`) |
| `DEPLOY_DRY_RUN` | No | `"true"` | `"false"` enables live writes |
| `LLM_PROVIDER` | No | `"gateway"` | `"gateway"` or `"anthropic"` |
| `SF_GATEWAY_BASE_URL` | If gateway | — | LiteLLM proxy endpoint |
| `SF_GATEWAY_TOKEN` | If gateway | — | Gateway bearer token |
| `GATEWAY_MODEL_SONNET` | No | `claude-sonnet-4-6` | Model id for sonnet tier |
| `GATEWAY_MODEL_OPUS` | No | `claude-opus-4-8-vertex` | Model id for opus tier |
| `ANTHROPIC_API_KEY` | If anthropic | — | Direct Anthropic key |
| `ANTHROPIC_MODEL_SONNET` | No | `claude-sonnet-4-6` | |
| `ANTHROPIC_MODEL_OPUS` | No | `claude-opus-4-8` | |
| `NODE_EXTRA_CA_CERTS` | If gateway | — | Path to Salesforce CA bundle for TLS |
| `RAG_REFERENCE_DIR` | No | `../../CRMA MASTRA reference` | Override reference docs folder |

---

## Entry Points

| Command | File | What it runs |
|---|---|---|
| `npm run dev` | — | `mastra dev` → Mastra Studio at http://localhost:4111 |
| `npm run ui` | `src/server.mjs` | Custom browser UI at http://localhost:4111 |
| `npm run chat` | `src/chat.mjs` | Terminal REPL |
| `npm run ask` | `src/ask.mjs` | Single-shot CLI query |

---

## Extending the Recipe Feature

### Adding a new tool

1. Add a function to `sf.mjs` if a new Salesforce API call is needed.
2. Add a `createTool(...)` entry in `recipeTools.mjs`.
3. Add it to the `recipeTools` export object at the bottom of that file.
4. Copilot picks it up automatically (it spreads `...recipeTools` into its tools).
5. Update the agent instructions in `copilot.mjs` if the agent needs to know when/how to use it.

### Modifying agent behavior

All reasoning rules live in the `INSTRUCTIONS` template literal in `copilot.mjs`. Key sections:
- **Core rules** — approval recognition, field name guessing prohibition, minimal questions
- **How to work** (numbered list, items 1–9) — retrieve-before-edit, FLS, replication, run error handling
- **Creating new assets** — recipe + dashboard authoring rules
- **Reference library** — when to call RAG tools

### Adding a new error pattern

In `recipeTools.mjs`, the `diagnoseRunError(errMsg, recipeName)` function matches against known patterns. Add a new `if (/pattern/i.test(errMsg))` block returning `{ diagnosis, fixSteps, autoFixable }`.

### Changing the model

`src/mastra/models.mjs` — swap `sonnet()` to `opus()` in `copilot.mjs` for deeper reasoning, or change the model IDs via env vars without touching code.

---

## Known Bugs Fixed (history, for reference)

| Bug | Root cause | Fix |
|---|---|---|
| Studio stops after 15 tool calls | Studio frontend hardcodes `maxSteps:15` | Postinstall patch → `maxSteps:100` |
| "Column X does not exist for grouping" on dashboard | Agent put SAQL aliases in `groups:[]` | Instruction: `groups` must be `[]`, put aliases in `strings`/`numbers` |
| "can not instantiate from JSON String" on dashboard deploy update | LLM passed `definition` as a string → `JSON.stringify(string)` = double encoding | `typeof` guard in `metadataDeploy` |
| Recipe run fails with UNKNOWN_EXCEPTION | Source object not replicated | Added `check-replication` tool + pre-run checklist in instructions |
| Number tiles render as broken bar charts | Agent used `type:"chart"` for KPI tiles | Widget type rules in instructions + `type:"number"` example in reference docs |
| Location shows record IDs instead of names | Lookup field value = Salesforce record ID | Lookup field rule: include `Relationship__r.Name` in recipe; group by name in SAQL |
