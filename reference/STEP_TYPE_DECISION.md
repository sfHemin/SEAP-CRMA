# DASHBOARD STEP TYPE — pick the RIGHT one per situation (do NOT default to one)

> Concepts / search keywords: step type decision, aggregateflex vs saql vs staticflex vs grain,
> when to use saql step, when to use static step, choose step type, compact form vs saql form,
> toggle step, ranking window function step, cogroup step, raw rows step, dashboard query step.

**The rule: there is NO default step type. Read the requirement, then choose.**
A dashboard is *correct* when each step uses the type that fits its job — not when every step
is the same type. The four types below each exist because the others cannot do that job well.
Forcing everything into `aggregateflex` (or everything into `saql`) produces either impossible
queries or needless complexity. Decide per step.

---

## 30-second decision tree

```
What does THIS step need to do?
│
├─ A fixed, author-defined SET OF OPTIONS to pick from — a $-vs-# toggle / mode switch?
│   (the option LIST is hand-authored; each option still carries its own group/measure/filter)
│        → staticflex
│
├─ Raw, ungrouped rows (record-level table, "show me the opportunities")?
│        → grain  (lens/grain step — no aggregation)
│
├─ A simple "group by dimension(s), aggregate measure(s)" summary
│   (bar, column, donut, line, KPI tile, most tables, filter panels)?
│        → aggregateflex   ← the canvas-native form; great for the common case
│
└─ Anything aggregateflex CANNOT express cleanly:
     • window / ranking (rank, row_number, lag/lead, running total, percentile)
     • two-level aggregation (e.g. avg of a per-group max — see example below)
     • cogroup / blending two datasets
     • date-range logic beyond a simple filter
     • the whole query must bind to an interaction (full-query binding), drill-down
        → saql
```

If two types could both work, prefer the **simpler** one (usually aggregateflex) — but never
at the cost of correctness. "Do not force aggregateflex when saql is the better tool, and do
not reach for saql when aggregateflex already does the job."

---

## The four types at a glance

| Type | Use it for | Query form | Not for |
|---|---|---|---|
| **aggregateflex** | group + aggregate: bars, columns, donut/pie, line, KPI tiles, most tables, filter panels | compact `query.query.measures/groups/filters` (or `sources[]`), wrapper `version:-1` | window/ranking, cogroup, multi-level aggregation |
| **saql** | window/rank, running totals, percentiles, cogroup/blend, complex date math, full-query interaction binding | a raw SAQL string (`q = load …; q = group …; q = foreach …`) | simple summaries (overkill) |
| **staticflex** | toggle/selector with a **fixed** set of options; $-vs-# view switch; mode pickers | `values:[{display,grp,meas,filt}, …]` — each option carries its own grouping/measure/filter | anything that must query live data by itself |
| **grain** (lens) | raw record rows, no grouping ("list the actual opportunities") | grain/lens query | any summary/KPI |

---

## Real contrasting examples (from deployed Salesforce templates — mirror the shapes)

### aggregateflex — the common case (a KPI: closed-won amount in the prior period)
```json
{
  "type": "aggregateflex",
  "datasets": [{ "name": "<dataset>" }],
  "query": {
    "query": {
      "measures": [["sum", "Amount__c"]],
      "filters": [
        ["IsWon__c", ["true"], "in"],
        ["CloseDate__c", "{{column(timeperiod_list.selection, [\"prior\"]).asObject()}}"]
      ]
    },
    "version": -1.0
  },
  "visualizationParameters": { "visualizationType": "hbar" }
}
```
Why aggregateflex: one group/aggregate with filters — exactly what it's for.

### saql — because aggregateflex CANNOT do it (avg sales-cycle = **avg of a per-opportunity max**)
```
q = load "<dataset>";
q = filter q by 'IsClosed' == "true";
q = filter q by 'IsWon' == "true";
q = group q by 'OpportunityId';                       -- level 1: per opportunity
q = foreach q generate max('OpportunityAge') as 'age';
q = group q by all;                                   -- level 2: across all
q = foreach q generate avg('age') as 'avg_age';
q = limit q 2000;
```
Why saql: two-level aggregation (aggregate, then aggregate again). aggregateflex has one
grouping level — it literally cannot express "average of each deal's max age." This is the
canonical "switch to saql" trigger.

### staticflex — a fixed $-vs-# toggle (author-defined OPTION LIST, each with its own query)
```json
{
  "type": "staticflex",
  "selectMode": "singlerequired",
  "values": [
    { "display": "$", "grp": "ForecastCategory", "meas": [["sum", "Amount__c"]],
      "filt": [["IsClosed", ["false"], "in"]] },
    { "display": "#", "grp": "ForecastCategory", "meas": [["count", "*"]],
      "filt": [["IsClosed", ["false"], "in"]] }
  ]
}
```
Why staticflex: the option LIST ($ amount vs # count) is author-defined rather than returned by a
query — but each option still carries its own `grp`/`meas`/`filt`, so selecting one runs that
aggregation. Use it to drive a toggle/selector that other steps read via binding. (Contrast with
aggregateflex, where the whole result set comes from one query, not a hand-authored option list.)

### grain — raw rows (record-level table)
Use a grain step when the user wants the actual records ("show me the 20 open deals"), with no
grouping. Its query lists the fields to display via `query.query.values` (no `measures`/`groups`):
```json
{
  "type": "grain",
  "datasets": [{ "name": "<dataset>" }],
  "query": {
    "query": {
      "values": ["Account.Name", "Name", "Owner.Name", "CloseDate", "StageName", "Amount"]
    }
  },
  "visualizationParameters": { "visualizationType": "valuestable" }
}
```
It returns rows as-is — pick the columns, don't aggregate. (Unlike saql, no `load`/`foreach` string;
unlike aggregateflex, no `measures`/`groups`.)

---

## Editing / debugging an existing dashboard

**Preserve the existing step type.** If a dashboard already uses `saql` steps, keep them saql;
if `aggregateflex`, keep that. Only change type if the user's requested change *genuinely*
requires a different one (e.g. they ask for ranking on an aggregateflex step → convert to saql).
Gratuitous conversion risks breaking bindings and the columnMap wiring.

## Two gotchas that bite when you switch types
- **aggregateflex** query is a **stringified-JSON wrapper** on metadata deploy:
  `"query": { "query": "{…}", "version": -1 }` — NOT the nested REST object.
- **saql** steps reject `isGlobal`; aggregateflex allows it. saql steps take **no** `datasets` array
  (the dataset is named inside the `load`). See DASHBOARD_PATTERNS.md gotchas.
- When you change a step's type, the widget's data-binding form must change with it
  (see [[chart-type-change-wiring-bug]] / DASHBOARD_PATTERNS #0e) or the widget renders empty.

## See also
- `SAQL_PATTERNS.md` — org-verified SAQL for window/rank/running-total/cogroup/date-math (use when you pick saql).
- `DASHBOARD_PATTERNS.md` — deploy shapes + validator gotchas.
- `Dashabord/steps json` — the full Salesforce step-type reference (all properties per type).
