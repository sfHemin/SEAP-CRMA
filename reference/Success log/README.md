# Success log — proven-good dashboards

One `.md` per dashboard that has reached **`diagnose-dashboard: No issues found`** on a real deploy.
This is the POSITIVE counterpart to the failure/fix memories: it records the *shape that worked* so
the agent (and a human) can copy a known-good pattern instead of rediscovering it.

**When to write one:** immediately after a dashboard deploy passes live verification
(`diagnose-dashboard` returns "No issues found"). Never before — a dashboard that only
"deployed" or "previewed" is NOT done and does NOT get a success-log entry. See the render-truth
rule in `DASHBOARD_PATTERNS.md`.

**What each file records:**
- Datasets used (by name).
- Every widget → its step → the exact query (aggregateflex compact JSON or SAQL) → the proven data value.
- KPI sanity-checks against real org numbers.
- Any semantic flags raised to the user (e.g. win-rate definition).
- Which preview tweaks were requested and whether they previewed faithfully.
- The `diagnose-dashboard` proof + timestamp.

## ⛔ This is a RECORD, not a clone-source

These files are a **human-readable record of what passed**, plus a reference for **reusable
techniques** (e.g. the proven win-rate % SAQL, the "group by CloseDate_* not FiscalYear" rule).

The agent must **NOT** copy a whole dashboard from here to satisfy a new request. Every dashboard
is built fresh **from the current prompt's business requirements** — decide widgets/steps/queries
from what THIS user asked for, not by lifting a prior dashboard's shape. The agent stays generic:
it never assumes the datasets, field names, or layout of a past build carry over.

**What IS safe to reuse:** individual proven patterns (a specific SAQL idiom, a filter shape,
the measureField=alias rule). **What is NOT:** the dashboard as a template. When in doubt, read
`DASHBOARD_PATTERNS.md` for the technique and build from the live org's actual fields.
