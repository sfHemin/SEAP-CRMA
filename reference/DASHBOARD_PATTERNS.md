# DASHBOARD PATTERNS — metadata-deploy shapes (ORG-VERIFIED 2026-09-06)

> ⛔⛔ AFTER EVERY DASHBOARD DEPLOY/PATCH, RUN `diagnose-dashboard`. ⛔⛔
> It now EXECUTES every step's query live against /wave/query (both saql AND aggregateflex) and
> returns the exact "This widget can't be displayed because of a problem with the underlying query"
> errors — WITHOUT the user opening the dashboard. Any step that errors (errorCode 119) = a widget
> that will render as a red box or blank the dashboard. A dashboard is NOT "done" until
> diagnose-dashboard reports "No issues found." Do NOT rely on the render-preview or on deploy/validate
> success — they do NOT prove the widgets execute. This tool is the self-verification loop:
> deploy → diagnose → fix the reported step → diagnose again → repeat until clean.
> Proven 2026-09-06: it auto-caught 3 broken widgets on Revenue_Win_Loss (grouping by measure
> FiscalYear/FiscalQuarter) that the user would otherwise have had to find and report one by one.


> Every shape here was discovered by deploying a real dashboard to storm-org via the Metadata API
> (`sf project deploy WaveDashboard`) until it passed validation AND the recipe/dashboard was created.
> The .wdash METADATA shape differs from the REST GET shape — this doc is the METADATA-DEPLOY truth.
> Verified asset: CRMA_Verify_Dashboard (deployed CREATED, storm-org 2026-09-06).
>
> search-reference keywords: dashboard wdash metadata deploy dataSourceLinksInfo gridLayouts
> numColumns pages widgets steps aggregateflex saql query stringified visualizationType columnMap
> measureAxis dimensionAxis number KPI table listselector filter text richTextContent AssetReference.

===========================================================================
## 📍 WHERE TO FIND WIDGET/VIZ SHAPES THIS DOC DOES NOT LIST

This doc is a **gotchas + crash cheat-sheet**, NOT a complete widget catalog. It has verified inline
shapes ONLY for: number(KPI), chart(hbar/vbar), table, listselector, text. For **any other widget or
chart type**, DO NOT guess the shape from memory — that is exactly what caused the render crashes below.
Instead `search-reference` / `read-reference` these authoritative docs (all indexed):

- **`Dashabord/Widget visualizationType skeletons`** — copy-paste JSON skeletons for ALL 23 chart viz
  types, each with the exact per-type `columnMap` keys: hbar, vbar, stackhbar, stackvbar (in Sample),
  line, hdot, vdot, pie, donut, scatter, gauge, flatgauge, polargauge, bullet, rating, choropleth,
  geomap, bubblemap, combo, pyramid, treemap, matrix, heatmap, metricsradar, parallelcoords.
  → `search-reference "<vizType> visualizationType skeleton"` before composing a chart type you have
     not already built THIS conversation. The `columnMap` keys differ per type — get them exact.
- **`Dashabord/Widget json`** — the full Salesforce widget reference. Widget `type` values:
  chart, comparetable, container, dateselector, globalfilters, filterpanel, image, link, listselector,
  number, pillbox, rangeselector, table, text, valuestable. Per-property availability by viz type.
- **`Dashabord/Filter json`** — listselector / rangeselector / dateselector / globalfilters shapes.
- **`Dashabord/steps json`** — aggregateflex / saql / static step shapes.
- **`Dashabord/gridlayout json`** — page/row/column/colspan layout shape.
- **`Dashabord/Interaction and bindings/`** — cross-widget filtering, drill-down, `{{stepId.selection}}`
  / `{{stepId.result}}` binding syntax, limitations, real use-case examples.
- **`Dashabord/Lightning Web Components in CRM Analytics Dashboards`** — LWC widget shape.
- **`Success log/`** — records of dashboards that reached "No issues found" (technique reference).
- **`Org examples/dashboards/`** — full deployed dashboard JSONs (Pipeline_Health_WORKING, Sample
  Dashboard/*) — real multi-widget shapes to mirror.

RULE: verified inline here → use it. NOT here → read the skeleton/doc above, never invent. The crash
gotchas (#0–#0d below) apply to EVERY widget regardless of where you got the shape.

===========================================================================
## ⚠️ #0 — THE RENDER-TIME GOTCHA THAT PASSES VALIDATION (chart title MUST be an object)
===========================================================================
This one is NASTY: it PASSES metadata dry-run validation AND deploys successfully, then crashes at
RENDER time when you open the dashboard: "Cannot create property 'fontSize' on string '<your title>'".
[ORG-VERIFIED 2026-09-06 — hit live, then fixed and redeployed.]

- **number/KPI widget `title`** = plain STRING. ✅ `"title": "Total Deals"`
- **chart widget `title`** = OBJECT. ❌ `"title": "Lifetime Value by Cluster"` (crashes render)
  ✅ `"title": { "label": "Lifetime Value by Cluster", "fontSize": 14, "subtitleFontSize": 11, "align": "left", "subtitleLabel": "" }`

LESSON: metadata validation (dry-run) proves STRUCTURE, not RENDERABILITY. Some widget params are
only checked when the chart actually draws. ALWAYS open a deployed dashboard once to confirm render —
the validator alone is necessary but NOT sufficient. render-dashboard-preview or a live open is the
only proof charts draw.

===========================================================================
## ⚠️ #0a — LISTSELECTOR measureField MUST = the step's measure alias (NOT "none") → render crash
===========================================================================
[ORG-VERIFIED 2026-09-06 — DEFINITIVE. Confirmed by BROWSER CONSOLE STACK TRACE + by extracting a
HAND-BUILT working filter from the Dashboard Designer and diffing. This was the REAL blank-dashboard
cause. #0b/#0c/#0d below were real but SMALLER bugs — fixing them did NOT restore render; THIS did.]

SYMPTOM: dashboard is BLANK/WHITE. Console shows:
  TypeError: Cannot read properties of null (reading 'getClassName')
    at ReactClassComponent._render (edge.listWidget.chunk...js...)   <-- listWidget = LISTSELECTOR
The crashing component is named in the FIRST console stack frame (`listWidget`). ALWAYS get the
console stack trace first — it names the exact widget type and ends guessing instantly.

CAUSE: the listselector widget's `measureField` must equal the step's REAL measure alias. A dimension
filter step groups with `count *`, whose measure alias is literally **`count`**. So the widget needs
`"measureField":"count"`. Setting `"measureField":"none"` (a plausible guess, and what a STATICFLEX
list widget uses) points at a measure that doesn't exist → listWidget._render calls .getClassName()
on the null lookup → the WHOLE dashboard crashes. `"none"` is FATAL for an aggregateflex dimension filter.

⛔ CORRECT shape — EXTRACTED FROM THE DESIGNER (a hand-built filter that renders):
```json
"listselector_1": { "type":"listselector", "parameters":{
  "step":"StageName_1", "displayMode":"filter", "instant":true, "title":"StageName", "compact":false,
  "measureField":"count",              <-- = step's measure alias (count * -> "count"). NEVER "none".
  "exploreLink":false, "showActionMenu":true,
  "filterStyle":{"titleColor":"#747474","valueColor":"#16325C"}
}}
```
Its STEP — note receiveFacetSource + visualizationParameters:{} that the designer ALWAYS writes and a
hand-authored step usually OMITS; and isGlobal:false + selectMode:"single" (NOT global/multi):
```json
"StageName_1": { "type":"aggregateflex", "datasets":[{"name":"DS_Pipeline_Intelligence"}],
  "query":{"query":"{\"measures\":[[\"count\",\"*\"]],\"groups\":[\"StageName\"]}","version":-1},
  "isGlobal":false, "useGlobal":true, "selectMode":"single", "broadcastFacet":true,
  "receiveFacetSource":{"mode":"all","steps":[]},
  "visualizationParameters":{}
}
```
Rule of thumb: measureField = step's measure alias; include receiveFacetSource + visualizationParameters:{}.

⛔ WHEN A WIDGET SHAPE IS UNCLEAR, BUILD IT IN THE DESIGNER AND EXTRACT ITS JSON. Docs + other org
dashboards (LeadPerf used staticflex with "none") misled us for 4 failed deploys. One hand-built
example via GET /wave/dashboards/<id> gave the exact truth instantly. This beats guessing every time.

⛔ BISECTION METHOD THAT ISOLATED IT: deploy a MINIMAL fresh dashboard, then add widget types back
ONE AT A TIME as separate deployed dashboards (filters-only, +KPI+table, +chart2, +leaderboard),
opening each. The one that first blanks names the culprit. Far faster and more certain than
diffing/PATCHing the full broken JSON. NOTE: Wave REST PATCH is a MERGE not a replace — deleting a
key locally does NOT remove it from stored state; POST a fresh dashboard to change shape cleanly.

===========================================================================
## ⚠️ #0d — IN-QUERY FILTER ELEMENT ORDER: ["field", [values], "operator"] (operator LAST)
===========================================================================
[ORG-VERIFIED 2026-09-06 — KPIs showed UNFILTERED totals (29.4M/726) instead of filtered (11.66M/444)
because the filter was silently ignored due to wrong element order.]
In a compact aggregateflex query, each filter is a 3-element array with the OPERATOR THIRD:
  ✅ CORRECT:  "filters":[["Opportunity_Status", ["Won"], "in"]]
  ❌ WRONG:    "filters":[["Opportunity_Status", "in", ["Won"]]]   <-- silently ignored, no error
Proof from real org dashboard SegmentCluster: [["Opp.IsWon",["true"],"in"],["Opp.IsClosed",["true"],"in"]].
Operators: "in", "not in", "matches". A wrong-order filter does NOT error — the step just returns
unfiltered data, so the dashboard renders with WRONG NUMBERS. Verify KPI values against a known SAQL
count, not just "it rendered."

===========================================================================
## ⚠️ #0b — STEP QUERY REFERENCES A FIELD THE RECIPE RENAMED AWAY (render crash)
===========================================================================
[ORG-VERIFIED 2026-09-06 — hit live on Pipeline_Health, then fixed via Wave REST PATCH.]
SYMPTOM in Analytics Studio: dashboard won't open at all — grey screen + modal
"Sorry to interrupt / This page has an error ... Cannot read properties of null (reading 'getClassName')".
This is NOT the chart-title gotcha. It is a step whose query GROUPS BY / MEASURES / FILTERS ON a
field name that does NOT exist in the dataset. When ONE step's query fails to compile, Studio's JS
null-crashes and the WHOLE dashboard fails to render (not just that one widget).

ROOT CAUSE in the live case: the recipe's SCHEMA node RENAMED Account.BillingState → "Region", so the
dataset field is "Region". But the dashboard's region listselector step queried "BillingState" (the
ORIGINAL Salesforce field name). Passed validation (metadata deploy does NOT check field existence),
deployed clean, crashed on open.

⛔ MANDATORY PRE-DEPLOY CHECK: every field referenced in every step query (measures[i][1], groups[],
filters[][0]) MUST exist in the target dataset's XMD. Fetch the dataset's real field list and diff:
  GET /wave/datasets/<id> → currentVersionId
  GET /wave/datasets/<id>/versions/<vid>/xmds/main → dimensions[].field + measures[].field
Any query field not in that set = guaranteed render crash. Use the RECIPE OUTPUT field names
(post-SCHEMA-rename), NOT the original Salesforce API names, when authoring dashboard step queries.

⚠️ DO NOT trust cached SAQL probe results when discovering field names. If /wave/query returns the
SAME payload for different queries, it is CACHING — you have NOT verified the field. Confirm field
names from the recipe's OUTPUT/SCHEMA node or the dataset XMD, never from a possibly-cached probe.

===========================================================================
## ⚠️ #0c — GROUPING BY A MEASURE (numeric field) — render crash, passes validation
===========================================================================
[ORG-VERIFIED 2026-09-06 — the SECOND bug on Pipeline_Health; field EXISTED but was a MEASURE.]
SYMPTOM: white screen / getClassName null crash — same visible symptom as #0b, DIFFERENT cause.
The step field EXISTS in the dataset, so the #0b existence-check passes — but it is a MEASURE, and
SAQL CANNOT `group by` a measure. Execution throws:
  "Invalid group expression: <Field>. Dimension field or a non-epoch date access function expected."
→ the step fails at execution → whole dashboard render crashes.

LIVE CASE: recipe loaded FiscalYear / FiscalQuarter as NUMBERS. In CRMA, numeric fields default to
MEASURES. Three steps grouped by them (2 fiscal listselector filters + the by-quarter chart) → all
threw "Invalid group expression" → white screen. FIX: group by the true DATE DIMENSIONS that CRMA
auto-generates from any date field — CloseDate_Year, CloseDate_Quarter, CloseDate_Month (these ARE
dimensions, groupable). Verified executing against org after the swap.

⛔ EXISTENCE IS NOT ENOUGH — CHECK DIMENSION vs MEASURE. For every field in a step's `groups[]`,
confirm it is a DIMENSION in the dataset XMD (dimensions[].field), NOT a measure (measures[].field).
To group by a numeric field you must either (a) group by a date-derived dimension (Xxx_Year/_Quarter/
_Month), or (b) cast it to a dimension/text in the RECIPE (typeCast or a text formula) before output.

⛔ THE ONLY REAL PROOF IS EXECUTION. Field-exists + dimension-check are necessary but STILL not
sufficient. Before declaring a dashboard done, EXECUTE each step's query via POST /wave/query and
confirm it returns rows (not errorCode 119). Validation, existence, and dim/measure checks all pass
structurally; only running the query proves it renders.

===========================================================================
## ⚠️ #0e — CHART TYPE CHANGE LEFT AN INCONSISTENT BINDING → widget renders EMPTY (blank + ⚠️)
===========================================================================
[ORG-VERIFIED 2026-09-07 — deployed live on Executive Pipeline Review; "Open Pipeline by Stage" came
up blank with a warning triangle. Query executed fine — this is a RENDER-WIRING failure, so
diagnose-dashboard's query-execution check did NOT catch it (query returns rows).]

SYMPTOM: a single chart widget is empty (blank canvas + ⚠️) while every other widget renders. Passes
validation AND passes the query-execution check.

ROOT CAUSE: a chart's type is declared in THREE places and each viz type binds its data with DIFFERENT
keys. A type-change edit that updates only SOME of them leaves a hybrid the renderer can't bind:
  1. widget `parameters.visualizationType`   (e.g. "hbar")
  2. widget DATA BINDING — MUTUALLY EXCLUSIVE forms per type:
       • bar family (hbar/vbar/stackhbar/stackvbar/line/combo): `measureAxis1:[aliases]` + `dimensionAxis:[dims]` (ARRAYS), NO columnMap
       • pie/donut: `columnMap:{ "measure":[alias], "dimension":[dim] }`
       • scatter:   `columnMap:{ "x":[m], "y":[m], "r":[m], "plots":[dim] }`
       • funnel/pyramid/treemap: `columnMap:{ "dimension":[dim], "plots":[alias] }`
  3. step `visualizationParameters.visualizationType`

LIVE CASE: a donut→hbar change left `columnMap:{measure,dimension}` (DONUT form) on a widget now typed
"hbar" (which needs `measureAxis1[]`+`dimensionAxis[]`), while `measureAxis1`/`dimensionAxis` held only
styling OBJECTS (no fields) and the STEP still said "donut". Three-way mismatch → the renderer picked a
type with no valid field binding → blank widget.

⛔ WHEN CHANGING A CHART'S TYPE, CONVERT ALL THREE TOGETHER. Set widget viz, REPLACE the data binding
with the new type's form (delete the old form — columnMap XOR measureAxis1/dimensionAxis field-arrays),
AND set the step viz to the SAME type. Compare against a known-good widget of the target type (e.g. the
working vbar's `measureAxis1:["sum_Amount"]` + `dimensionAxis:[...]` arrays). Get the exact per-type
columnMap keys from `Dashabord/Widget visualizationType skeletons`.

⛔ DIAGNOSE MUST CHECK WIRING, NOT JUST THE QUERY. diagnose-dashboard now flags viz-type↔binding↔step
mismatches (a chart whose widget viz ≠ step viz, or a bar-family widget with a donut-style columnMap and
no measureAxis/dimensionAxis field arrays). Run it after every deploy.

===========================================================================
## THE 6 METADATA-DEPLOY GOTCHAS (each was a real validator rejection)
===========================================================================
The Metadata API validates .wdash STRICTLY — unknown fields are hard errors. These are the exact
rejections hit while deploying, in order, and their fixes:

1. **dataSourceLinksInfo must be an OBJECT, not an array.**
   ❌ `"dataSourceLinksInfo": []`
   ✅ `"dataSourceLinksInfo": { "enableAutomaticLinking": false, "excludeRelationships": [], "links": [] }`

2. **gridLayouts reject `selectionType` and `maxNumColumns`.**
   Allowed keys: name, numColumns, rowHeight, version, style, pages.
   ✅ `{ "name":"Default","numColumns":12,"rowHeight":"fine","version":1,"style":{...},"pages":[...] }`

3. **Step dataset reference = `{ "name": "..." }` ONLY.** No id, no url, no label.
   ❌ `"datasets":[{"id":"0Fb…","name":"X","url":"…","label":"X"}]`
   ✅ `"datasets":[{"name":"Clustered_Accounts"}]`
   And SAQL steps take NO `datasets` array at all — they `load "id/version"` inside the query string.

4. **aggregateflex `query` is a STRINGIFIED JSON wrapper, not a nested object.**
   ❌ `"query": { "measures":[["sum","X"]], "groups":["Y"] }`
   ✅ `"query": { "query": "{\"measures\":[[\"sum\",\"X\"]],\"groups\":[\"Y\"]}", "version": -1 }`
   The measures/groups/filters live INSIDE the stringified inner JSON.

5. **saql steps reject `isGlobal`.** aggregateflex ALLOWS `isGlobal`; saql does NOT.
   saql allowed keys: broadcastFacet, groups, numbers, query, receiveFacetSource, selectMode,
     strings, type, useExternalFilters, useGlobal, label.
   aggregateflex allowed: broadcastFacet, datasets, isGlobal, label, query, receiveFacetSource,
     selectMode, type, useExternalFilters, useGlobal, visualizationParameters.

6. **Widget params are type-specific — unknown keys are rejected:**
   - text: `content.richTextContent` array (NO plain `text` key).
     ✅ `{"content":{"richTextContent":[{"attributes":{"color":"#16325c","size":"20px"},"insert":"Title"},{"attributes":{"align":"left"},"insert":"\n"}]},"interactions":[],"showActionMenu":true}`
   - table: NO `title` key. Allowed: columnProperties, columns, customBulkActions, headerProperties,
     interactions, showActionMenu, step.
   - number: compact, exploreLink, interactions, measureField, numberColor, numberSize,
     showActionMenu, step, textAlignment, title, titleColor, titleSize, tooltip.
   - listselector: compact, displayMode, exploreLink, filterStyle, instant, interactions,
     measureField, showActionMenu, step, title.

===========================================================================
## VERIFIED FULL SHAPES (copy these — they deployed CREATED)
===========================================================================

### .wdash top-level skeleton (flat — NOT wrapped in "state")
```json
{
  "dataSourceLinksInfo": { "enableAutomaticLinking": false, "excludeRelationships": [], "links": [] },
  "filters": [],
  "gridLayouts": [ { "name": "Default", "numColumns": 12, "rowHeight": "fine", "version": 1,
    "style": { "alignmentX":"left","alignmentY":"top","backgroundColor":"#E6ECF2","cellSpacingX":8,"cellSpacingY":8,"fit":"original","gutterColor":"#C5D3E0" },
    "pages": [ { "name":"Page1","navigationHidden":false,"widgets":[
      { "name":"widgetKey","row":0,"column":0,"colspan":12,"rowspan":2 } ] } ] } ],
  "layouts": [],
  "widgetStyle": { "borderEdges":[],"borderColor":"#E6ECF2","borderRadius":8,"borderWidth":1,"backgroundColor":"#FFFFFF" },
  "steps": { ... },
  "widgets": { ... }
}
```
meta.xml wrapper:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<WaveDashboard xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <content xsi:nil="true"/>
    <application>SharedApp</application>
    <dateVersion>1</dateVersion>
    <description>...</description>
    <masterLabel>Human Readable Name</masterLabel>
</WaveDashboard>
```

### aggregateflex step (VERIFIED)
```json
"kpi_1": {
  "type": "aggregateflex",
  "label": "KPIs",
  "datasets": [ { "name": "Clustered_Accounts" } ],
  "query": { "query": "{\"measures\":[[\"sum\",\"AccountLifetimeValue\"],[\"sum\",\"DealCount\"],[\"avg\",\"AverageDealSize\"]],\"groups\":[]}", "version": -1 },
  "broadcastFacet": true,
  "receiveFacetSource": { "mode": "all" },
  "isGlobal": false,
  "useGlobal": true,
  "selectMode": "single",
  "useExternalFilters": true,
  "visualizationParameters": { "visualizationType": "hbar" }
}
```
Measure alias in the RESULT = `<func>_<field>` → `sum_AccountLifetimeValue`, `avg_AverageDealSize`.
Widgets bind to THAT alias in measureField/measureAxis1.

### saql step with rank() windowing (VERIFIED — this deployed + is the hard case)
```json
"rank_industry_1": {
  "type": "saql",
  "label": "Rank by Industry",
  "query": "q = load \"0FbId000000c7nUKAQ/0FcId000000RGbxKAG\"; q = group q by 'Industry'; q = foreach q generate 'Industry' as 'Industry', sum('AccountLifetimeValue') as 'Lifetime_Value', rank() over([..] partition by all order by sum('AccountLifetimeValue') desc) as 'Rank'; q = order q by 'Rank' asc; q = limit q 10;",
  "strings": ["Industry"],
  "numbers": ["Lifetime_Value", "Rank"],
  "groups": [],
  "broadcastFacet": true,
  "receiveFacetSource": { "mode": "all" },
  "selectMode": "single",
  "useExternalFilters": true,
  "useGlobal": true
}
```
Note: `groups:[]` ALWAYS. `strings` = aliased dims, `numbers` = aliased measures. SAQL loads by id/version.

### number (KPI) widget (VERIFIED)
```json
"kpi_total_value": {
  "type": "number",
  "parameters": { "step":"kpi_1","measureField":"sum_AccountLifetimeValue","title":"Total Lifetime Value","compact":true,"numberSize":18,"textAlignment":"center","interactions":[] }
}
```

### chart widget — TWO wiring styles (both VERIFIED)
Style A — hbar/vbar use dimensionAxis + measureAxis1 (columnMap empty):
```json
"chart_by_cluster": {
  "type": "chart",
  "parameters": { "step":"cluster_agg_1","visualizationType":"hbar","title":"Value by Cluster",
    "measureAxis1":["sum_AccountLifetimeValue"],"measureAxis2":[],"dimensionAxis":["Cluster"],
    "trellis":{"enable":false},"legend":{"show":false},"showActionMenu":true }
}
```
Style B — most other charts use columnMap (see CRMA_BUILD_KNOWLEDGE §2.4 for per-type keys):
```json
"chart_rank_industry": {
  "type": "chart",
  "parameters": { "step":"rank_industry_1","visualizationType":"hbar","title":"Top 10 Industries",
    "columnMap":{"dimensionAxis":["Industry"],"plots":["Lifetime_Value"]},
    "trellis":{"enable":false},"legend":{"show":false},"showActionMenu":true }
}
```

### table widget (VERIFIED)
```json
"table_detail": {
  "type": "table",
  "parameters": { "columnProperties":{},"columns":[],"customBulkActions":[],"headerProperties":{},"interactions":[],"showActionMenu":true,"step":"detail_1" }
}
```
`columns:[]` shows all step columns. No `title` — put a text widget above it for a heading.

### listselector (cross-filter) widget (VERIFIED)
```json
"filter_cluster": {
  "type": "listselector",
  "parameters": { "step":"filter_cluster_1","displayMode":"filter","instant":true,"title":"Filter: Cluster","compact":false,"interactions":[] }
}
```
Its step is an aggregateflex with `isGlobal:true, selectMode:"multi"` grouping the filter dimension.
When the selector's dataset matches other steps' dataset + `broadcastFacet:true`, selection filters them.

===========================================================================
## DEPLOY WORKFLOW (proven)
===========================================================================
1. Author .wdash (flat top-level) + .wdash-meta.xml in force-app/main/default/wave/.
2. `sf project deploy start --metadata WaveDashboard:<Name> --target-org <org> --dry-run --json`
   → read result.details.componentFailures[].problem. Fix each unknown-field error. Repeat.
3. When dry-run success:true → deploy for real (drop --dry-run).
4. Open at: <instanceUrl>/analytics/wave/dashboard/<dashboardId>.

Rule: ALWAYS dry-run first. Each unknown-field rejection names the exact class + field — strip or
fix that field and re-run. The validator is your fast, free correctness check before writing.

===========================================================================
## STATUS
===========================================================================
| Item | Status |
|---|---|
| Metadata deploy of a multi-widget dashboard | ORG-VERIFIED 2026-09-06 (CREATED) |
| aggregateflex step (stringified query) | ORG-VERIFIED |
| saql step with rank() windowing | ORG-VERIFIED |
| number / chart(hbar) / table / listselector widgets | ORG-VERIFIED |
| text widget richTextContent | ORG-VERIFIED |
| Cross-filter listselector → steps | Deployed; user to confirm render/interaction |
