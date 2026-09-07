# Dashboard Preview System

## What it does

Before deploying any new or significantly edited dashboard, the agent renders a full visual preview
in chat — showing exactly what the dashboard will look like in Salesforce. The user sees real data,
real widget layout, and real chart bars. They correct it in chat until it looks right, then say
"deploy".

No dashboard ever touches the org until the user has approved a visual preview.

---

## How it works — end to end

```
User: "Build me a Vacant Units dashboard with a number tile and bar chart"
         │
         ▼
    Step A: Agent queries real data from the org
         │   query-dataset → total count (number tile)
         │   query-dataset → group by location, top 10 (bar chart)
         │
         ▼
    Step B: Agent outputs TWO things simultaneously
         │
         ├─► ASCII mockup (works everywhere — Studio, terminal, browser)
         │       ┌─────────────────────────────────────┐
         │       │  Total  │  Vacant Units by Location  │
         │       │   455   │  District A  ████  170     │
         │       │         │  District B  ██     35     │
         │       └─────────────────────────────────────┘
         │
         └─► <chart-preview> JSON block (browser UI only — renders real Chart.js charts)
                 {
                   "title": "Vacant Units Overview",
                   "widgets": [
                     { "type": "number", "title": "Total Vacant Units", "value": 455 },
                     { "type": "hbar",   "title": "Vacant Units by Location",
                       "labels": ["District A", "District B"],
                       "values": [170, 35] }
                   ]
                 }
         │
         ▼
    Step C: User corrects in chat ("make it a line chart", "swap positions")
         │   Agent redraws from cached data — no re-query needed
         │   Each correction emits a new ASCII mockup + new <chart-preview> block
         │
         ▼
    User: "deploy"
         │
         ▼
    validate-dashboard → deploy-dashboard (confirm=true)
```

---

## The two output formats

### Format 1 — ASCII mockup

Always output, works in every surface (Mastra Studio, terminal, browser).

Uses box-drawing characters for widget borders and `█` blocks for bar charts:

```
┌────────────────────────────────────────────────────────────┐
│                   Vacant Units Overview                    │
├───────────────────────┬────────────────────────────────────┤
│  Total Vacant Units   │  Vacant Units by Location          │
│                       │                                    │
│         455           │  Financial District  ████████  170 │
│                       │  Mississippi Ave     ██         35 │
│                       │  Alberta Arts        ██         34 │
└───────────────────────┴────────────────────────────────────┘
```

Widget type → ASCII rendering rules:

| Widget type | How it renders |
|---|---|
| `text` | Centered label in a full-width box |
| `number` | Large centered metric value in a box |
| `hbar` | One `Label  ████████  value` row per group, bars scaled to max |
| `vbar` | Vertical `█` columns, labels below |
| `line` | Sparkline using `▁▂▃▄▅▆▇█`, x-axis labels below |
| `donut`/`pie` | Legend: `● Label  42%` per slice |

### Format 2 — `<chart-preview>` JSON block

Output immediately after the ASCII mockup. The browser UI (`npm run ui`) detects this tag,
strips it from the markdown, and renders real Chart.js charts instead.

Mastra Studio and terminal see it as raw text — harmless, since the ASCII mockup above it
is the readable version there.

**Schema:**

```json
<chart-preview>
{
  "title": "<Dashboard label shown as header>",
  "widgets": [
    { "type": "number", "title": "...", "value": 123, "sublabel": "optional" },
    { "type": "hbar",   "title": "...", "labels": ["A","B"], "values": [10, 5] },
    { "type": "vbar",   "title": "...", "labels": ["A","B"], "values": [10, 5] },
    { "type": "line",   "title": "...", "labels": ["Jan","Feb"], "values": [100, 120] },
    { "type": "donut",  "title": "...", "labels": ["X","Y"], "values": [60, 40] }
  ]
}
</chart-preview>
```

Supported `type` values and their Chart.js mapping:

| type | Chart.js type | Notes |
|---|---|---|
| `number` | (not a chart — rendered as a styled tile) | `value` must be a number |
| `hbar` | `bar` with `indexAxis: "y"` | Horizontal bar |
| `vbar` or `bar` | `bar` with `indexAxis: "x"` | Vertical/column bar |
| `line` | `line` | Always shows lines; dots-only is not a CRMA option |
| `donut` or `pie` | `doughnut` | Rendered with a color legend |

Only use types that CRMA actually supports. Do not invent types CRMA cannot render.

---

## Where the rendering happens — `src/server.mjs`

The browser UI is a zero-npm-dependency Node.js HTTP server. It serves a single HTML page
that loads two CDN libraries:
- `marked.js` — converts markdown to HTML
- `Chart.js` — renders the charts

The key client-side logic in the page:

```js
// Split agent response on <chart-preview>...</chart-preview> blocks
const parts = text.split(/(<chart-preview>[\s\S]*?<\/chart-preview>)/g);

parts.forEach(part => {
  const match = part.match(/^<chart-preview>([\s\S]*?)<\/chart-preview>$/);
  if (match) {
    // Parse the JSON and render Chart.js widgets
    renderChartPreview(match[1]);
  } else {
    // Render as markdown (includes the ASCII mockup)
    renderMarkdown(part);
  }
});
```

`renderChartPreview(rawJson)` parses the JSON, builds a widget card per entry in `widgets[]`,
and calls `new Chart(canvas, config)` for each chart widget. Number tiles are plain HTML divs.
Chart.js is initialised after the element is inserted into the DOM via `requestAnimationFrame`.

Dark theme is applied globally via `Chart.defaults.color` and `Chart.defaults.borderColor`.
Bar chart bars get `borderRadius: 4`. Line charts use `tension: 0.3` for a smooth curve.

---

## The redraw loop

After the first preview is shown, the user corrects it in chat. The agent must:

1. **Layout / title / chart type change** — redraw from cached query results in context.
   No tool call. Just emit a new ASCII mockup + a new `<chart-preview>` block.

2. **New widget added** — call `query-dataset` for the new step only, then redraw both.

3. **SAQL change** (different grouping, filter) — re-run `query-dataset` for that step only,
   then redraw both.

4. **User says "deploy"** — call `validate-dashboard` → if passes, call `deploy-dashboard`
   with `confirm=true`.

The agent never re-queries the full dataset on a layout-only change. The cached numbers stay
in context and are reused each time the user asks to move, resize, or retype a widget.

---

## CRMA chart type constraints

The agent must tell the user when they ask for something CRMA does not support:

| User asks for | CRMA supports it? | What to say |
|---|---|---|
| Horizontal bar chart | Yes | `type: "hbar"` |
| Vertical / column bar | Yes | `type: "vbar"` |
| Line chart | Yes | Always shows lines — dots-only is not available |
| Donut / pie | Yes | `type: "donut"` |
| Number tile | Yes | `type: "number"` — never `type: "chart"` |
| Scatter | Yes (CRMA supports) | `type: "scatter"` |
| Heatmap / heat grid | Yes (CRMA supports) | Note in preview, no Chart.js equivalent |
| Annotations / reference lines | No | Tell user, suggest alternative |
| Dots-only line chart | No | Tell user — line always shows lines in CRMA |

---

## Why two formats instead of one

**ASCII only** — works in Studio and terminal but gives no feel for chart proportions or color.
Hard for a non-technical user to judge.

**HTML/Chart.js only** — breaks in Studio and terminal, which render plain text.

**Both** — ASCII is the universal fallback. Chart.js is the rich version for the demo UI.
The agent outputs both every time; each surface uses what it can render.

---

## Surfaces and what each shows

| Surface | How to run | ASCII mockup | Chart.js charts |
|---|---|---|---|
| Browser UI | `npm run ui` → `http://localhost:4111` | Yes (inside markdown) | Yes (rendered from `<chart-preview>`) |
| Mastra Studio | `npm run dev` → `http://localhost:4111` | Yes | No (`<chart-preview>` shown as raw text) |
| Terminal chat | `npm run chat` | Yes | No (raw text) |
| One-shot | `npm run ask -- "..."` | Yes | No (raw text) |

---

## Files involved

| File | Role |
|---|---|
| `src/mastra/agents/copilot.mjs` | Agent instructions — Step A (query), Step B (ASCII + `<chart-preview>`), Step C (redraw loop), CRMA constraints |
| `src/server.mjs` | Browser UI server — splits agent output on `<chart-preview>`, renders Chart.js, applies dark theme |

No new tools were added for this feature. It uses the existing `query-dataset` tool and relies
entirely on the agent following the instructions in `copilot.mjs` and the client-side parsing
in `server.mjs`.
