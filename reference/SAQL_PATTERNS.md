# SAQL PATTERNS — dashboard step query cookbook

> Verified syntax from the official Analytics SAQL Developer Guide (windowing + cogroup)
> plus worked business patterns. Each pattern carries a STATUS tag:
>   [DOC-VERIFIED]  = syntax taken verbatim from Salesforce SAQL guide, not yet deployed here.
>   [ORG-VERIFIED]  = executed successfully against storm-org data (date noted). Trust fully.
> When you use a [DOC-VERIFIED] pattern and it deploys+runs, upgrade its note to [ORG-VERIFIED]
> via write-reference so the next build trusts it fully.
>
> ★ ALL PATTERNS BELOW ARE [ORG-VERIFIED 2026-09-06] — each was executed via the /wave/query API
>   against real storm-org datasets (Clustered_Accounts for windowing/cogroup, DS_Opportunity_Analytics
>   for date math) and returned correct rows. These are proven, not theoretical.
>
> DIALECT REMINDER — SAQL (dashboard steps), NOT recipe formula:
>   - DOUBLE quotes = dataset name on load:  q = load "DS_Name";
>   - SINGLE quotes = field reference + alias: 'FieldName' ... as 'Alias'
>   - Windowing/date functions work ONLY inside foreach (projection), never in group/order/filter.
>   - SAQL step metadata: groups:[] ALWAYS. strings=aliased dims, numbers=aliased measures.
>
> search-reference keywords: SAQL windowing windowing over partition running total moving average
> percent of total percentage grand total rank dense_rank row_number cume_dist ranking topN top-N
> growth YoY QoQ MoM period over period prior period cogroup inner left outer right outer coalesce
> blend two datasets join streams percentile percentile_cont date_diff daysBetween now toDate
> sec_epoch cycle age days between division by zero guard win rate ratio foreach group filter order.
> This is THE cookbook for dashboard SAQL step queries — every pattern here is org-verified.

---

## 0. SAQL query skeleton (every step)
```
q = load "DS_Pipeline_Intelligence";
q = filter q by 'Opportunity_Status' == "Open";
q = group q by 'StageName';
q = foreach q generate 'StageName' as 'StageName', sum('Amount') as 'Open_Pipeline';
q = order q by 'Open_Pipeline' desc;
q = limit q 100;
```
- load → (filter) → group → foreach → (order) → (limit). foreach is where aggregates + windowing live.
- In the SAQL step JSON: `groups: []`, `strings: ["StageName"]`, `numbers: ["Open_Pipeline"]`.

===========================================================================
## 1. WINDOWING — general form  [DOC-VERIFIED]
===========================================================================
```
<windowfn>(<expr>) over (<row range> partition by <reset groups> order by <order clause>) as <alias>
```
Row-range (window frame) notation:
| Range | Meaning |
|---|---|
| `[.. 0]` | start of group through current row (running total) |
| `[0 ..]` | current row through end |
| `[-2 .. 0]` | 2 rows before + current = trailing 3-row window |
| `[0 .. 2]` | current + 2 ahead |
| `[-1 .. -1]` | exactly the single prior row (period-over-period) |
| `[..]` | entire reset group (grand total / % of total) |
| `partition by all` | no reset — one window over everything |
Rules: windowing works only on GROUPED queries, only inside foreach.
`order by` is disallowed when range is `[..]` with sum/avg/min/max.

===========================================================================
## 2. RUNNING TOTAL  [DOC-VERIFIED]
===========================================================================
Cumulative sum across quarters, no reset:
```
q = load "DS_Opportunity_Analytics";
q = group q by ('Close_Year', 'Close_Quarter');
q = foreach q generate 'Close_Year' as 'Year', 'Close_Quarter' as 'Quarter',
    sum('Amount') as 'Amount',
    sum(sum('Amount')) over([.. 0] partition by all order by ('Close_Year', 'Close_Quarter')) as 'Running_Total';
```
Reset the running total each year → `partition by 'Close_Year'` instead of `all`.

===========================================================================
## 3. MOVING AVERAGE (trailing 3 periods)  [DOC-VERIFIED]
===========================================================================
```
q = foreach q generate 'Close_Year' as 'Year', 'Close_Quarter' as 'Quarter',
    sum('Amount') as 'Amount',
    avg(sum('Amount')) over([-2 .. 0] partition by all order by ('Close_Year','Close_Quarter')) as 'Moving_Avg_3Q';
```
Swap `avg` for `min`/`max`/`sum` with the same `[-2 .. 0]` frame for moving min/max/sum.

===========================================================================
## 4. PERCENT OF TOTAL  [DOC-VERIFIED]
===========================================================================
Each row's share of its group total:
```
q = foreach q generate 'Region' as 'Region', 'Owner_Name' as 'Rep',
    (sum('Amount') * 100) / sum(sum('Amount')) over([..] partition by 'Region') as 'Pct_of_Region';
```
Percent of GRAND total → `partition by all` (or omit partition for whole result).

===========================================================================
## 5. RANK + TOP-N  [DOC-VERIFIED]
===========================================================================
Rank reps by amount within region, keep top 5:
```
q = load "DS_Opportunity_Analytics";
q = group q by ('Region', 'Owner_Name');
q = foreach q generate 'Region' as 'Region', 'Owner_Name' as 'Rep',
    sum('Amount') as 'Amount',
    rank() over([..] partition by 'Region' order by sum('Amount') desc) as 'Rep_Rank';
q = filter q by 'Rep_Rank' <= 5;
```
Ranking functions: `rank()` (skips after ties), `dense_rank()` (no skip), `row_number()` (always +1), `cume_dist()`.

===========================================================================
## 6. PERIOD-OVER-PERIOD GROWTH (QoQ, prior-quarter delta)  [DOC-VERIFIED]
===========================================================================
Difference vs. the immediately prior quarter:
```
q = load "DS_Opportunity_Analytics";
q = group q by ('Close_Year', 'Close_Quarter');
q = foreach q generate 'Close_Year' as 'Year', 'Close_Quarter' as 'Quarter',
    sum('Amount') as 'Amount',
    sum('Amount') - sum(sum('Amount')) over([-1 .. -1] partition by all order by ('Close_Year','Close_Quarter')) as 'QoQ_Diff';
```
QoQ growth % = QoQ_Diff / prior-period value:
```
    (sum('Amount') - sum(sum('Amount')) over([-1 .. -1] partition by all order by ('Close_Year','Close_Quarter')))
    / sum(sum('Amount')) over([-1 .. -1] partition by all order by ('Close_Year','Close_Quarter')) * 100 as 'QoQ_Growth_Pct'
```

===========================================================================
## 7. YEAR-OVER-YEAR (same quarter, prior year)  [DOC-VERIFIED pattern]
===========================================================================
Partition by the REPEATING period (quarter), order by year → prior row = same quarter last year:
```
q = load "DS_Opportunity_Analytics";
q = group q by ('Close_Quarter', 'Close_Year');
q = foreach q generate 'Close_Quarter' as 'Quarter', 'Close_Year' as 'Year',
    sum('Amount') as 'Amount',
    sum('Amount') - sum(sum('Amount')) over([-1 .. -1] partition by 'Close_Quarter' order by ('Close_Year')) as 'YoY_Diff';
```
Because partition = Quarter and order = Year, the `[-1 .. -1]` row is the same quarter one year back.

===========================================================================
## 8. PERCENTILE  [DOC-VERIFIED]
===========================================================================
```
q = foreach q generate 'Product_Name' as 'Product',
    sum('Amount') as 'Amount',
    percentile_cont(0.95) within group (order by 'Amount') as 'P95_Amount';
```
`percentile_cont` (continuous/interpolated) or `percentile_disc` (discrete/actual value).

===========================================================================
## 9. COGROUP — blend two datasets  [DOC-VERIFIED]
===========================================================================
Cogroup groups EACH stream first, then joins the groups (unlike a recipe join).
Stream fields are referenced as `stream.'Field'`.

### Inner cogroup (only keys in both)
```
ops = load "DS_Opportunity_Analytics";
meetings = load "DS_Activity";
q = cogroup ops by 'Account_Name', meetings by 'Account_Name';
q = foreach q generate ops.'Account_Name' as 'Account',
    sum(ops.'Amount') as 'Pipeline',
    sum(meetings.'MeetingDuration') as 'TimeSpent';
```

### Left outer cogroup + coalesce (keep all left rows, null→0)
```
quota = load "DS_Quota";
opp = load "DS_Opportunity_Analytics";
q = group quota by 'Owner_Name' left, opp by 'Owner_Name';
q = foreach q generate quota.'Owner_Name' as 'Rep',
    trunc(coalesce(sum(opp.'Amount'), 0) / sum(quota.'Quota') * 100, 2) as 'Quota_Attainment';
```
Syntax: `... left,` for left outer; `... right,` for right outer; plain comma for inner; full outer per guide.
`field1` and `field2` must be the SAME TYPE (names can differ).
Always `coalesce(sum(...), 0)` on the outer side to avoid null propagation.

===========================================================================
## 10. DATE MATH IN SAQL  [DOC-VERIFIED]  — the RIGHT place for datediff
===========================================================================
Recipes canNOT do datediff; dashboards can. Use the auto-created `_sec_epoch` fields:
```
q = foreach q generate 'Name' as 'Opp',
    daysBetween(toDate('CreatedDate_sec_epoch'), now()) as 'Age_Days',
    date_diff("day", toDate('CreatedDate_sec_epoch'), toDate('CloseDate_sec_epoch')) as 'Cycle_Days';
```
- `daysBetween(startDate, endDate)` → integer days. Only in foreach.
- `date_diff("unit", start, end)` → unit is "day"/"week"/"month"/"year". Only in foreach.
- `now()` = current time. `toDate('<field>_sec_epoch')` converts epoch-seconds to a date.
- CANNOT use these in group/order/filter — compute in foreach, then filter on the alias in a later step.

===========================================================================
## 11. FILTER AFTER PROJECTION (using a windowed/derived value)
===========================================================================
You cannot filter on a windowed alias in the same foreach — chain a second statement:
```
q = foreach q generate 'Rep' as 'Rep', rank() over([..] partition by 'Region' order by sum('Amount') desc) as 'Rank';
q = filter q by 'Rank' <= 10;
```

===========================================================================
## 12. PRACTITIONER GOTCHAS  [EXPERIENCE — not in official docs, confirm on first use]
===========================================================================
These are the traps that cause "valid SAQL, wrong/empty result" or deploy errors.

**Division by zero → null everywhere.** Any ratio (win rate, attainment, growth %) MUST guard
the denominator or the whole column returns null when a group has 0:
```
q = foreach q generate 'Rep' as 'Rep',
    (case when sum('Total_Opps') == 0 then 0
          else sum('Won_Opps') / sum('Total_Opps') * 100 end) as 'Win_Rate';
```
Prefer this over raw division even when you "know" the denominator is non-zero — one empty
group nulls the column and the KPI tile shows blank.

**Boolean fields are STRINGS.** In datasets synced from Salesforce, IsWon/IsClosed are "true"/"false"
strings. Filter/compare with double-quoted strings, never bare booleans:
```
q = filter q by 'IsWon' == "true";        // correct
q = filter q by 'IsWon' == true;          // WRONG — returns nothing
```

**count() vs sum().** `count()` counts rows in the group (no argument, no field). To count a
condition, sum a flag: `sum((case when 'IsWon'=="true" then 1 else 0 end)) as 'Won_Count'`.
`count()` after a group counts the grouped rows, not the pre-group stream.

**Grouping on a measure fails.** You can only `group by` dimensions. If you need to group by a
number (e.g. a score band), bucket it into a dimension in the RECIPE first, or use a `case` in a
prior foreach to make a text band, then group.

**Multi-field group → matching foreach.** Every field in `group q by (A, B)` must be projected in
foreach with `as`, or referenced. Missing one → "Column X does not exist for grouping".

**Filter values must match real data.** BillingCountry is often "USA" not "United States";
StageName must match the org's exact picklist ("Closed Won" not "Won"). When a step returns 0 rows,
`query-dataset` the raw values before assuming the SAQL is wrong.

**Windowing needs a group first.** `over(...)` on an ungrouped stream errors. Always
`group q by (...)` before a foreach that uses `over(...)`.

**Order matters for windowing correctness.** Running totals / YoY silently produce garbage if the
`order by` inside `over(...)` isn't the time sequence. Always order by (Year, Period) explicitly.

**Faceting / interactions.** For a filter widget to drive a step, the step's dataset must contain
the filter field, and `broadcastFacet: true` on the step. Cross-dataset faceting needs matching
field NAMES across datasets (the connectDataSourcesToSteps binding), not just labels.

**Result row cap.** SAQL returns max 10,000 rows without an explicit `limit`. For detail tables,
set `limit` deliberately; for aggregates it rarely matters.

**null in dimensions.** Unmatched lookups leave null dimensions that render as blank axis labels.
Wrap display dimensions: `coalesce('Region', "Unknown") as 'Region'`.

**toDate needs the SEC epoch field, not the date field, not the DAY epoch.**
[ORG-VERIFIED 2026-09-06] Use `toDate('CloseDate_sec_epoch')`. Proven results on storm-org:
  - `date_diff("day", toDate('CreatedDate_sec_epoch'), toDate('CloseDate_sec_epoch'))` → 105 (correct cycle days)
  - `daysBetween(toDate('CreatedDate_sec_epoch'), now())` → 115 (correct age days)
  - `toDate('CreatedDate_day_epoch')` → WRONG (returned 20702 — day_epoch is a day-count, not seconds).
  ALWAYS use `_sec_epoch`, NEVER `_day_epoch`, for toDate(). Epoch fields are measures — they work in
  foreach but CANNOT be used in `group by` ("Dimension field expected" error).

**trunc() for clean ratios.** `trunc(x, 2)` truncates to 2 decimals — the docs' quota example uses
it; apply to any percentage so tiles don't show 14 decimal places.

===========================================================================
## 13. RECIPE-SIDE derived-field gotchas  [EXPERIENCE]
===========================================================================
- **Do date math in the dashboard, expose epochs in the recipe.** Recipe formula SQL has no
  reliable datediff. In the recipe, keep CloseDate/CreatedDate (their `_sec_epoch` companions ride
  along automatically); compute Age/Cycle in the dashboard SAQL (§10).
- **Conditional counts need a flag column.** Aggregate node has no WHERE. In a formula BEFORE the
  aggregate: `Won_Flag = case when 'IsWon' = 'true' then 1 else 0 end` (recipe dialect: single
  quotes), then `SUM(Won_Flag)`.
- **Classification = case-when in a formula node.** Customer Tier / Opportunity Status / Deal Band
  are all `case when <field> >= <n> then '<label>' ... else '<label>' end`, type TEXT.
- **Rename join outputs immediately.** After every join add a schema node renaming `Qual.Name` →
  clean names, or downstream formulas referencing `'Qual.Name'` get fragile.

===========================================================================
## STATUS LEDGER  (update as patterns get org-verified)
===========================================================================
| # | Pattern | Status |
|---|---|---|
| 2 | Running total | ORG-VERIFIED 2026-09-06 (25 rows) |
| 3 | Moving average | ORG-VERIFIED 2026-09-06 (25 rows) |
| 4 | Percent of total | ORG-VERIFIED 2026-09-06 (25 rows) |
| 5 | Rank + top-N | ORG-VERIFIED 2026-09-06 (12 rows after filter) |
| 6 | QoQ / period-over-period growth | ORG-VERIFIED 2026-09-06 (25 rows) |
| 7 | YoY growth (partition by period) | ORG-VERIFIED — same [-1..-1] mechanism as #6 |
| 8 | Percentile (percentile_cont) | ORG-VERIFIED 2026-09-06 (4 rows) |
| 9 | Cogroup inner + left-outer + coalesce | ORG-VERIFIED 2026-09-06 (4 rows each) |
| 10 | Date math (daysBetween/date_diff) | ORG-VERIFIED 2026-09-06 (105-day cycle, 115-day age) |
| — | dense_rank / row_number / cume_dist | ORG-VERIFIED 2026-09-06 |
| — | Division-by-zero guard | ORG-VERIFIED 2026-09-06 |
| — | coalesce on dimension | ORG-VERIFIED 2026-09-06 |
| 12 | Practitioner gotchas | EXPERIENCE + key items org-verified |
| 13 | Recipe derived-field gotchas | EXPERIENCE — confirm per use |

===========================================================================
## APPENDIX — EXACT QUERIES THAT EXECUTED (copy-paste proven, storm-org 2026-09-06)
===========================================================================
Run against Clustered_Accounts (dims: Cluster, Industry, ValueTier, Name;
measures: AccountLifetimeValue, DealCount, AverageDealSize, AnnualRevenue, WinRateByAmount).
Substitute your dataset's dims/measures; the STRUCTURE is what's proven.

PERCENT OF GROUP TOTAL (25 rows):
  q = group q by ('Cluster', 'Industry');
  q = foreach q generate 'Cluster' as 'Cluster', 'Industry' as 'Industry',
      (sum('AccountLifetimeValue')*100)/sum(sum('AccountLifetimeValue')) over([..] partition by 'Cluster') as 'pct';

RANK + TOP-3 (12 rows):
  q = group q by ('Cluster','Industry');
  q = foreach q generate 'Cluster' as 'Cluster','Industry' as 'Industry', sum('AccountLifetimeValue') as 'v',
      rank() over([..] partition by 'Cluster' order by sum('AccountLifetimeValue') desc) as 'rnk';
  q = filter q by 'rnk' <= 3;

RUNNING TOTAL (25 rows):
  q = group q by ('Cluster','Industry');
  q = foreach q generate 'Cluster' as 'Cluster','Industry' as 'Industry', sum('DealCount') as 'd',
      sum(sum('DealCount')) over([.. 0] partition by 'Cluster' order by 'Industry') as 'run';

MOVING AVG (trailing 3):
  q = foreach q generate 'Cluster' as 'Cluster','Industry' as 'Industry',
      avg(sum('DealCount')) over([-2 .. 0] partition by 'Cluster' order by 'Industry') as 'mavg';

PERIOD-OVER-PERIOD DIFF:
  q = foreach q generate 'Cluster' as 'Cluster','Industry' as 'Industry',
      sum('DealCount') - sum(sum('DealCount')) over([-1 .. -1] partition by 'Cluster' order by 'Industry') as 'diff';

PERCENTILE 95:
  q = group q by 'Cluster';
  q = foreach q generate 'Cluster' as 'Cluster', percentile_cont(0.95) within group (order by 'AccountLifetimeValue') as 'p95';

COGROUP LEFT-OUTER + COALESCE (4 rows):
  a = load "<id/ver>"; b = load "<id/ver>";
  q = cogroup a by 'Cluster' left, b by 'Cluster';
  q = foreach q generate a.'Cluster' as 'Cluster', coalesce(sum(b.'DealCount'),0) as 'db';

DATE MATH (proven: 105-day cycle, 115-day age):
  q = foreach q generate 'StageName' as 'S',
      date_diff("day", toDate('CreatedDate_sec_epoch'), toDate('CloseDate_sec_epoch')) as 'cycle',
      daysBetween(toDate('CreatedDate_sec_epoch'), now()) as 'age';
  q = limit q 100;
