# RECIPE (R3) vs DATAFLOW (legacy) — which to build, and the legacy node dialect

> Concepts / search keywords: recipe vs dataflow, R3 recipe, legacy dataflow, workflowDefinition,
> sfdcDigest, sfdcRegister, augment, flatten, computeExpression, computeRelative, prediction node,
> dataflow node types, convert dataflow to recipe, Data Prep recipe, ETL choice CRMA.

**Build recipes (R3). This doc is mostly so you can READ/DEBUG a legacy dataflow you find in an org.**
For NEW data-prep, the answer is almost always a **recipe (R3)** — it's the current, supported,
UI-first engine, and it's what this agent should author. You will still *encounter* **legacy
dataflows** in existing orgs and templates, and part of "building and debugging" is being able to
read one, explain it, or convert it to a recipe. That's what the node-mapping table below is for —
it is reference for reading dataflows, NOT a suggestion to build new ones as dataflows.

---

## Which to build?

| Situation | Use |
|---|---|
| New dataset (the normal case) | **Recipe (R3)** — always the default for new builds. |
| Editing an org asset that is already a dataflow | **Keep it a dataflow** unless asked to migrate — don't rebuild what works. |
| Asked to "convert this dataflow to a recipe" | Map node-by-node (table below) — the *concepts* map, the *shapes* differ. |
| Just need to explain/debug a dataflow you retrieved | Read it with the table below; you don't have to rebuild it. |

> **Default = recipe.** Only touch dataflows when the org already has one. Everything below is
> for *reading* the legacy form, not for choosing it over a recipe.

Recipes and dataflows are **not** the same JSON. A recipe has `recipeDefinition.nodes` (+ `ui`);
a dataflow has `workflowDefinition` with differently-named actions. Do not paste one into the other.

---

## Legacy dataflow node dialect (what `workflowDefinition` uses)

Real actions seen in the Sales Analytics (201 nodes) + Discovery training (30 nodes) dataflows,
with counts, so you know the common ones:

| Dataflow action | Does | Recipe (R3) equivalent |
|---|---|---|
| **sfdcDigest** | Extract rows from a Salesforce object (the source/load) | `load` (connected dataset) |
| **sfdcRegister** | Publish the result as a queryable dataset (+ row-level security) | `save` (publishingTarget: DATASET) |
| **augment** | Join a "right" dataset onto a "left" by keys (lookup/enrich) | `join` (LOOKUP / LEFT_OUTER …) |
| **computeExpression** | Add derived fields via SAQL expressions | `formula` node |
| **computeRelative** | Windowed/relative fields ordered within a partition (e.g. prior value) | `computeRelative` (recipes have it too) |
| **filter** | Row filter (SAQL predicate) | `filter` |
| **flatten** | Self-referential hierarchy → path + ancestor multivalue (roles, account parent) | recipe hierarchy handling |
| **append** | Union rows from multiple sources | `append` / `appendV2` |
| **sliceDataset** | Keep/drop a set of fields | `schema` node, `slice.mode: "DROP"` |
| **edgemart** | Load an existing registered dataset as a source | `edgemart` / dataset load |
| **prediction** | Score rows with an Einstein Discovery Story (adds predicted + predictor columns) | recipe `smartDataDiscoveryPredict` |

### Recipe (R3) node names you'll also see in the sample recipes
The R3 recipes in `Org examples/Sample recipes/` (CLVRecipe, OpptyRecipe) use these actions — know
them so you recognize/mirror them (they have no distinct legacy-dataflow twin):

| Recipe action | Does | Shape note |
|---|---|---|
| **schema** | Drop / keep / rename fields | `parameters.slice: { fields:[…], mode:"DROP", ignoreMissingFields:true }` (or `fields:[]` to rename) |
| **extractGrains** | Extract date grains (year/month/day/quarter parts) from a date field | `parameters.grainExtractions:[…]`, `sources:["<prev>"]` |
| **computeRelative** | Windowed/relative field within an ordered partition (e.g. prior-row value) | recipe-native, same concept as the dataflow node |
| **appendV2** | Union rows from multiple sources | the modern recipe append |
| **smartDataDiscoveryPredict** | Score rows with a deployed Story | `predictSource.type:"PRED_DEF"` + `predictionFactorFields` (see note below) |

### Node shapes (mirror these)

**sfdcDigest** — extract with an optional server-side filter:
```json
{ "action": "sfdcDigest",
  "parameters": { "object": "Group",
    "fields": [{"name":"Id"},{"name":"Name"},{"name":"Type"}],
    "complexFilterConditions": "Type = 'Queue'" } }
```

**augment** — the legacy join (left keeps all rows, right columns selected in):
```json
{ "action": "augment",
  "parameters": { "left": "Extract_Lead", "left_key": ["Id"],
    "right": "Extract_ScoreIntelligence", "right_key": ["BaseId"],
    "right_select": ["Score"], "relationship": "Score" } }
```

**sfdcRegister** — publish + row-level security predicate:
```json
{ "action": "sfdcRegister",
  "parameters": { "name": "ForecastingItem", "alias": "<dataset alias>",
    "source": "Join_ForecastingItem_Period_User_Type",
    "rowLevelSecurityFilter": "'User.Role.Roles' == \"$User.UserRoleId\" || 'User.Id' == \"$User.Id\"" } }
```

**computeExpression** — derived field via SAQL (note `saqlExpression`, `type`, `precision/scale`):
```json
{ "action": "computeExpression",
  "parameters": { "computedFields": [{
    "name": "DaysSinceLastActivity", "label": "Days Since Last Activity",
    "type": "Numeric", "precision": 8, "scale": 0,
    "saqlExpression": "case when LastActivityDate is null then daysBetween(toDate(LastModifiedDate_sec_epoch), now()) else daysBetween(toDate(LastActivityDate_sec_epoch), now()) end" }] } }
```

**flatten** — hierarchy path + ancestors (used for role / account-parent trees):
```json
{ "action": "flatten",
  "parameters": { "source": "Add_Fields_To_Account",
    "self_field": "Id", "parent_field": "ParentId",
    "multi_field": "AccountParents", "path_field": "UltimateParentPath",
    "include_self_id": true } }
```

**prediction** — score rows with a deployed Story (legacy dataflow ML scoring):
```json
{ "action": "prediction",
  "parameters": { "source": "Drop_Fields",
    "predictionDefinitionName": "<PredictionDefinition Name>",
    "predictionColumnName": "Predicted_Revenue",
    "predictionColumnLabel": "Predicted Revenue" } }
```
(In a **recipe**, the same scoring is a `smartDataDiscoveryPredict` node with `predictSource.type: "PRED_DEF"`
— see EINSTEIN_DISCOVERY_PATTERN.md.)

---

## Gotchas
- **Dataflow date math** uses `_sec_epoch` fields (e.g. `LastActivityDate_sec_epoch`) inside `saqlExpression` —
  same rule as recipe formulas / dashboard SAQL (never `_date` / `_day_epoch` for `daysBetween`).
- **sfdcRegister is the terminal** node of a dataflow branch (like recipe `save`) — a branch with no
  register produces no dataset.
- **augment ≠ recipe join defaults**: augment is essentially a left-outer lookup; when converting,
  choose the correct recipe joinType (LOOKUP/LEFT_OUTER/INNER/…) for the relationship — don't blindly pick one.
- Recipes and dataflows have **different action names** — never mix node shapes between them.

## See also
- `CRMA_BUILD_KNOWLEDGE.md` — full R3 recipe node reference (the modern side).
- `Nodes in recipes/` — recipe node shapes.
- `Org examples/Sample recipes/SalesAnalyticsDataflow.json` — a full 201-node legacy dataflow to mirror.
- `EINSTEIN_DISCOVERY_PATTERN.md` — recipe/dataflow → Story → prediction end to end.
