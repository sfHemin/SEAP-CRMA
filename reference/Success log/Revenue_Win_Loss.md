# ✅ Win/Loss and Account Health — VERIFIED GOOD

- **Label:** Win/Loss and Account Health
- **Verified:** 2026-09-07 — `diagnose-dashboard` → **No issues found** (live query execution)
- **Datasets:** `DS_Win_Loss_Analysis`, `DS_Account_360`
- **18 widgets:** 4 KPI (number) · 3 chart · 2 table · 8 listselector filters · 1 text title

> RECORD of a passed run — NOT a clone-source. Build fresh from each prompt; reuse techniques
> (dimension-grouping instead of sum(case), CloseDate_* not FiscalQuarter, measureField=count), not
> the dashboard shape. See `README.md` in this folder.

---

## KPI tiles (proven)

| KPI | Step | Query | measureField |
|---|---|---|---|
| Total won revenue | `kpi_wl_1` | `sum Amount, count *` filter `Outcome in [Won]` | `sum_Amount` |
| Won opportunities | `kpi_wl_1` (same step) | ↑ | `count` |
| Avg deal size | `kpi_wl_1` (same step) | ↑ | `avg_Amount` |
| Total accounts | `kpi_acct_1` | `count *` (DS_Account_360) | `count` |

## Charts (proven)

| Widget | viz | Step | Query |
|---|---|---|---|
| Won revenue **by industry** | `hbar` | `chart_industry_1` | `sum Amount by Industry` filter `Outcome in [Won]` — Technology $4.83M leads |
| **Win vs loss by quarter** | `vbar` | `chart_trend_1` | `count * by CloseDate_Year, CloseDate_Quarter, Outcome` — side-by-side Won/Lost |
| Outcomes **by deal-size band** | `hbar` | `chart_band_1` | `count * by Deal_Size_Band, Outcome` |

⚠️ Win-vs-loss trend groups by `(CloseDate_Year, CloseDate_Quarter, Outcome)` with `count()` — NOT
`sum(case when Outcome=Won...)` (invalid SAQL "require field in sum"). Group by the dimension instead.
Quarter dimension = `CloseDate_*`, never `FiscalQuarter` (measure → error 119).

## Tables (proven)

| Widget | Step | Groups | Measures |
|---|---|---|---|
| Top accounts | `table_acct_1` | `Name, Owner_Name, Industry, BillingState, Customer_Tier, Account_Status` | `sum Won_Revenue, sum Open_Pipeline, sum Win_Rate` filter `Won_Revenue > 0` |
| Win/Loss detail | `table_wl_1` | `Rep_Name, Manager_Name, Sales_Region, Industry, Outcome, Deal_Size_Band` | `sum Amount, sum Sales_Cycle_Days` |

## Filters (8 listselectors — all broadcast, all `measureField = count`)

`filter_fy`(CloseDate_Year) · `filter_fq`(CloseDate_Quarter) · `filter_region`(Sales_Region) ·
`filter_industry`(Industry) · `filter_manager`(Manager_Name) · `filter_owner`(Rep_Name) ·
`filter_tier`(Customer_Tier) · `filter_outcome`(Outcome).

⭐ FY/FQ filters use **`CloseDate_Year` / `CloseDate_Quarter`** dimensions, not FiscalYear/FiscalQuarter.
