# Template dashboard exemplars — MIRROR THE SHAPES, do not deploy as-is

> Concepts / search keywords: dashboard example multi step type, aggregateflex saql staticflex grain
> together, flatgauge funnel treemap stackvbar combo widget example, mixed visualization dashboard,
> real deployed dashboard layout to mirror, template dashboard.

⛔ **TEMPLATE — these are extracted from the official Salesforce Sales Analytics WaveTemplate.**
They are full of `${App.Datasets…}`, `${Variables…}` tokens and are **NOT copy-paste deployable**.
Use them to see how a rich, real dashboard mixes step types and visualization types — then build
fresh for the user's prompt/dataset. Substitute every `${…}` token before any deploy. (See the
add-a-doc rules in `../../../HOW_RAG_WORKS.md`.)

**Why these two:** together they prove the "don't go one way" principle — a correct dashboard mixes
step types and viz types by need, not by habit. Great reference when a user asks for something a
single step/viz type can't cover.

## Sales_Performance.template.json
- **Step types mixed:** `aggregateflex` (8) + `grain` (1, raw rows) + `staticflex` (1, a toggle).
- **Viz types:** `flatgauge`, `vbar`, `hbar`, `stackvbar`, plus a **dynamic viz** driven by a
  dropdown (`{{cell(dropdown_product_level_group.selection,0,"visual").asString()}}` as the
  visualizationType — the chart type itself is bound to a selector step).
- Learn from it: how a `grain` step (record list) and a `staticflex` toggle coexist with standard
  aggregateflex charts on one page; how to bind a widget's viz type to a dropdown.

## Quota_Progress.template.json
- **saql-heavy on purpose:** `saql` (7) + `aggregateflex` (10) + `staticflex` (2) — a real case
  where a lot of the logic needs saql (quota attainment / progress math) alongside simple aggregates.
- **Viz types:** `funnel`, `hbar`, `flatgauge`, `time` (time-series).
- Learn from it: when saql earns its place (see `../../../STEP_TYPE_DECISION.md`), and how funnel /
  time / gauge widgets are wired.

## How to use them
1. Open with `read-reference "Org examples/dashboards/template-exemplars/<file>"`.
2. Find a widget/step whose *shape* matches what you're building.
3. Copy the shape, swap tokens for the user's real dataset/fields, wire per `DASHBOARD_PATTERNS.md`.
4. Never deploy the template file itself.
