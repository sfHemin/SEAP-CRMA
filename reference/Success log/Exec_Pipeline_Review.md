# ✅ Exec_Pipeline_Review — VERIFIED GOOD

- **Label:** Executive Pipeline Review
- **Verified:** 2026-09-07 — `diagnose-dashboard` → **No issues found** (live query execution, not just deploy)
- **Datasets:** `DS_Pipeline_Intelligence`, `DS_Sales_Rep_Performance`
- **15 widgets:** 4 KPI (number) · 2 chart · 2 table · 6 listselector filters · 1 text title

> RECORD of a run that passed every Test 2D trap. This is NOT a template to clone — build fresh from
> each prompt. Reuse the *techniques* below (win-rate SAQL, CloseDate_* grouping, measureField rule),
> not the whole dashboard. See `README.md` in this folder.

---

## KPI tiles (proven)

| KPI | Step | Query | measureField |
|---|---|---|---|
| Open pipeline value | `kpi_pipeline_1` | `sum Amount, sum Weighted_Pipeline` where `Opportunity_Status not in [Won]` | `sum_Amount` |
| Weighted pipeline | `kpi_pipeline_1` (same step) | ↑ | `sum_Weighted_Pipeline` |
| Deals at risk / overdue | `kpi_atrisk_1` | `count *` filter `Opportunity_Status in [At Risk, Overdue, Stalled]` | `count` |
| **Win rate %** | `kpi_winrate_1` | SAQL (below) | `Win_Rate` |

### ⭐ The proven win-rate % SAQL (this was the hard one)
`sum(case when ...)` is INVALID SAQL. `==` fails (SAQL uses single `=` for filters, but string
compare in a `filter by` uses `==` — see note). Chained `foreach` does not carry aliases forward.
The pattern that WORKS is **cogroup two grouped-by-all streams and divide**:

```
q = load "0Fbhg0000001i5RCAQ/0Fchg000000AZ7lCAG";
won = filter q by 'Opportunity_Status' == "Won";
won = group won by all;
won = foreach won generate count() as 'Won_Count';
total = group q by all;
total = foreach total generate count() as 'Total_Count';
r = cogroup won by all, total by all;
r = foreach r generate (coalesce(sum(won.'Won_Count'), 0) / sum(total.'Total_Count')) * 100 as 'Win_Rate';
r = limit r 1;
```
Load MUST use `"id/versionId"` (not the dataset name) for a raw SAQL step.

> **Semantic flag raised to user:** this = Won / all-tracked deals = **61%**. If the team means
> Won / (Won+Lost), that's **93%**. Agent shipped the common pipeline-review definition and offered
> a one-word swap. Always flag rate definitions rather than silently picking one.

## Charts (proven)

| Widget | viz | Step | Query |
|---|---|---|---|
| Open pipeline **by stage** | `hbar` | `chart_stage_1` | `sum Amount by StageName` where `Opportunity_Status not in [Won]` |
| Open pipeline **by quarter** | `vbar` | `chart_quarter_1` | `sum Amount by CloseDate_Year, CloseDate_Quarter` where `Opportunity_Status not in [Won]` |

⚠️ Quarter grouping uses **`CloseDate_Year` / `CloseDate_Quarter`** (CRMA auto-derived TEXT dimensions),
NOT `FiscalYear`/`FiscalQuarter` (those load as integer measures → error 119 "Invalid group expression").

## Tables (proven)

| Widget | Step | Groups | Measures |
|---|---|---|---|
| Rep leaderboard | `lead_1` | `Rep_Name, Manager_Name` | `sum Won_Revenue, sum Open_Pipeline, sum Win_Rate, avg Avg_Deal_Size, sum Won_Opps, sum Total_Opps` |
| At-risk detail | `atrisk_table_1` | `Name, Account_Name, Owner_Name, StageName, Opportunity_Status` | `sum Amount, sum Probability, sum AgeInDays` |

## Filters (6 listselectors — all broadcast the whole dashboard)

`filter_stage`(f_stage_1) · `filter_status`(f_status_1) · `filter_region`(f_region_1 → groups `Sales_Region`) ·
`filter_owner`(f_owner_1) · `filter_manager`(f_manager_1) · `filter_quarter`(f_quarter_1).

⭐ **Every listselector `measureField` = `count`** (= the step's `count *` alias), NOT `"none"`.
`"none"` on an aggregateflex dimension filter = the fatal `getClassName` null crash / blank page.
