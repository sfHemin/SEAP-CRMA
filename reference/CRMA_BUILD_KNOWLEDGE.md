# CRMA BUILD KNOWLEDGE — Master reference for recipe + dashboard authoring

> Ground truth harvested from deployed storm-org recipes/dashboards + the two Sample recipes
> + the Salesforce Recipe REST API doc. Every shape here appears in something that ACTUALLY
> DEPLOYED AND RAN. When a value here disagrees with the API schema doc's casing, THIS wins —
> the schema doc lists title-case enum names that the runtime rejects.
>
> search-reference keywords: recipe node join aggregate formula filter schema load save
> computeRelative extractGrains typeCast clustering append sqlFilter dashboard widget chart
> number table filterpanel step saql aggregateflex staticflex visualizationType columnMap
> dimensionAxis plots measureAxis join types filter operators aggregate functions.

---

# PART 1 — RECIPE NODES

Every recipe is `{ "nodes": {…}, "ui": {…}, "version": "…", "runMode": "…" }`.
Each node = `{ "action": "<type>", "parameters": {…}, "sources": […], "schema": {…}? }`.
`sources` lists the node name(s) feeding this node. Load nodes have `sources: []`.

Node action types confirmed in real recipes (with frequency):
schema (71), formula (51), load (16), join (16), save (13), filter (12),
computeRelative (6), extractGrains (5), aggregate (5), clustering (2), sqlFilter (2),
appendV2 (2), smartDataDiscoveryPredict (1), timeSeriesV2 (1), typeCast (1).

---

## 1.1 LOAD — two forms, both real

### Form A: connectedDataset — load a Salesforce object via SFDC_LOCAL
This is the form for pulling CRM data. REQUIRES connectionName + sourceObjectName + fields.
```json
"LOAD_DATASET0": {
  "action": "load",
  "parameters": {
    "dataset": {
      "type": "connectedDataset",
      "connectionName": "SFDC_LOCAL",
      "sourceObjectName": "Account",
      "label": "Account"
    },
    "fields": ["Id", "Name", "Type", "BillingState", "Industry", "AnnualRevenue", "OwnerId"]
  },
  "sources": []
}
```
- `fields` MUST list every field you want — this is the field allow-list. Omitting a field
  means it won't be available downstream. (A too-short fields list = skeleton recipe.)
- `type: "connectedDataset"` is required or the API returns JSON_PARSER_ERROR.

### Form B: analyticsDataset — load a previously-saved dataset (recipe chaining)
```json
"LOAD_DATASET3": {
  "action": "load",
  "parameters": {
    "dataset": { "type": "analyticsDataset", "name": "Forecast_Dataset4", "label": "Forecast" },
    "fields": [],
    "sampleDetails": { "type": "TopN", "sortBy": [] }
  },
  "sources": []
}
```
`fields: []` here means "all fields from the dataset".

---

## 1.2 JOIN — all join types

`action: "join"`, `sources: [leftNode, rightNode]`. sources[0]=left(driving), sources[1]=right(lookup).

### joinType values — RUNTIME uses UPPERCASE_SNAKE (verified from deployed recipes)
| Use this (runtime) | API-doc name | Meaning |
|---|---|---|
| `LOOKUP` | Lookup | Add right-side columns to matching left rows (most common enrichment) |
| `LEFT_OUTER` | LeftOuter | Keep ALL left rows; right cols null when unmatched |
| `INNER` | Inner | Only rows matching on both sides |
| `RIGHT_OUTER` | RightOuter | Keep all right rows |
| `OUTER` | Outer | Full outer — all rows both sides |
| `CROSS` | Cross | Cartesian product (no keys) |
| `MULTI_VALUE_LOOKUP` | MultiValueLookup | Lookup returning multiple matches |

DO NOT pass title case ("Lookup","LeftOuter") — runtime rejects it. Use UPPERCASE_SNAKE.

### LOOKUP join (real, from Segmentation recipe)
```json
"JOIN0": {
  "action": "join",
  "parameters": {
    "joinType": "LOOKUP",
    "leftKeys": ["AccountId"],
    "rightKeys": ["AccountId"],
    "rightQualifier": "Won"
  },
  "sources": ["LOAD_DATASET0", "AGGREGATE0"]
}
```
- `leftKeys`/`rightKeys` are ARRAYS — supports composite multi-key joins:
  `"leftKeys": ["cgcloud__Account__c","ProductId","ForecastDateString"]`
- `rightQualifier` prefixes ALL right-side columns → `Won.SUM_Amount`, `Won.COUNT_Rows`.
- `leftQualifier` is OPTIONAL and NOT used in the real recipes — omit it unless a validate
  error demands it.
- Joins can chain on already-prefixed keys: `"leftKeys": ["Opp.AccountId"]` after a prior join.

### LEFT_OUTER join (real, from Sample 2) — with composite keys + schema slice
```json
"JOIN1": {
  "action": "join",
  "parameters": {
    "joinType": "LEFT_OUTER",
    "leftKeys": ["cgcloud__Account__c","ProductId","ForecastDateString"],
    "rightKeys": ["cgcloud__Account__c","ProductId","ForecastDateString"],
    "rightQualifier": "NonPromo"
  },
  "sources": ["FILTER0", "DROP_FIELDS4"]
}
```
Rename/drop the right-side prefixed fields DOWNSTREAM using a schema node (§1.4).

---

## 1.3 FORMULA — derived fields. THE dialect that bit us before.

`action: "formula"`, `parameters.expressionType: "SQL"`, field in `parameters.fields[]`.

⛔ ONE FIELD PER FORMULA NODE (ORG-VERIFIED 2026-09-07). fields[] holds exactly ONE field.
Multiple fields → Builder error "A node can only define one field." To derive N fields, CHAIN
N formula nodes (one field each), each sources=[previous]. Proof: all formula nodes in Sample 2 (19)
and Segmentation (3) define exactly 1 field. The multi-element fields[] pattern is for computeRelative,
NOT formula.
```json
"TRIM0": {
  "action": "formula",
  "parameters": {
    "expressionType": "SQL",
    "fields": [
      {
        "name": "ValueTier",
        "label": "Value Tier",
        "type": "TEXT",
        "formulaExpression": "case when AccountLifetimeValue >= 100000 then 'Strategic' when AccountLifetimeValue >= 25000 then 'Growth' else 'Standard' end"
      }
    ]
  },
  "sources": ["JOIN0"]
}
```
For several derived fields, chain: FORMULA0 (field A, sources=[JOIN2]) → FORMULA1 (field B,
sources=[FORMULA0]) → FORMULA2 (field C, sources=[FORMULA1]) → OUTPUT (sources=[FORMULA2]).

### Formula field-reference quoting — VERIFIED from real recipes
- **Plain field** (letters/underscore only): bare, no quotes → `AccountLifetimeValue`, `Forecast_Date`, `AccountId`
- **Join-prefixed field**: SINGLE quotes → `'Won.COUNT_RowsWon'`, `'Won.SUM_Amount'`
- **Field with special chars** (hyphen): DOUBLE quotes → `"ForecastSalesUnitsW-1"`
- **String literal**: SINGLE quotes → `'Strategic'`, `'Yes'`, `'No'`
- **Comparison**: single `=`, plus `<` `>` `<=` `>=` `!=`. (NOT `==`.)

### Verified working functions (recipe formula, expressionType SQL)
```
case when <cond> then <v> [when …] else <v> end   -- classification
concat(a, b, c, …)                                -- string join
coalesce(a, b, c)                                 -- first non-null
trim(field)                                       -- whitespace strip
year(dateField)  month(dateField)  day(dateField) -- date parts
now()                                             -- current timestamp (WORKS)
Arithmetic:  +  -  *  /
```

### DATE DIFFERENCE — what does NOT work, what DOES
NOT supported in recipe formula SQL: `DATEDIFF()`, `DATE_DIFF()`, `TODAY()`, `CURRENT_DATE`, `EPOCH_SECOND()`.
`now()` works. For "days between two dates" prefer ONE of:
1. **Do it in the dashboard SAQL step** (best): `daysBetween(toDate(CreatedDate_sec_epoch), now())` — see §2.5.
2. **Use the `_sec_epoch` companion fields** the sync auto-creates, then arithmetic:
   `(now() - toDate(CreatedDate_sec_epoch)) ` style — TEST in a scratch formula first.
3. **computeRelative** (§1.6) for prior-period/sequence math.

### HTML-escape gotcha
When you GET a recipe, formulas come HTML-escaped: `&#39;`=`'`, `&gt;`=`>`, `&lt;`=`<`, `&amp;`=`&`, `&quot;`=`"`.
DECODE before reading. When you WRITE, send raw characters — the API escapes on store.

---

## 1.4 SCHEMA — rename, drop, retype fields (the workhorse: 71 occurrences)

`action: "schema"`. Node is often NAMED by function (EDIT_ATTRIBUTES0, DROP_FIELDS4) but action is always "schema".

### Rename a field (set newProperties.name + .label)
```json
"EDIT_ATTRIBUTES0": {
  "action": "schema",
  "parameters": {
    "fields": [
      { "name": "COUNT_Rows", "newProperties": { "name": "COUNT_RowsWon", "label": "Rows Won" } },
      { "name": "Won.Name",   "newProperties": { "name": "Account_Name",  "label": "Account Name" } }
    ]
  },
  "sources": ["JOIN0"]
}
```
This is HOW you rename join-prefixed fields (Won.Name → Account_Name). Do it after every join.

### Retype a field (set typeProperties)
```json
{ "name": "SUM_Amount", "newProperties": { "typeProperties": { "type": "NUMBER", "precision": 18, "scale": 2 } } }
```

### Drop fields
Use a schema node that lists the fields to drop with a drop flag, OR a join's `schema.slice`
with `"mode": "DROP"` listing the fields to exclude. Read Org examples/recipes for the exact
drop shape when needed.

---

## 1.5 AGGREGATE — rollups

`action: "aggregate"`. `aggregations[]` + `groupings[]`.
```json
"AGGREGATE0": {
  "action": "aggregate",
  "parameters": {
    "aggregations": [
      { "action": "SUM",   "name": "SUM_Amount",  "label": "Sum of Amount", "source": "Amount" },
      { "action": "COUNT", "name": "COUNT_Rows",   "label": "Row Count",     "source": "Id" },
      { "action": "AVG",   "name": "AVG_Amount",   "label": "Avg Amount",    "source": "Amount" }
    ],
    "groupings": ["AccountId"],
    "nodeType": "STANDARD",
    "pivots": []
  },
  "sources": ["LOAD_DATASET0"]
}
```

### aggregations[].action — RUNTIME uses UPPERCASE (verified: SUM, COUNT, AVG)
| Runtime | API-doc name |
|---|---|
| `SUM` | Sum |
| `COUNT` | Count |
| `AVG` | Avg |
| `MAX` | Maximum |
| `MIN` | Minimum |
| `MEDIAN` | Median |
| `UNIQUE` | Unique |
| `STDDEV` / `STDDEVP` | StdDev / StdDevP |
| `VAR` / `VARP` | Var / VarP |

`nodeType`: `"STANDARD"` (verified) or `"HIERARCHICAL"`. `pivots`: usually `[]`.

### Conditional aggregation (SUM only Won opps) — NO native WHERE
Pattern: FORMULA node before AGGREGATE creates a numeric flag, then SUM the flag.
```
// formula:  Won_Amount = case when IsWon = 'true' then Amount else 0 end
// aggregate: { "action":"SUM", "source":"Won_Amount", "name":"SUM_Won_Amount" }
```

---

## 1.6 computeRelative — window functions (lag/lead/row_number)

`action: "computeRelative"`, `expressionType: "SQL"`, plus `orderBy` + `partitionBy`.
```json
"FORMULA1": {
  "action": "computeRelative",
  "parameters": {
    "expressionType": "SQL",
    "fields": [
      { "name": "PrevWeekUnits", "label": "Prev Week Units", "type": "NUMBER", "precision": 10, "scale": 2,
        "formulaExpression": "lag(Final_Forecast_SaleUnits)", "defaultValue": "" }
    ],
    "orderBy": [ { "fieldName": "Forecast_Date", "direction": "ASC" } ],
    "partitionBy": ["AccountProductKey"]
  },
  "sources": ["FORMULA0"]
}
```
Verified functions: `lag(field)`, `lead(field)`, `row_number()`.
Reference a prior computeRelative output with double quotes: `lag("PrevWeekUnits")`.

---

## 1.7 extractGrains — derive date parts (Year/Month/Quarter/FiscalYear…)

`action: "extractGrains"`. Turns a date column into clean dimension fields.
```json
"EXTRACT0": {
  "action": "extractGrains",
  "parameters": {
    "grainExtractions": [
      { "source": "CloseDate",
        "targets": [
          { "name": "Close_Year",    "label": "Close Year",    "grainType": "Year" },
          { "name": "Close_Quarter", "label": "Close Quarter", "grainType": "Quarter" },
          { "name": "Close_FY",      "label": "Close FY",      "grainType": "FiscalYear" }
        ] }
    ]
  },
  "sources": ["LOAD_DATASET0"]
}
```
grainType values: Day, DayEpoch, FiscalMonth, FiscalQuarter, FiscalWeek, FiscalYear, Hour,
Minute, Month, Quarter, Second, SecondEpoch, Week, Year.

---

## 1.8 FILTER + sqlFilter

### filter — structured
```json
"FILTER0": {
  "action": "filter",
  "parameters": {
    "filterExpressions": [
      { "type": "TEXT",   "field": "IsClosed", "operator": "EQUAL",            "operands": ["false"] },
      { "type": "NUMBER", "field": "Amount",   "operator": "GREATER_OR_EQUAL", "operands": ["1000"] }
    ]
  },
  "sources": ["LOAD_DATASET0"]
}
```
Multiple expressions in the array are AND-ed together.

### filter operators — VERIFIED in real recipes
`EQUAL`, `GREATER_THAN`, `GREATER_OR_EQUAL`, `IS_NOT_NULL`.
Also valid per API: `LESS_THAN`, `LESS_OR_EQUAL`, `IS_NULL`, `NOT_EQUAL`.
`type` values: `TEXT`, `NUMBER`, `DATE_ONLY`, `DATE_TIME`, `MULTIVALUE`.
- Booleans: `type: "TEXT"`, operand string `"true"`/`"false"` (NOT boolean).
- No `logic` key. For OR: use two filter nodes + append, or a formula flag then filter on it.

### sqlFilter — free SQL condition (real, for complex logic)
```json
"SQL_FILTER0": {
  "action": "sqlFilter",
  "parameters": { "filterExpressions": [ { "type": "SQL", "expression": "Amount > 1000 && IsWon == \"true\"" } ] },
  "sources": ["LOAD_DATASET0"]
}
```

---

## 1.9 SAVE (OUTPUT)

```json
"OUTPUT0": {
  "action": "save",
  "parameters": {
    "dataset": {
      "type": "analyticsDataset",
      "name": "DS_Pipeline_Intelligence",
      "label": "Pipeline Intelligence",
      "folderName": "SharedApp"
    },
    "fields": [],
    "measuresToCurrencies": []
  },
  "sources": ["TRIM0"]
}
```
`name` + `label` REQUIRED (missing label → run fails "Output dataset label can not be empty").
`folderName` = target app. `fields: []` = save all.

---

## 1.10 typeCast, clustering, appendV2 (advanced — mirror Org examples)

- **typeCast**: convert a field's type (e.g. text→measure). Read Org examples/recipes.
- **clustering** (real, from Segmentation): unsupervised k-means.
  ```json
  { "clusterCount": 4, "sourceFields": ["DealCount","AverageDealSize","AccountLifetimeValue","WinRateByRow","WinRateByAmount"],
    "targetField": { "name": "Id_clustering", "label": "Cluster" }, "targetScaledFields": [] }
  ```
- **appendV2**: union two branches (like SQL UNION). sources = [branchA, branchB].
- **smartDataDiscoveryPredict**, **timeSeriesV2**: ML nodes — mirror Org examples exactly.

---

# PART 2 — DASHBOARDS

Dashboard = `{ "state": { "widgets": {…}, "steps": {…}, "layouts": […], "gridLayouts": […], "datasets": […] } }`.
Widgets render; steps query data; widgets bind to steps by name.

Widget types confirmed in real dashboards (frequency):
chart (43), text (38), container (31), number (20), table (5), link (4),
filterpanel (2), listselector (1), pillbox (1), image (1).

Step types: saql (31), aggregateflex (31), staticflex (2), soql (1).

---

## 2.1 STEP: aggregateflex — the default query step

```json
"MyStep_1": {
  "type": "aggregateflex",
  "label": "Pipeline by Stage",
  "datasets": [ { "id": "0Fb…", "name": "DS_Pipeline_Intelligence", "label": "Pipeline Intelligence",
                  "url": "/services/data/v62.0/wave/datasets/0Fb…" } ],
  "query": {
    "measures": [ ["sum", "Amount"] ],
    "groups": ["StageName"],
    "filters": [ ["Opportunity_Status", ["Open"], "in"] ]
  },
  "broadcastFacet": true,
  "isGlobal": false
}
```
NOTE: in stored JSON the `query` is sometimes a STRING (escaped JSON). When authoring, send it
as a real object. `filters` entries: `[field, [values], "in"|"not in"]`. `measures`: `[[func, field]]`.

## 2.2 STEP: saql — full SAQL for complex logic (ratios, windows, cogroup)

```json
"WinRate_1": {
  "type": "saql",
  "query": "q = load \"DS_Sales_Rep_Performance\"; q = group q by 'FiscalQuarter'; q = foreach q generate 'FiscalQuarter' as 'FiscalQuarter', (sum('Won_Opportunities')/sum('Total_Opportunities'))*100 as 'Win_Rate'; q = order q by 'FiscalQuarter' asc;",
  "groups": [],
  "numbers": [],
  "broadcastFacet": true
}
```
CRITICAL SAQL step metadata rule:
- `groups: []` ALWAYS empty — never put aliases here (causes "Column X does not exist for grouping").
- `strings` = aliased dimension output names, `numbers` = aliased measure output names.
- SAQL dialect: DOUBLE quotes = field ref/dataset name, SINGLE quotes = alias/string.
  (OPPOSITE of recipe formula — never mix.)

## 2.3 STEP: staticflex — fixed option list (for toggles/selectors)
```json
"static_1": { "type": "staticflex",
  "values": [ { "display": "Revenue", "value": "Amount" }, { "display": "Count", "value": "Id" } ] }
```

---

## 2.4 WIDGETS — every type with real shape

### number (KPI tile)
```json
{ "type": "number", "parameters": {
  "step": "KPICalc_1", "measureField": "Open_Pipeline", "title": "Open Pipeline",
  "numberSize": 15, "textAlignment": "center", "compact": true } }
```
Advanced: title/color can be a binding: `"{{cell(Step.result, 0, \"Label\").asString()}}"`.

### chart — visualizationType + wiring. TWO wiring styles:

**Style 1 — columnMap** (line/scatter/pie/combo/stackvbar/heatmap/matrix/bubblemap/etc.):
```json
{ "type": "chart", "parameters": {
  "visualizationType": "line", "step": "Trend_1",
  "columnMap": { "dimensionAxis": ["Conversion Date"], "plots": ["count"], "split": [], "trellis": [] } } }
```

**Style 2 — dimensionAxis + measureAxis1/2** (hbar/vbar/funnel/time — columnMap is empty []):
```json
{ "type": "chart", "parameters": {
  "visualizationType": "hbar", "step": "Industry_1",
  "dimensionAxis": ["Industry"], "measureAxis1": ["sum_Won_Revenue"], "measureAxis2": [] } }
```

### columnMap keys per visualizationType — VERIFIED (26 real types)
| visualizationType | columnMap keys (or dimensionAxis+measureAxis if empty) |
|---|---|
| hbar, vbar, funnel, time, polargauge | (empty columnMap → use dimensionAxis + measureAxis1/measureAxis2) |
| line, stackhbar | split, trellis, dimensionAxis, plots |
| combo | trellis, dimensionAxis, plots |
| pie, treemap | trellis, dimension, plots |
| scatter | r, x, y, trellis, plots |
| stackvbar | r, color, x, y |
| heatmap | color, x, y |
| matrix | r, color, x, y |
| bubblemap | r, color, trellis, plots |
| choropleth | color, trellis, plots |
| geomap | r, color, location, trellis, plots |
| gauge, flatgauge, bullet, rating | trellis, plots |
| pyramid | measureAxis1, measureAxis2, trellis, dimensionAxis, plots |
| metricsradar, parallelcoords | trellis, measureAxes, dimension |
| hdot, vdot | r, split, trellis, dimensionAxis, plots |

All 26 verified real: bubblemap, bullet, choropleth, combo, flatgauge, funnel, gauge, geomap,
hbar, hdot, heatmap, line, matrix, metricsradar, parallelcoords, pie, polargauge, pyramid,
rating, scatter, stackhbar, stackvbar, time, treemap, vbar, vdot.

### table
```json
{ "type": "table", "parameters": { "step": "Detail_1", "columns": [], "columnProperties": {},
  "showActionMenu": true } }
```
`columns: []` = show all step columns. To pin/order, list column config objects.

### filterpanel (global filters)
```json
{ "type": "filterpanel", "parameters": {
  "filters": [ { "dataset": "DS_Pipeline_Intelligence", "field": "Region" },
               { "dataset": "DS_Pipeline_Intelligence", "field": "StageName" } ],
  "itemsPerRow": 3, "showAllFilters": true } }
```
Each filter: `{ dataset, field }`. Filters broadcast to steps with matching fields.

### listselector / pillbox (single-select toggles bound to a staticflex step)
```json
{ "type": "listselector", "parameters": { "step": "static_1", "displayMode": "filter", "instant": true } }
{ "type": "pillbox",     "parameters": { "step": "measures_1" } }
```

### text / link / image / container
- text: `parameters.content.richTextContent` (array) — NOT a plain string.
- container: layout grouping; holds other widgets. link/image: `url` param.

---

## 2.5 Date math in dashboards (the RIGHT place for datediff)

SAQL step, in a foreach:
```
q = foreach q generate daysBetween(toDate(CreatedDate_sec_epoch), now()) as 'Opportunity_Age';
q = foreach q generate date_diff("day", toDate(CreatedDate_sec_epoch), toDate(CloseDate_sec_epoch)) as 'Cycle_Days';
```
`daysBetween` and `date_diff("unit", start, end)` ONLY work in foreach (not group/order/filter).
This is why recipes should EXPOSE the `_sec_epoch` fields and let the dashboard compute the diff.

---

# PART 3 — GRID LAYOUT

- `gridLayouts[].numColumns`: default 12. Only use higher (e.g. 49) if mirrored from an existing org dashboard.
- Each widget placement: `{ widget, row, column, colspan, rowspan }`. colspan/column must sum within numColumns.

---

# PART 4 — WHEN DOCS CONFLICT (precedence)

1. **Deployed recipes/dashboards** in `Org examples/` (incl. `Org examples/Sample recipes/`) — HIGHEST trust. Ran successfully.
2. **get-recipe / get-dashboard** on a live org asset — real, org-specific.
3. **This doc** + `Recipe node cheat-sheet` — distilled from #1/#2.
4. **Recipe reference** (REST API schema doc) — trust for WHICH properties exist. DISTRUST its
   enum CASING (Sum/Lookup/Standard) — runtime wants UPPERCASE_SNAKE (SUM/LOOKUP/STANDARD).

# PART 5 — FALLBACK CHAIN when a pattern is unknown

1. `search-reference "<node/widget> <keyword>"` → this doc + cheat-sheet (fast).
2. `read-reference "Org examples/recipes/Segmentation_Cluster_Analysis_Account_Segmentation_V1.json"`
   or `"Org examples/Sample recipes/Sample 2.json"` — copy the real node shape.
3. `list-recipes` / `get-recipe` on the org — find a recipe already doing the pattern; mirror it.
4. `list-dashboards` / `get-dashboard` — same for dashboard widgets.
5. Only if all above fail: `delegate-to-debugger` with the specific unknown.

Never guess a node/widget shape from memory when steps 1–4 can give you a verified one.


---
## VERIFIED PATTERN — Correct top-level dashboard definition structure (verified deploy)
VERIFIED 2025: The definition passed to deploy-dashboard must be the STATE object directly — no wrapping "label" or "datasets" keys at the top level. Those cause "Unrecognized field" errors. Correct structure: { dataSourceLinksInfo:{...}, filters:[], gridLayouts:[...], layouts:[], steps:{...}, widgetStyle:{...}, widgets:{...} }. The label goes in metaXml masterLabel only. datasets go inside each step as datasets:[{name:"DatasetApiName"}]. aggregateflex query must be stringified JSON: {query:"{\"measures\":...}", version:-1}. Number widget uses measureField:"sum_FieldName" + compact:true + textAlignment. Chart widget uses dimensionAxis:[] + measureAxis1:[] directly (not nested in columnMap). Filter widget uses displayMode:"filter" + instant:true. gridLayout widgets use "name" not "id". All verified from Pipeline_Health deploy.


---
## VERIFIED PATTERN — Win Rate % KPI — SAQL cogroup pattern (ORG-VERIFIED)
VERIFIED 2026-09-06: To compute a win rate % in a SAQL KPI step, use two filtered streams cogrouped by all, then divide. sum(case when ...) is NOT valid SAQL. Load by dataset id/versionId (not name) for SAQL steps.

WORKING QUERY (single number tile):
q = load "0Fbhg0000001i5RCAQ/0Fchg000000AZ7lCAG";
won = filter q by 'Opportunity_Status' == "Won";
won = group won by all;
won = foreach won generate count() as 'Won_Count';
total = group q by all;
total = foreach total generate count() as 'Total_Count';
r = cogroup won by all, total by all;
r = foreach r generate (coalesce(sum(won.'Won_Count'), 0) / sum(total.'Total_Count')) * 100 as 'Win_Rate';
r = limit r 1;

Step metadata: type:"saql", numbers:["Win_Rate"], strings:[], groups:[].
Widget: type:"number", measureField:"Win_Rate".
diagnose-dashboard returns a warning about "no recognisable load line" — this is a false positive from the multi-stream pattern; 0 errors = step executes correctly.


---
## VERIFIED PATTERN — SAQL win-rate % over boolean string field (avoids "require field in sum")
VERIFIED: To compute a % rate over a boolean-stored-as-string field, DERIVE a 0/1 flag row-level BEFORE grouping, then sum the plain field. sum(case when ...) directly = error 119 "Wrong argument type: require field in sum". Working: q = load "DS"; q = foreach q generate (case when 'IsWon' == "true" then 1 else 0 end) as 'WonFlag'; q = group q by all; q = foreach q generate (sum('WonFlag') / count()) * 100 as 'WinRate'; Note IsWon is stored as string "true"/"false"; use == with double-quoted string literal in SAQL step dialect.
