# CRMA Copilot — Dashboard Feature: Functional Guide

> **Audience:** Product, leads, demo users, anyone evaluating or extending the dashboard capability.
> **Status:** Phase 2 — core CRUD complete and verified on storm-org. Preview + Debugger Agent planned (see roadmap).

---

## What It Does (Plain English)

The CRMA Copilot can build, edit, debug, and deploy CRM Analytics dashboards through natural conversation. You don't need to know dashboard JSON, SAQL queries, or widget configuration. You describe what you want and the agent handles it.

**You can ask it to:**

- "List my dashboards"
- "Show me what's in the Segment/Cluster dashboard — how many steps does it have?"
- "Build a dashboard on the Vacant_Units_Analysis dataset with a total count tile and a bar chart by location"
- "The bar chart shows record IDs instead of location names — fix it"
- "Change the bar chart title to 'Vacancies by Property Location'"
- "Add an average rent KPI tile to the dashboard"
- "What's the average rent across all vacant units?"
- "Deploy it"

---

## Full Capability Map

### 1 · Explore

| What you say | What the agent does |
|---|---|
| "List my dashboards" | Returns every dashboard with name, label, folder, and id |
| "How many dashboards are in SharedApp?" | Filters the list by folder |

### 2 · Read & Understand

| What you say | What the agent does |
|---|---|
| "Show me the Vacant Units Overview dashboard" | Retrieves the full state: every step (SAQL query), widget (chart/number/text), and layout |
| "How many steps does it have and what do they query?" | Parses the steps map, returns step names and their SAQL |
| "What dataset does this dashboard use?" | Reads the dataset references from the steps |
| "Explain the bar chart step" | Narrates the SAQL, the grouping, the measure, and how it connects to the widget |

### 3 · Create New

When you ask the agent to build a new dashboard, it follows this sequence:

```
1. Describe what you want → agent plans the layout
2. Agent gets an existing dashboard as a shape reference
   (to mirror the org's exact JSON structure)
3. Agent authors the state JSON:
   - Steps (SAQL queries)
   - Widgets (number tiles, charts, text)
   - Grid layout (positioning)
4. Agent shows you a STRUCTURED PREVIEW in chat (see below)
5. Q&A loop — you ask for changes, agent updates preview
6. You say "deploy" → agent validates → deploys
```

**What the agent builds:**

| Widget type | When used | Example |
|---|---|---|
| `number` tile | KPI, single value (count, average, sum) | "Total Vacant Units: 233" |
| `chart` (horizontal bar) | Comparisons across categories | "Vacancies by Location" |
| `chart` (vertical bar) | Time series or ranked counts | "New listings by month" |
| `chart` (donut/pie) | Part-to-whole | "Units by bedroom count" |
| `text` | Dashboard title, section header | "Vacant Units Overview" |

### 4 · Pre-Deploy Preview (in chat)

**Before the agent deploys anything**, it shows you a structured preview of the dashboard layout and data. You can iterate here — ask for changes, add/remove widgets, change titles — and only when you say "looks good, deploy" does it actually write to the org.

Example preview output:
```
## Dashboard Preview: "Vacant Units Overview"
Layout: 49-column grid · 1 page "Main"

WIDGETS
┌──────────────────────┬─────────────────────────────────────────────────┐
│ NUMBER TILE          │ BAR CHART (horizontal)                          │
│ "Total Vacant Units" │ "Vacant Units by Location"                      │
│ Value: count()       │ X-axis: Vacancies (count)                       │
│ Position: row 7,     │ Y-axis: Location (grouped from Apt_Location__r) │
│ col 2, 20×12         │ Sorted: Vacancies desc · Top 20                 │
├──────────────────────│ Position: row 7, col 24, 25×25                  │
│ NUMBER TILE          │                                                 │
│ "Average Rent"       │                                                 │
│ Value: avg(Rent__c)  │                                                 │
│ Position: row 20,    │                                                 │
│ col 2, 20×12         │                                                 │
└──────────────────────┴─────────────────────────────────────────────────┘

QUERIES
· total_vacancies_1 → count all rows from Vacant_Units_Analysis
· avg_rent_1        → avg(Rent__c) from Vacant_Units_Analysis
· by_location_1     → group by Location, count, top 20 desc

Does this look right? Ask for any changes or say "deploy".
```

This is a conversational loop — you can say:
- "Move the bar chart to full width on its own row"
- "Remove the average rent tile"
- "Change the bar chart to vertical"
- "Add a filter widget for bedrooms"

The agent updates the preview each time. When you're happy: "deploy".

### 5 · Edit (Surgical)

The agent makes the smallest possible change to an existing dashboard:

| What you say | What the agent does |
|---|---|
| "Change the bar chart title" | Sets `widgets.chart_1.parameters.title.label` |
| "Make the chart sort ascending" | Sets the SAQL `order q by Vacancies asc` in the step query |
| "Add a new number tile for total bedrooms" | Adds a new step + widget + grid entry |
| "Remove the text header" | Deletes the text widget and its grid entry |
| "The chart shows IDs instead of names" | Rewrites the step SAQL to use the relationship name field |

### 6 · Data Questions (without rebuilding)

You can ask data questions about any dashboard's datasets without touching the dashboard definition:

| What you say | What the agent does |
|---|---|
| "What's the average rent across all vacant units?" | Runs SAQL against Vacant_Units_Analysis, returns the number |
| "Which location has the most vacancies?" | Groups by location, orders by count desc, returns top result |
| "How many units have been vacant for more than 30 days?" | Filters by Days_Vacant > 30, counts |

The agent returns results as a markdown table or plain number. It never modifies the dashboard to answer a data question.

### 7 · Validate

Before deploying, the agent runs a dry-run validation:
- Tests the dashboard definition against the org's Metadata API
- Surfaces any JSON shape errors, missing dataset references, or deployment blockers
- Explains errors and proposes fixes

### 8 · Deploy

- Dashboard deploy always goes through the **Metadata API** (`.wdash` file)
- Always gated: `DEPLOY_DRY_RUN=false` in `.env` **and** your explicit approval in chat **and** preview was shown
- New dashboards and updates both use the same path (Metadata API handles both)

### 9 · Cross-Org Dataset Remap

If you're copying a dashboard from one org to another, dataset IDs change. The agent can remap dataset IDs by matching dataset names:

> "Move this dashboard from the source org to our production org — the dataset is called Vacant_Units_Analysis in both"

The agent finds the new org's dataset ID by name and replaces all occurrences in the dashboard JSON before deploying.

---

## What Makes a Good Dashboard Request

**Give the agent the dataset name upfront.** The agent needs to know what dataset to query. If you say "build a dashboard on my vacancy data", the agent will ask you which dataset to use.

**Describe the visuals, not the JSON.** Say "a bar chart showing vacancies by location" — not "an hbar chart with dimensionAxis = Location and plots = Vacancies".

**Mention the KPIs you want.** "I want a count of total vacant units and the average rent" → two number tiles.

**Let the agent show you the preview.** Don't jump straight to "deploy". The preview loop catches wrong widget types, missing titles, and wrong data before it hits the org.

---

## Known Constraints

| Constraint | Detail |
|---|---|
| Dataset must exist before deploy | The dashboard steps reference a dataset by name. If the recipe hasn't run yet, the dataset doesn't exist and the dashboard will show no data (or error). Always run the recipe first. |
| Lookup fields show IDs by default | If a field is a lookup (reference type), its raw value in a dataset is a Salesforce record ID. The recipe must include the relationship name field. The agent knows this and handles it — but it requires a correctly built recipe. |
| Dashboard preview is layout-only | The in-chat preview shows widget types, positions, and SAQL queries — it does not render actual chart graphics. It tells you what will be there, with the real data queries, before you commit. |
| Cross-org deploy needs dataset IDs | The dataset entry in the dashboard definition embeds the org-specific dataset ID. Use `remap-dataset-ids` when moving dashboards between orgs. |
| `DEPLOY_DRY_RUN=true` blocks all writes | The default. Set to `false` in `.env` to enable live deploys. |

---

## What Was Built (Sprints D-1 / D-2 / D-3)

### Sprint D-1: Dashboard Debugging — COMPLETE
> "My dashboard is broken — it's not showing any data. Can you help?"

The agent now diagnoses:
- Are the datasets missing or empty? (checks existence + row count)
- Are the SAQL field references valid against the actual dataset fields?
- Are there widgets with no step, or steps with no widget?
- Is the `groups` array incorrectly populated (causes "Column X does not exist for grouping")?
- Are there grid layout mismatches (widget defined but not placed, or placed but not defined)?

New tools: `diagnose-dashboard`, `get-dataset-fields`.

### Sprint D-2: Pre-Deploy Preview — COMPLETE
> "Show me what the dashboard will look like before you deploy it."

The agent now **always** shows a structured layout preview before deploying any new or significantly edited dashboard:
- Steps table (step id, type, SAQL summary)
- Widgets table (widget id, type, title, step, grid position)
- Interactions list
- Q&A loop — ask for changes, agent updates preview, deploy only on explicit approval

The agent can also **read screenshots** you paste: describe broken widgets, positions, and what's wrong before touching any tools.

### Sprint D-3: Debugger Sub-Agent — COMPLETE
> "I've tried fixing it twice and it's still broken. Go deeper."

The agent now has a specialist debugger it can call when it gets stuck:
- Opus-powered, exhaustive 30-step investigation
- Reads the Error Catalog (RAG doc) first to match known errors
- Runs full data checks: field names, row counts, replication, FLS
- Returns a structured Debug Report: root cause, evidence, fix plan in order, verification step
- The copilot presents the report, you approve, it executes

The debugger is also visible in Mastra Studio as a standalone agent (`crma-debugger`) for direct use.

## Phase 3 Roadmap (future)

### Autonomous dashboard screenshot
> Agent opens the org dashboard URL in a headless browser and takes a screenshot to verify rendering.

Requires a `screenshot-dashboard` tool using Playwright/Puppeteer + the sf CLI OAuth token for authentication. Returns a file path the agent reads visually. No manual developer action needed.
