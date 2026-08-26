# CRMA Copilot — Demo Runbook

From-scratch steps to demo the agent to leadership, using **Mastra Studio**.

---

## 0 · Pre-flight (once, before the audience joins)

Run each line on its own (don't paste the `#` comments):

```bash
sf org list
```
→ confirm **storm-org** shows **Connected**. (If not: `sf org login web --alias storm-org`.)

```bash
cd "/Users/hemin.kale/Desktop/CRMA Assets/CRMA Mastra"
pwd
```
→ should end with `CRMA Assets/CRMA Mastra`.

```bash
cat .env
```
→ confirm `SF_TARGET_ORG=storm-org` and `DEPLOY_DRY_RUN=true` (safe mode).

---

## 1 · Launch Mastra Studio

```bash
npm run dev
```
Wait for:
```
│ Studio: http://localhost:4111
```
Open **Chrome → http://localhost:4111**. In the left nav you'll see the agent
**crma-copilot** and, under it, its **14 tools** (list/get/edit/validate/deploy/
create for recipes + dashboards, plus queryDataset and remapDatasetIds).

> Talking point: "This is Mastra's own Studio. The agent and every tool are
> Mastra objects. Claude drives the tool calls; the tools talk to Salesforce."

---

## 2 · Demo flow (type into the Studio chat — natural language, not fixed prompts)

| # | Say this | What it proves |
|---|---|---|
| 1 | `List my recipes and dashboards.` | Live org connection; real assets returned as tables |
| 2 | `Get the segmentation recipe — I forget the exact name.` | **Claude disambiguates**: finds both, asks which |
| 3 | `The V1 one. Explain what it does as a table grouped by node type, and give the cluster count.` | Deep, accurate analysis of the real R3 definition |
| 4 | `Debug it — run a dry-run validation and explain any issues.` | Safe debugging; it catches the formula single/double-quote bug |
| 5 | `Change it to 5 clusters and validate.` | Surgical edit + re-validation, no write |
| 6 | `Deploy it.` | **Safety gate** — validates, then asks for approval; won't write (dry-run on) |
| 7 | `Get dashboard Segment_Cluster_Comparison_Base, rename chart_1's title to "Account Clusters (Exec View)", and validate.` | Same flow for dashboards |
| 8 | `How many rows are in the Clustered_Accounts dataset?` | Live SAQL query against the org |

You can improvise — e.g. *"edit the recipe to keep only the AMER region"*, or
*"create a recipe that loads Account, filters AnnualRevenue > 0, and writes a dataset."*
It fetches what it needs and asks when a detail (like which field = region) is missing.

---

## 3 · (Optional) show a real deploy

Only if you want a live write:
1. Stop Studio (`Ctrl+C`), set `DEPLOY_DRY_RUN=false` in `.env`, `npm run dev` again.
2. Re-run step 6 and approve → it deploys via the Metadata API and reports success.
3. **Turn it back to `true`** afterward.

---

## 4 · Fallbacks (if Studio misbehaves live)

- Custom browser UI: `npm run ui` → http://localhost:4111 (same agent).
- Terminal: `npm run chat`.

All three run the identical Mastra agent — only the front door differs.

---

## Key messages for leadership

- **Framework:** built on Mastra (`Agent` + `createTool` + Studio) — see `docs/MASTRA_MAPPING.md`.
- **Models:** Claude Sonnet 4.6 + Opus via the **Salesforce internal gateway** — no personal API keys.
- **Salesforce:** reuses the authed `sf` CLI; writes via the reliable Metadata API.
- **Safety:** read-before-write, surgical edits, dry-run debugging, two-key deploy gate.
