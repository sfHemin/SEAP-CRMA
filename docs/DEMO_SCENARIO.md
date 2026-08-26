# CRMA Copilot — Live Demo Scenario

A full run-of-show for leadership: the **agent** creates, deploys, runs, edits,
debugs, answers questions, and builds a dashboard — all from chat, live against
**storm-org**. Nothing is pre-built; the audience watches it happen.

> **Two storylines are ready.** Story A (**Apartment / real-estate**) is the
> richest data and shows the FLS self-heal. Story B (**Sales Pipeline**) is the
> classic CRMA story on standard objects. Pick one for a 10-min slot, or run A
> then B for a longer session. Both are proven end-to-end.

---

## Pre-flight (before the audience joins)

```bash
# 1. Org connected?
sf org list                 # storm-org shows Connected

# 2. In the project, writes enabled?
cd "/Users/hemin.kale/Desktop/CRMA Assets/CRMA Mastra"
cat .env                    # SF_TARGET_ORG=storm-org, DEPLOY_DRY_RUN=false

# 3. Launch Mastra Studio
npm run dev                 # → http://localhost:4111  (open in Chrome)
```

In Studio's left nav you'll see agent **crma-copilot** and its **16 tools**
(list / get / edit / validate / deploy / run / run-status / check-field-access /
grant-field-access for recipes + the dashboard tools).

> Talking point: *"This is Mastra's own Studio. Every tool is a Mastra object.
> Claude drives the tool calls; the tools talk to Salesforce as me via the `sf`
> CLI. The model runs on Claude Opus/Sonnet through Salesforce's own gateway —
> no personal API key."*

State the org out loud: **storm-org** = `storm-b937d15ac2e285.my.salesforce.com`.

---

## STORY A — Apartment / Real-Estate Analytics

Data: `Apartment__c` (1,499 rows: Rent, Bedrooms, Occupied, Days_Vacant, Location).
This story deliberately triggers — and self-heals — the FLS permission issue,
which is a great "the agent knows the platform" moment.

### A1 · Explore (prove live connection)
> **List my recipes and dashboards.**

> **What objects can I build analytics on? I'm interested in our apartment/property data — what fields does the Apartment object have?**

*(Agent lists recipes/dashboards, then can describe `Apartment__c`. Shows it's
reading the live org, not guessing.)*

### A2 · Create + deploy a recipe
> **Create a recipe called `Vacant_Units_Analysis` (label "Vacant Units Analysis") that loads the Apartment object, keeps only units where Occupied is false, carries the fields Name, Rent, Bedrooms, Days_Vacant and the location, and writes a dataset called `Vacant_Units_Analysis`. Show me the plan and validate it, then deploy.**

*(Agent authors R3, validates, asks approval, deploys via Wave REST → recipe
created. Talking point: new recipes go through the Wave REST API, not metadata —
the agent knows the right write path per asset type.)*

### A3 · Run it — and watch the agent handle FLS
> **Run it and tell me how many vacant units we have.**

*(This is the highlight. Because `Apartment__c` fields are custom, either:*
- *the agent proactively runs **check-field-access** first and warns the fields
  are blocked for the Integration User, OR*
- *the run fails and the agent reads the error, diagnoses the FLS issue, and
  proposes **grant-field-access**.*

*Either way it explains: "CRMA syncs as the Analytics Integration User, which
can't read these custom fields — I can grant read via a permission set." Approve
it, the agent grants + re-runs → **748 vacant units**.)*

> Talking point: *"That's the difference between a script and an agent — it hit a
> real platform permission wall, understood why, and fixed it. That FLS gotcha
> is exactly the kind of thing that costs an admin an afternoon."*

### A4 · Ask questions about the data
> **Of those vacant units, what's the average rent, and which location has the most vacancies?**

*(Agent runs SAQL via query-dataset and answers in a table.)*

### A5 · Edit + re-deploy + debug
> **Edit the recipe to also exclude units vacant for fewer than 30 days — we only care about long-vacant ones. Validate, deploy, and re-run.**

*(Agent makes a surgical edit, re-deploys, re-runs. If the numeric filter errors,
say "read the validation error and fix it" — shows the debug loop.)*

### A6 · Build + deploy a dashboard
> **Build a dashboard "Vacant Units Overview" on the Vacant_Units_Analysis dataset with a total-vacant-units number tile and a bar chart of vacant units by location. Mirror an existing dashboard's structure, validate, then deploy.**

*(Agent gets an existing dashboard to mirror the strict `.wdash` shape, authors
state, validates, deploys via metadata API. Open it in Analytics Studio →
SharedApp to show it live.)*

---

## STORY B — Sales Pipeline Analytics (standard objects, no FLS step)

Data: Opportunity (759, incl. 444 Closed Won) + Account. All standard fields —
the Integration User already has access, so this runs clean with no permission
detour. Use this if you want the classic CRMA narrative or a backup that avoids
the FLS moment.

### B1 · Create + deploy
> **Create a recipe `Pipeline_Analysis` (label "Pipeline Analysis") that loads Opportunity, joins to Account to bring in the account Name and Industry, keeps Amount, StageName, CloseDate, IsWon, and writes a dataset `Pipeline_Analysis`. Validate and deploy.**

### B2 · Run + verify
> **Run it and tell me the total pipeline amount and how many opportunities are Closed Won.**

### B3 · Ask a question
> **What's our win rate by stage? Show it as a table.**

### B4 · Edit + debug + re-deploy
> **Edit the recipe to only include opportunities that closed this year, then re-deploy and re-run.**

*(If it errors on the date filter, "read the error and fix it, then re-validate.")*

### B5 · Dashboard
> **Create a dashboard "Pipeline Overview" on Pipeline_Analysis with a total-pipeline number tile and a bar chart of opportunity count by stage. Validate and deploy.**

---

## Safety gate (optional 30-sec moment)

At any deploy/run step, first say **"deploy it"** *without* having approved, to
show the agent asks for confirmation and won't write until you say yes. Then
approve. Demonstrates the two-key gate (`DEPLOY_DRY_RUN=false` **and** in-chat
`confirm:true`).

---

## Cleanup after the demo

To reset the org for the next run, ask the agent (or run via CLI):
```bash
cd "/Users/hemin.kale/Desktop/CRMA Assets/CRMA Mastra/.sfdx-work"
sf project delete source --metadata WaveRecipe:Vacant_Units_Analysis --metadata WaveDataset:Vacant_Units_Analysis --target-org storm-org --no-prompt
sf project delete source --metadata WaveRecipe:Pipeline_Analysis --metadata WaveDataset:Pipeline_Analysis --target-org storm-org --no-prompt
# dashboards:
sf project delete source --metadata WaveDashboard:Vacant_Units_Overview --metadata WaveDashboard:Pipeline_Overview --target-org storm-org --no-prompt
```
> **Keep** the `CRMA_Apartment_FLS` permission set — it's the real fix, not demo
> clutter. (If you re-run Story A on a fresh org, the agent's grant-field-access
> re-creates the equivalent.)

---

## What each step proves (for the Q&A)

| Step | Capability shown |
|---|---|
| A1 / B1 explore | Live org connection; reads real schema |
| A2 / B1 create | Authors valid R3; correct Wave REST write path |
| A3 FLS heal | Agent understands platform security, self-diagnoses + fixes |
| A4 / B3 questions | SAQL data Q&A |
| A5 / B4 edit+debug | Surgical edits, validation-driven debug loop |
| A6 / B5 dashboard | Dashboard authoring + metadata deploy; end-to-end |
| Safety gate | Human-in-the-loop approval before any write |
