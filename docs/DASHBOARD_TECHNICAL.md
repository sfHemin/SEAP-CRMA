# CRMA Copilot — Dashboard Feature: Technical Reference

> **Audience:** Engineers building on, extending, or debugging the dashboard capability.
> **Status:** Phase 2 — core CRUD complete. Debugging + Debugger Agent planned (Sprint D-1, D-3).

---

## Architecture Overview

```
User (Mastra Studio / browser UI / terminal)
        │
        ▼
  crma-copilot (Mastra Agent)
        │
        ├── dashboardTools (8 tools)  ──→  sf.mjs  ──→  sf CLI
        │                                              │
        │                                              ├── REST: /wave/dashboards
        │                                              ├── REST: /wave/query (SAQL)
        │                                              └── Metadata: WaveDashboard
        │                                                  (sf project retrieve/deploy)
        └── referenceTools (RAG) ──→ CRMA MASTRA reference/
                                      Widget json, steps json, gridlayout json, etc.
```

The dashboard write path is **Metadata API only** (unlike recipes which use Wave REST for create/update). Both new dashboards and updates go through `sf project deploy start --metadata WaveDashboard:{name}`.

---

## File Map

```
CRMA Mastra/
├── src/mastra/
│   ├── tools/
│   │   └── dashboardTools.mjs      ← 8 dashboard tools
│   ├── sf.mjs                      ← sfRestGet, sfRestPost, metadataRetrieve, metadataDeploy
│   └── agents/copilot.mjs          ← agent instructions (dashboard sections)
├── .sfdx-work/
│   └── force-app/main/default/
│       └── wave/
│           ├── {name}.wdash        ← dashboard state JSON (written before deploy)
│           └── {name}.wdash-meta.xml
└── CRMA MASTRA reference/
    ├── Widget json                  ← widget type shapes + properties (RAG)
    ├── steps json                   ← step type properties (RAG)
    ├── gridlayout json              ← layout properties (RAG)
    └── Dashboard example            ← example dashboard state (RAG)
```

---

## The 8 Dashboard Tools

### `list-dashboards`
**SF call:** `GET /wave/dashboards?pageSize=200`
**Returns:** `{ dashboards: [{name, label, folder, id}] }`

---

### `get-dashboard`
**SF call:** `sf project retrieve start --metadata WaveDashboard:{name}`
**Returns:** `{ name, stepCount, widgetCount, steps: [string], definition, metaXml }`
**Notes:**
- Retrieves the `.wdash` file (state JSON) + `.wdash-meta.xml`.
- `definition` is the full state object: `{ steps, widgets, gridLayouts, filters, widgetStyle, ... }`.
- `steps` in the return value is the array of step names (keys of `definition.steps`).
- Always call this before editing or debugging a dashboard — never assume the current state.

---

### `apply-dashboard-edits`
**SF call:** None (in-memory transform)
**Returns:** `{ definition, applied, errors }`
**Operations:**
```js
// Set a value at a dotted path into the state
{ path: "widgets.chart_1.parameters.title.label", value: "New Title" }

// Set the SAQL query for a step
{ path: "steps.by_location_1.query", value: "q = load \"Vacant_Units_Analysis\";\nq = group q by Location;\n..." }

// Delete a widget
{ path: "widgets.number_2", delete: true }

// Add a new widget (set the entire widget object)
{ path: "widgets.number_3", value: { type: "number", parameters: { ... } } }

// Update grid layout — add a widget entry to a page
{ path: "gridLayouts.0.pages.0.widgets", value: [...existingWidgets, newWidgetEntry] }
```
**Notes:**
- `setDeep` resolves the dotted path and sets/deletes the leaf key.
- Errors on path segments that don't exist are non-fatal (reported in `errors[]`).
- Does NOT deploy. Chain with `validate-dashboard` → `deploy-dashboard`.

---

### `validate-dashboard`
**SF call:** `sf project deploy start --metadata WaveDashboard:{name} --dry-run`
**Returns:** `{ ok: boolean, output: string }`
**Notes:** Forces `DEPLOY_DRY_RUN=true` for this call. Safe by design.

---

### `deploy-dashboard`
**SF call:** `sf project deploy start --metadata WaveDashboard:{name}` (live) or with `--dry-run`
**Returns:** `{ deployed: boolean, dryRun: boolean, output: string }`
**Notes:**
- Writes `{name}.wdash` to `.sfdx-work/force-app/main/default/wave/` before deploying.
- The `typeof definitionObj === "string"` guard in `metadataDeploy` prevents double-serialization.
- Gated by `confirm=true` and `DEPLOY_DRY_RUN=false`.
- Works for both new dashboards and updates (Metadata API handles both).

---

### `create-dashboard-meta`
**SF call:** None (template generation)
**Returns:** `{ metaXml: string }`
**Output:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<WaveDashboard xmlns="http://soap.sforce.com/2006/04/metadata"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <content xsi:nil="true"/>
    <application>SharedApp</application>
    <dateVersion>1</dateVersion>
    <masterLabel>Vacant Units Overview</masterLabel>
</WaveDashboard>
```
**Notes:** `application` is the Analytics app API name (e.g. `SharedApp`). Required for new dashboards.

---

### `query-dataset`
**SF call:** `GET /wave/datasets/{datasetName}` then `POST /wave/query`
**Returns:** `{ records: any[] }`
**Notes:**
- Looks up the current dataset version automatically: `ds.id + "/" + ds.currentVersionId`.
- The caller provides SAQL after the load line; the load is auto-prefixed:
  ```
  q = load "{id}/{versionId}"; {saqlAfterLoad}
  ```
- Used for data questions AND for pre-deploy verification that the dataset exists/has data.

---

### `remap-dataset-ids`
**SF call:** None (string replace)
**Returns:** `{ definition, replaced: number }`
**Notes:** Replaces all occurrences of `oldId` with `newId` in the serialized JSON string, then re-parses. Works because dataset IDs appear in multiple places in a dashboard state (step dataset arrays, etc.). Matched by name from the provided maps.

---

## Dashboard State JSON Structure

The `.wdash` file is a JSON object with this top-level shape:

```json
{
  "dataSourceLinksInfo": { "enableAutomaticLinking": false, "excludeRelationships": [], "links": [] },
  "filters": [],
  "gridLayouts": [ { ...layout... } ],
  "layouts": [],
  "steps": { "step_name": { ...step... } },
  "widgetStyle": { ...defaults... },
  "widgets": { "widget_name": { ...widget... } },
  "parameters": []
}
```

The file deployed via Metadata API is the full dashboard definition object (the `state` field in the Wave REST response). The `.wdash-meta.xml` carries the label and folder assignment.

---

## Step Types and Shapes

### `saql` step (most common)

```json
"total_vacancies_1": {
  "type": "saql",
  "label": "Total Vacant Units",
  "broadcastFacet": false,
  "useGlobal": false,
  "selectMode": "single",
  "sortable": true,
  "useExternalFilters": true,
  "receiveFacetSource": { "mode": "none", "steps": [] },
  "query": "q = load \"Vacant_Units_Analysis\";\nq = group q by all;\nq = foreach q generate count() as Total_Vacancies;\nq = limit q 1;",
  "strings": [],
  "numbers": ["Total_Vacancies"],
  "groups": []
}
```

**Critical metadata rules (enforced in agent instructions):**

| Field | Rule | Why |
|---|---|---|
| `strings` | Aliased dimension columns from SAQL output | e.g. `["Location"]` when query has `Apt_Location__c as Location` |
| `numbers` | Aliased measure columns from SAQL output | e.g. `["Total_Vacancies"]` for `count() as Total_Vacancies` |
| `groups` | MUST be `[]` (empty) | Putting aliases here causes "Column X does not exist for grouping" — CRMA resolves groups as raw dataset field names, not aliases |

The `columnMap.dimensionAxis` and `columnMap.plots` in widget `visualizationParameters` reference the same alias strings from `strings`/`numbers`.

---

## Widget Types and Shapes

### `number` widget (KPI tile)

```json
"number_1": {
  "type": "number",
  "parameters": {
    "step": "total_vacancies_1",
    "columnMap": { "number": ["Total_Vacancies"] },
    "compact": true,
    "numberDecimalDigits": 0,
    "showActionMenu": true,
    "exploreLink": true,
    "title": {
      "fontSize": 14,
      "label": "Total Vacant Units",
      "align": "center",
      "subtitleLabel": ""
    }
  }
}
```

**NEVER use `type:"chart"` for a KPI tile.** Chart params (`visualizationType`, `dimensionAxis`, `measureAxis`, `legend`, `trellis`, `bins`) must not appear on a `number` widget — they cause broken rendering (warning triangle, no data displayed).

---

### `chart` widget (bar, line, donut, etc.)

```json
"chart_1": {
  "type": "chart",
  "parameters": {
    "step": "by_location_1",
    "visualizationType": "hbar",
    "columnMap": {
      "trellis": [],
      "dimensionAxis": ["Location"],
      "plots": ["Vacancies"]
    },
    "title": { "fontSize": 14, "label": "Vacant Units by Location", "align": "left", "subtitleLabel": "" },
    "dimensionAxis": { "showAxis": true, "showTitle": true, "title": "Location", "customSize": "auto", "icons": { "useIcons": false, "iconProps": { "column": "", "fit": "cover", "type": "round" } } },
    "measureAxis1": { "sqrtScale": false, "showAxis": true, "showTitle": true, "title": "Vacancies", "customDomain": { "showDomain": false } },
    "measureAxis2": { "sqrtScale": false, "showAxis": true, "showTitle": true, "title": "", "customDomain": { "showDomain": false } },
    "legend": { "show": false, "inside": false, "showHeader": true, "position": "right-top", "descOrder": false, "customSize": "auto" },
    "theme": "wave",
    "showActionMenu": true,
    "exploreLink": true,
    "autoFitMode": "keepLabels",
    "axisMode": "sync",
    "binValues": false,
    "applyConditionalFormatting": false,
    "valueType": "compactNumber",
    "compactDecimalDigits": -1,
    "trellis": { "enable": false, "showGridLines": true, "flipLabels": false, "type": "x", "chartsPerLine": 4, "size": [100, 100] },
    "tooltip": { "content": { "legend": { "customizeLegend": false, "showDimensions": true, "dimensions": [], "showMeasures": true, "measures": [], "showPercentage": true, "showNullValues": true, "showBinLabel": true } } }
  }
}
```

`visualizationType` values: `hbar` (horizontal bar), `vbar` (vertical bar), `line`, `donut`, `scatter`, `map`, `stackhbar`, `stackvbar`.

---

### `text` widget (title / label)

```json
"text_1": {
  "type": "text",
  "parameters": {
    "content": {
      "richTextContent": [
        { "attributes": { "color": "#16325c", "size": "24px" }, "insert": "Vacant Units Overview" },
        { "attributes": { "align": "center" }, "insert": "\n" }
      ]
    },
    "interactions": [],
    "showActionMenu": true
  }
}
```

---

## Grid Layout Structure

```json
{
  "maxWidth": 1200,
  "name": "Default",
  "numColumns": 49,
  "rowHeight": "fine",
  "version": 1,
  "pages": [
    {
      "label": "Main",
      "name": "main",
      "navigationHidden": false,
      "widgets": [
        { "name": "text_1",   "row": 2,  "column": 2,  "rowspan": 4,  "colspan": 45, "widgetStyle": { ... } },
        { "name": "number_1", "row": 7,  "column": 2,  "rowspan": 12, "colspan": 20, "widgetStyle": { ... } },
        { "name": "number_2", "row": 20, "column": 2,  "rowspan": 12, "colspan": 20, "widgetStyle": { ... } },
        { "name": "chart_1",  "row": 7,  "column": 24, "rowspan": 25, "colspan": 25, "widgetStyle": { ... } }
      ]
    }
  ],
  "selectors": [],
  "style": {
    "alignmentX": "left", "alignmentY": "top",
    "backgroundColor": "#E6ECF2",
    "cellSpacingX": 0, "cellSpacingY": 0,
    "fit": "original",
    "gutterColor": "#C6D3E1"
  }
}
```

**Coordinate system:** `numColumns: 49` is the standard. `rowHeight: "fine"` gives fine-grained row control. `column` and `row` are 1-based. Widgets use `colspan` and `rowspan` for sizing.

**Standard widget widgetStyle:**
```json
{
  "backgroundColor": "#FFFFFF",
  "borderColor": "#E6ECF2",
  "borderEdges": ["all"],
  "borderRadius": 16,
  "borderWidth": 1
}
```

---

## Lookup Field Rule

When `describe-object` returns a field with `type: "reference"`, that field stores a Salesforce record ID (e.g. `a2vId0000015MO4IAM`), not a human-readable label. Grouping by this field in SAQL shows IDs.

**Fix in the recipe:** Include the relationship traversal field in the recipe's load node fields:
```
Apt_Location__r.Name   ← relationship traversal (use the __r name not __c)
```

**In SAQL:** Use the flattened field name as it appears in the dataset (the recipe must have loaded it):
```saql
q = group q by 'Apt_Location__r.Name';
q = foreach q generate 'Apt_Location__r.Name' as Location, count() as Vacancies;
```

SAQL cannot traverse relationships on its own — the field must already exist in the dataset (loaded by the recipe).

---

## Agent Instruction Sections (in `copilot.mjs`)

The dashboard-relevant instruction sections are:

1. **"How to work" item 1** — Always call `get-dashboard` before editing
2. **"How to work" item 3** — Edit surgically via `apply-dashboard-edits` with dotted paths
3. **"How to work" item 4** — Debug via `validate-dashboard`
4. **"How to work" item 6** — Write path: dashboards via Metadata API
5. **"Creating new assets" → New dashboard** — Mirror existing org structure, SAQL step metadata rule, widget type rules, lookup field rule
6. **"Reference library"** — MANDATORY `search-reference "Widget json"` before any new dashboard

**Pre-deploy preview protocol** (in instructions):
Before deploying any new or edited dashboard, the agent MUST output a structured preview in chat showing widget types, positions, SAQL queries, and dataset. It then enters a Q&A loop. `deploy-dashboard` is only called after explicit user approval following the preview.

---

## How the Agent Authors a New Dashboard

1. **`get-dashboard` on an existing dashboard** — mirrors the exact JSON shape from the org (avoids shape drift between CRMA versions)
2. **`describe-object`** — if the dashboard queries a custom object's data, checks field types for lookup references
3. **Authors the state JSON** with:
   - One `saql` step per visual
   - One widget per step (correct type: `number` vs `chart` vs `text`)
   - Grid layout with `row`/`column`/`rowspan`/`colspan` coordinates
4. **`search-reference "Widget json"` + `read-reference`** — MANDATORY before composing any new widget type
5. **Shows structured preview** in chat
6. **Q&A loop** — applies edits via `apply-dashboard-edits`, updates preview
7. **`create-dashboard-meta`** — generates `.wdash-meta.xml` with the target app
8. **`validate-dashboard`** — dry-run against org
9. **`deploy-dashboard`** — only with `confirm=true` after user approval

---

## Known Bugs Fixed (history)

| Bug | Root cause | Fix |
|---|---|---|
| "Column 'Location' does not exist for grouping" | Agent put SAQL aliases in `groups:[]` in the step | Instruction rule: `groups` must always be `[]`; put aliases in `strings`/`numbers` only |
| Number tiles rendering as broken bar charts | Agent used `type:"chart"` + `visualizationType:"hbar"` for KPI tiles | Instruction rule: number tiles = `type:"number"` only. Widget type example added to reference docs. |
| "can not instantiate from JSON String" on update deploy | LLM passed `definition` as a string → `JSON.stringify(string)` double-encoded | `typeof` guard in `metadataDeploy`: parse string to object before serializing |
| Location showing record IDs (a2vId...) | Lookup field stores record ID, not name | Lookup field rule in instructions: include `__r.Name` in recipe; group by name field in SAQL |
| Reference docs had no `type:"number"` JSON example | Only the type enum listed it; no working template | Added full `type:"number"` example block to `Widget json` reference file |

---

## Extending the Dashboard Feature

### Adding a new tool

1. Add a new function to `sf.mjs` if a new API call is needed.
2. Add a `createTool(...)` in `dashboardTools.mjs`.
3. Add it to the `dashboardTools` export at the bottom.
4. Update agent instructions in `copilot.mjs` if behavior rules are needed.

### Adding a new widget type to the agent's repertoire

1. Add a concrete JSON example to `CRMA MASTRA reference/Widget json` (the agent's RAG source).
2. Add a rule to the "Widget type rules" section in `copilot.mjs` instructions if there's something non-obvious about when/how to use it.
3. The mandatory reference lookup (`search-reference "Widget json"`) will pick it up automatically.

### Sprint D-1: Dashboard Debugging — COMPLETE (2026-08-26)

Added to `dashboardTools.mjs`:
- `get-dataset-fields` — `GET /wave/datasets/{name}` → resolves id+versionId → `GET /wave/datasets/{id}/versions/{verId}/xmd/main` → returns dimension + measure field names + row count. Falls back gracefully if XMD is unavailable.
- `diagnose-dashboard` — full structural pass: dataset existence + row count, SAQL field references validated against XMD, `groups:[]` check per step, orphaned widgets, broken step refs, grid layout vs widgets map consistency. Returns `{ issues[], datasetsSummary[], summary }` with severity/area/fixHint per issue.

Added to `sf.mjs`: `getDatasetFieldMeta(datasetName)`.

New instruction section in `copilot.mjs`: Debugging Protocol with fix-order priority list.

### Sprint D-2: Pre-Deploy Preview Protocol — COMPLETE (2026-08-26)

Instructions-only sprint. Added to `copilot.mjs`:
- Mandatory structured preview table (Steps + Widgets + Interactions) before every new or significantly-edited dashboard deploy.
- Q&A loop rules: changes → apply → re-output updated WIDGETS table only.
- Significance threshold: adding/removing widget, SAQL change, interaction = show preview. Title/color only = skip.
- Screenshot reading: agent reads user-pasted screenshots visually to identify broken widgets before calling tools.
- Interaction RAG trigger: cross-widget filtering/drill-down → mandatory `search-reference "Interaction functions"`.

### Sprint D-3: Debugger Sub-Agent — COMPLETE (2026-08-26)

**Architecture:**

```
User reports error
      ↓
copilot tries once with its standard tools
      ↓  (still unresolved, OR 2+ errors, OR unknown error)
copilot calls delegate-to-debugger tool
      │   passes: assetType, assetName, symptom, context (tool outputs + error text)
      ↓
debugger_.generate([{ role:"user", content: task }])
      │   Opus model, 30 maxSteps, full tool access
      │   Investigation protocol:
      │     1. search-reference "Error catalog" → match error
      │     2. get-recipe / diagnose-dashboard → fresh current state
      │     3. RAG cross-check (SAQL, widget, interaction, recipe resources)
      │     4. get-dataset-fields / run-soql / check-replication / check-field-access
      │     5. Formulate fix in priority order
      ↓
returns structured Debug Report:
  { rootCause, evidence[], fixPlan[], verification, docsReferenced[] }
      ↓
copilot presents report to user
      ↓
user approves → copilot executes fix plan step by step (with confirm gates)
```

**New files:**
- `src/mastra/agents/debugger.mjs` — `debugger_` Agent (Opus, 30 maxSteps, all tools, exhaustive instructions)
- `src/mastra/tools/debuggerTools.mjs` — `delegateToDebugger` createTool wrapper (calls `debugger_.generate()`)
- `CRMA MASTRA reference/Error catalog` — 400-line RAG doc: all known recipe/dashboard/SAQL/deploy errors with root cause, fix steps, auto-fixable flag

**Wiring:**
```js
// copilot.mjs
import { debuggerTools } from "../tools/debuggerTools.mjs";
tools: { ...recipeTools, ...dashboardTools, ...referenceTools, ...debuggerTools }

// index.js
import { debugger_ } from "./agents/debugger.mjs";
agents: { copilot, debugger: debugger_ }  // registers in Studio
```

**Delegation trigger (in copilot instructions):**
- Use delegate-to-debugger when: error root cause unknown, 2+ diagnose-dashboard errors, one fix attempt failed, UNKNOWN_EXCEPTION.
- Do NOT use for trivial fixes the copilot is confident about (missing label, groups:[], boolean operand).

**Error catalog covers:** replication not set up, FLS blocked, missing dataset label, UNKNOWN_EXCEPTION, JSON_PARSER_ERROR, Recipe Builder "Can't Load", 0-row output, "Column X does not exist for grouping", broken number tile type, lookup fields showing IDs, double-serialization, orphaned widgets, SAQL parse errors, deploy infrastructure errors.

---

## Environment Variables (Dashboard-relevant)

| Variable | Default | Effect on dashboards |
|---|---|---|
| `SF_TARGET_ORG` | — | Which org is queried/deployed to |
| `DEPLOY_DRY_RUN` | `"true"` | `"false"` enables `deploy-dashboard` to write |
| `LLM_PROVIDER` | `"gateway"` | Model used for authoring and editing |
