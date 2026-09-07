# XMD — field formatting, dimension colors, record links, derived measures (worked example)

> Concepts / search keywords: XMD extended metadata, dimension member colors, color a field value,
> Won blue Open, custom number format currency percent, derived measure, derived dimension,
> record link linkTemplate, open record from dashboard, showDetails default fields, dataset field labels.

**XMD is how a dataset controls how its fields LOOK and BEHAVE in dashboards/explorer** — number
formats ($ / %), colors per dimension member (Won=blue), clickable links to records, derived
measures/dimensions, and which fields show in "view details." This is a worked example distilled
from a deployed Salesforce Opportunity XMD (31 derived measures, colored Stage, user links) so you
can mirror the exact shapes. We already have the XMD *reference* under `Dashabord/Extended Metadata
(XMD)/…`; this file is the copy-paste **example** side.

---

## 1. Number format on a measure — `format.customFormat` = `["<mask>", <multiplier>]`

The value is a JSON **string** holding a 2-element array: `"[\"<mask>\", <multiplier>]"`.
- **`<mask>`** — the display pattern (prefix/suffix symbols, grouping, decimals).
- **`<multiplier>`** — the stored value is MULTIPLIED by this before display. `1` = show as-is.
  Use `100` to render a stored decimal (0.45) as a percent (45%). ⚠️ Never use `0` — a "0"
  multiplier makes CSV/XLS export write every value as 0 (documented Salesforce gotcha).

```json
{ "field": "Amount", "label": "Amount (USD)",
  "format": { "customFormat": "[\"$#,###,###.##\",1]" } }
```
Masks (multiplier `1` unless converting):
- Currency: `"[\"$#,###\",1]"` → `$1,234`
- Currency + 2 decimals: `"[\"$#,###.##\",1]"` → `$1,234.56`
- Percent from a stored decimal (0.45 → 45%): `"[\"##.##%\",100]"` (the `100` multiplier does the ×100)
- Suffix: `"[\"#,###.## USD\",1]"`  · Negatives in parens: `"[\"$#,###.##;($#,###.##)\",1]"`

## 2. Derived measure — a computed KPI surfaced as a field

```json
"derivedMeasures": [
  { "field": "quota_attainment", "label": "Quota Attainment",
    "format": { "customFormat": "[\"#,###%\",100]" }, "showInExplorer": false },
  { "field": "YoY", "label": "YoY Growth",
    "format": { "customFormat": "[\"#,###%\",100]" }, "showInExplorer": false },
  { "field": "last_activity", "label": "Days Since Last Activity", "format": {} }
]
```
Use for reusable KPIs (win rate, YoY, quota attainment) so every widget formats them consistently.
`showInExplorer: false` hides an internal helper field from the field picker.

## 3. Color a dimension's values — `members: [{member, color}]`

```json
"derivedDimensions": [
  { "field": "Status", "label": "Status",
    "members": [
      { "member": "Won",  "color": "#005FB2" },
      { "member": "Open", "color": "#A9DCF5" }
    ] }
]
```
This is the answer to "make Won blue and Open light-blue" — the colors follow the field into every
chart/table automatically, so you don't hand-color each widget. Use hex values.

## 4. Make a dimension value a clickable link to the record

```json
{ "field": "UniqueUserName", "label": "User Name",
  "linkTemplate": "/{{row.OwnerId}}", "linkTooltip": "Open User",
  "recordIdField": "OwnerId" }
```
- `linkTemplate: "/{{row.<IdField>}}"` — clicking the value opens that Salesforce record.
- `recordIdField` — the field holding the record Id used in the link.
- For an Opportunity: `"/{{row.Id}}"` with `recordIdField: "Id"`.

## 5. "View details" default columns — `showDetailsDefaultFields`

```json
"showDetailsDefaultFields": [
  "CloseDate", "Name", "Owner.Name", "Amount", "ForecastCategoryName", "StageName"
]
```
Controls which fields appear when a user opens a row's detail from a chart/table.

---

## Full XMD skeleton (top-level keys) — illustrative shape, /* … */ are comments not literal JSON
```jsonc
{
  "dataset": {},
  "dates": [],
  "dimensions":        [ /* { field, label, ... } */ ],
  "measures":          [ /* { field, label, format } */ ],
  "derivedDimensions": [ /* colored/linked/computed dims */ ],
  "derivedMeasures":   [ /* computed KPIs with formats */ ],
  "showDetailsDefaultFields": [ /* field api names */ ],
  "organizations": []
}
```

## Gotchas
- `customFormat` is a **JSON string containing an array**: `"[\"$#,###\",1]"` — mind the escaping.
- Colors are per **member** string — they must match the actual dimension values exactly (case-sensitive).
- A derived measure's `field` must exist in the dataset (the recipe/dataflow must produce it) — XMD only
  formats/labels it, it does not create the data.
- In a template bundle these use `${Variables.*}` tokens (e.g. `${Variables.Opportunity_Amount.fieldName}`)
  — TEMPLATE form; substitute the real field name before deploy.

## See also
- `Dashabord/Extended Metadata (XMD)/…` — the full Salesforce XMD reference.
- `Dashabord/Format Dataset Fields and Field Values with XMD/…` — task-oriented XMD how-tos.
