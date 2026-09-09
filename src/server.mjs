// server.mjs — browser chat UI for the CRMA Copilot.
// ---------------------------------------------------------------------------
// Zero extra npm dependencies (Node core http only). Serves a chat page at
//   http://localhost:4111  and a POST /chat endpoint that runs the same
// `copilot` agent used by the terminal runner.
//
// Browser UI features:
//   - Markdown rendering via marked.js (CDN)
//   - Live Chart.js dashboard previews rendered from <chart-preview> blocks
//     the agent outputs alongside the ASCII mockup.
//   - <chart-preview> blocks are parsed client-side — Mastra Studio and
//     terminal runners show the ASCII mockup; this UI shows real charts.
// ---------------------------------------------------------------------------

import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copilot } from "./mastra/agents/copilot.mjs";
import { ACTIVE_PROVIDER } from "./mastra/models.mjs";
import { TARGET_ORG, DRY_RUN } from "./mastra/sf.mjs";

const PORT = Number(process.env.UI_PORT || 4111);
const HERE = dirname(fileURLToPath(import.meta.url));

// ── Session persistence ────────────────────────────────────────────────────
// Messages are saved to disk on every turn so a server restart (ctrl+c,
// gateway 503, crash) does NOT lose conversation history. On startup the
// prior session is restored automatically.
const HISTORY_FILE = join(HERE, "..", "session-history.json");
const LEDGER_FILE  = join(HERE, "..", "components-built.json");  // durable "what was built" checklist
const THREAD_ID    = "crma-copilot-main";   // fixed thread — Mastra memory key

// --- Components-built ledger ------------------------------------------------
// A durable, machine-readable record of assets the agent has DEPLOYED/CREATED,
// separate from the chat transcript. A resumed session reads this to know what
// SHOULD exist in the org, then re-verifies each against the live org (assets
// can be deleted between sessions). Auto-captured from successful deploy/create
// tool results — does not depend on the agent remembering to log anything.
function loadLedger() {
  try {
    if (existsSync(LEDGER_FILE)) {
      const l = JSON.parse(readFileSync(LEDGER_FILE, "utf8"));
      if (Array.isArray(l)) return l;
    }
  } catch { /* corrupt — start fresh */ }
  return [];
}
function saveLedger(l) {
  try { writeFileSync(LEDGER_FILE, JSON.stringify(l, null, 2)); } catch { /* non-fatal */ }
}
const ledger = loadLedger();   // [{ type, name, tool, at }]
let resumeReminderInjected = false;   // inject the "verify org" reminder once per process

// Record an asset build when a deploy/create/run tool succeeds. Deduped by type+name.
function recordBuild(toolName, args, resultText) {
  const t = String(toolName).toLowerCase();
  const isBuild = /deploy|create|run/.test(t) && /recipe|dashboard/.test(t);
  if (!isBuild) return;
  // Only record on apparent success (tool result not an obvious error)
  if (/error|fail|"success"\s*:\s*false/i.test(String(resultText || ""))) return;
  const name = args?.name || args?.recipeName || args?.dashboardName || args?.fullName || args?.label;
  if (!name) return;
  const type = /dashboard/.test(t) ? "dashboard" : "recipe";
  const existing = ledger.find((e) => e.type === type && e.name === name);
  const entry = { type, name, tool: toolName, at: new Date().toISOString() };
  if (existing) Object.assign(existing, entry); else ledger.push(entry);
  saveLedger(ledger);
}

function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      const saved = JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
      if (Array.isArray(saved) && saved.length > 0) {
        console.log(`  Restored ${saved.length} messages from previous session.`);
        return saved;
      }
    }
  } catch { /* corrupt file — start fresh */ }
  return [];
}

function saveHistory(msgs) {
  try { writeFileSync(HISTORY_FILE, JSON.stringify(msgs, null, 2)); } catch { /* non-fatal */ }
}

// One shared conversation (single-user local demo tool).
// Pre-loaded from disk so restarts resume the prior session.
const messages = loadHistory();

// Graceful shutdown — flush history on ctrl+c or SIGTERM so nothing is lost
function shutdown(signal) {
  console.log(`\n  ${signal} — saving session history…`);
  saveHistory(messages);
  process.exit(0);
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Live activity tracker — pollable via GET /status ──────────────────────
const activity = {
  busy: false,
  step: 0,
  currentTool: null,
  toolHistory: [],   // last 20 tool calls: { tool, input, startedAt, durationMs }
  startedAt: null,
  elapsedMs: () => activity.startedAt ? Date.now() - activity.startedAt : 0,
};

function toolStart(toolName, inputSummary) {
  activity.currentTool = { tool: toolName, input: inputSummary, startedAt: Date.now() };
  activity.step += 1;
}

function toolEnd(toolName, durationMs) {
  if (activity.toolHistory.length >= 20) activity.toolHistory.shift();
  activity.toolHistory.push({ tool: toolName, durationMs, at: new Date().toISOString() });
  activity.currentTool = null;
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CRMA Copilot</title>
<style>
  :root {
    --bg:#0b1220; --panel:#111a2e; --user:#1f6feb; --bot:#1b2740;
    --line:#243352; --text:#e6edf7; --muted:#8fa3c4;
    --blue:#58a6ff; --green:#7ee2a8; --red:#ff9aa8;
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); }

  /* ── header ─────────────────────────────────────────────────────────── */
  header { padding:12px 18px; background:var(--panel); border-bottom:1px solid var(--line); display:flex; gap:16px; align-items:center; }
  header h1 { font-size:15px; margin:0; }
  header .tag { font-size:12px; color:var(--muted); }
  header .tag b { color:var(--text); }
  header .deploy { margin-left:auto; font-size:12px; padding:3px 10px; border-radius:12px; }
  .safe { background:#123d24; color:var(--green); }
  .live { background:#5a1620; color:var(--red); }

  /* ── chat log ────────────────────────────────────────────────────────── */
  #log { max-width:960px; margin:0 auto; padding:20px 16px 140px; }
  .msg { margin:12px 0; display:flex; }
  .msg.user { justify-content:flex-end; }
  .bubble { max-width:85%; padding:10px 14px; border-radius:12px; word-wrap:break-word; }
  .user .bubble { background:var(--user); color:#fff; border-bottom-right-radius:3px; }
  .bot  .bubble { background:var(--bot); border:1px solid var(--line); border-bottom-left-radius:3px; }

  /* markdown inside bot bubble */
  .bot .bubble table { border-collapse:collapse; margin:8px 0; font-size:13px; width:100%; }
  .bot .bubble th, .bot .bubble td { border:1px solid var(--line); padding:5px 9px; text-align:left; }
  .bot .bubble th { background:#22304e; }
  .bot .bubble code { background:#0c1526; padding:1px 5px; border-radius:4px; font-size:12px; }
  .bot .bubble pre { background:#0c1526; padding:10px; border-radius:8px; overflow:auto; font-size:12px; }
  .bot .bubble p { margin:6px 0; }
  .bot .bubble ul, .bot .bubble ol { margin:4px 0; padding-left:20px; }

  .thinking { color:var(--muted); font-style:italic; display:flex; align-items:center; gap:10px; }
  .thinking-spinner { width:14px; height:14px; border:2px solid var(--line); border-top-color:var(--blue); border-radius:50%; animation:spin .8s linear infinite; flex-shrink:0; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .thinking-steps { display:flex; flex-direction:column; gap:3px; font-size:12px; }
  .thinking-step  { color:var(--muted); transition:color .3s; }
  .thinking-step.active { color:var(--blue); }
  .thinking-step.done   { color:var(--green); }

  /* ── live tool activity bar ──────────────────────────────────────────── */
  #tool-bar {
    position:fixed; top:0; left:0; right:0; z-index:100;
    background:#0a1628; border-bottom:1px solid var(--line);
    padding:5px 16px; font-size:11px; display:none;
    align-items:center; gap:10px;
  }
  #tool-bar.active { display:flex; }
  #tool-bar .tb-spinner { width:10px; height:10px; border:2px solid var(--line); border-top-color:var(--blue); border-radius:50%; animation:spin .8s linear infinite; flex-shrink:0; }
  #tool-bar .tb-tool { color:var(--blue); font-weight:600; }
  #tool-bar .tb-input { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:60vw; }
  #tool-bar .tb-step { margin-left:auto; color:var(--muted); flex-shrink:0; }
  #tool-bar .tb-elapsed { color:var(--muted); flex-shrink:0; }

  /* ── tool history panel (shown while agent runs) ─────────────────────── */
  #tool-log {
    position:fixed; right:0; top:0; bottom:0; width:280px; z-index:99;
    background:#0a1628; border-left:1px solid var(--line);
    padding:42px 0 10px; overflow-y:auto; display:none; flex-direction:column;
  }
  #tool-log.active { display:flex; }
  #tool-log .tl-header { font-size:11px; color:var(--muted); padding:6px 12px; border-bottom:1px solid var(--line); margin-bottom:4px; letter-spacing:.5px; text-transform:uppercase; }
  #tool-log .tl-item { padding:5px 12px; border-bottom:1px solid #111e33; font-size:11px; }
  #tool-log .tl-item .tl-name { color:var(--green); font-weight:600; }
  #tool-log .tl-item .tl-dur  { color:var(--muted); font-size:10px; }
  #tool-log .tl-item .tl-inp  { color:var(--muted); font-size:10px; word-break:break-all; margin-top:2px; max-height:36px; overflow:hidden; }

  /* ── dashboard preview widget ────────────────────────────────────────── */
  .dp-preview {
    background:#0f1b2e; border:1px solid #1e3a5f; border-radius:10px;
    padding:16px 18px; margin:14px 0;
  }
  .dp-header {
    font-size:15px; font-weight:700; color:var(--text);
    text-align:center; margin-bottom:16px; letter-spacing:.3px;
  }
  .dp-grid { display:flex; flex-wrap:wrap; gap:12px; }
  .dp-widget {
    flex:1; min-width:220px; background:#111a2e;
    border:1px solid #1e3a5f; border-radius:8px; padding:14px;
  }
  .dp-widget-title {
    font-size:11px; color:var(--muted); margin-bottom:10px;
    text-transform:uppercase; letter-spacing:.6px;
  }
  .dp-number .dp-metric {
    font-size:40px; font-weight:700; color:var(--blue);
    text-align:center; padding:12px 0 4px; white-space:nowrap;
  }
  .dp-number .dp-sublabel { font-size:12px; color:var(--muted); text-align:center; }
  .dp-chart .dp-echart { width:100%; height:220px; }
  .dp-wide { flex-basis:100%; }
  /* table widget */
  .dp-tbl { width:100%; border-collapse:collapse; font-size:12px; }
  .dp-tbl th { text-align:left; color:#9fb4d6; font-weight:600; padding:6px 10px;
    border-bottom:1px solid #24406a; white-space:nowrap; }
  .dp-tbl td { padding:6px 10px; color:var(--muted); border-bottom:1px solid #16233b; }
  /* filter (listselector) widget */
  .dp-filter { display:flex; flex-direction:column; gap:6px; justify-content:center; min-width:160px; }
  .dp-filter-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; }
  .dp-select { background:#0c1526; color:#cfe0ff; border:1px solid #24406a; border-radius:6px;
    padding:7px 9px; font-size:13px; }
  /* text + placeholder */
  .dp-text { display:flex; align-items:center; justify-content:center; overflow:auto; }
  .dp-text-body { font-size:14px; font-weight:600; color:var(--text); text-align:center;
    line-height:1.4; white-space:pre-wrap; word-break:break-word; max-height:100%; }
  .dp-placeholder-note { font-size:12px; color:var(--muted); font-style:italic; }

  /* ── footer / composer ───────────────────────────────────────────────── */
  footer { position:fixed; bottom:0; left:0; right:0; background:var(--panel); border-top:1px solid var(--line); padding:12px; }
  .composer { max-width:960px; margin:0 auto; display:flex; gap:8px; }
  textarea { flex:1; background:#0c1526; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:10px; resize:none; min-height:46px; max-height:160px; font:inherit; }
  button { background:var(--user); color:#fff; border:0; border-radius:8px; padding:0 20px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
</style>
</head>
<body>
<!-- live tool activity bar (fixed top, hidden until agent runs) -->
<div id="tool-bar">
  <div class="tb-spinner"></div>
  <span class="tb-tool" id="tb-tool">—</span>
  <span class="tb-input" id="tb-input"></span>
  <span class="tb-elapsed" id="tb-elapsed"></span>
  <span class="tb-step" id="tb-step"></span>
</div>
<!-- tool history sidebar -->
<div id="tool-log">
  <div class="tl-header">Tool calls this turn</div>
  <div id="tl-items"></div>
</div>
<header>
  <h1>CRMA Copilot</h1>
  <span class="tag">provider <b id="prov">—</b> · org <b id="org">—</b></span>
  <span class="deploy" id="deploy">—</span>
</header>
<div id="log"></div>
<footer><div class="composer">
  <textarea id="in" placeholder="Ask me to get / explain / edit / debug / create / deploy a recipe or dashboard…"></textarea>
  <button id="send">Send</button>
</div></footer>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<script>
// ── ECharts renders the full CRMA chart vocabulary (bar/line/combo/donut/
//    scatter/funnel/waterfall/heatmap) natively. Tables, KPI tiles and filter
//    dropdowns are plain HTML — no chart library draws those. ─────────────────
const PALETTE = ['#1f6feb','#388bfd','#58a6ff','#79c0ff','#a5d6ff','#cae8ff','#7ee2a8','#ffa657','#ff9aa8'];
const AXIS_STYLE   = { axisLine:{lineStyle:{color:'#1e2d47'}}, axisLabel:{color:'#8fa3c4'}, splitLine:{lineStyle:{color:'#1e2d47'}} };
const ECHART_TEXT  = { color:'#8fa3c4', fontFamily:'-apple-system, Segoe UI, Roboto, sans-serif', fontSize:12 };
const TOOLTIP      = { backgroundColor:'#111a2e', borderColor:'#243352', textStyle:{color:'#cfe0ff'} };

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Build HTML for a single widget ────────────────────────────────────
// Chart widgets get a <div data-echart> that initEcharts() turns into a live
// ECharts instance. Non-chart widgets (number/table/filter/text) are pure HTML.
const CHART_TYPES = ['hbar','vbar','bar','line','combo','donut','pie','scatter','funnel','waterfall','pyramid','heatmap','stackhbar','stackvbar','stackline'];

function buildWidget(w, idx) {
  const id = 'dp-echart-' + idx;

  if (w.type === 'number') {
    const val = typeof w.value === 'number' ? w.value.toLocaleString()
              : (w.value == null ? '—' : String(w.value));
    return \`<div class="dp-widget dp-number">
      <div class="dp-widget-title">\${esc(w.title)}</div>
      <div class="dp-metric">\${esc(val)}</div>
      \${w.sublabel ? \`<div class="dp-sublabel">\${esc(w.sublabel)}</div>\` : ''}
    </div>\`;
  }

  if (w.type === 'table') {
    const cols = (w.columns && w.columns.length) ? w.columns : ['Column 1','Column 2','Column 3'];
    const head = cols.map(c => \`<th>\${esc(c)}</th>\`).join('');
    // 3 placeholder rows so it reads as a table (raw preview — values are sample)
    const rows = [0,1,2].map(() =>
      \`<tr>\${cols.map(() => '<td>—</td>').join('')}</tr>\`
    ).join('');
    return \`<div class="dp-widget dp-table dp-wide">
      <div class="dp-widget-title">\${esc(w.title)}</div>
      <table class="dp-tbl"><thead><tr>\${head}</tr></thead><tbody>\${rows}</tbody></table>
    </div>\`;
  }

  if (w.type === 'filter') {
    return \`<div class="dp-widget dp-filter">
      <div class="dp-filter-label">\${esc(w.field || w.title || 'Filter')}</div>
      <select class="dp-select"><option>All</option></select>
    </div>\`;
  }

  if (w.type === 'text') {
    return \`<div class="dp-widget dp-text">
      <div class="dp-text-body">\${esc(w.text || w.title || '')}</div>
    </div>\`;
  }

  if (CHART_TYPES.includes(w.type)) {
    return \`<div class="dp-widget dp-chart">
      <div class="dp-widget-title">\${esc(w.title)}</div>
      <div id="\${id}" class="dp-echart" data-echart="\${esc(JSON.stringify(w))}"></div>
    </div>\`;
  }

  // unknown/placeholder — never dropped, shown as a labeled box
  return \`<div class="dp-widget dp-placeholder">
    <div class="dp-widget-title">\${esc(w.title || w.kind || w.type)}</div>
    <div class="dp-placeholder-note">\${esc(w.kind || w.type || 'widget')}</div>
  </div>\`;
}

// ── Build an ECharts option object for one chart widget ────────────────
function echartOption(w) {
  const labels = w.labels || [];
  const values = w.values || [];
  const base = { textStyle: ECHART_TEXT, tooltip: { ...TOOLTIP, trigger:'item' },
                 grid: { left:8, right:16, top:16, bottom:8, containLabel:true } };

  if (w.type === 'hbar' || w.type === 'vbar' || w.type === 'bar') {
    const horiz = w.type === 'hbar';
    const cat = { type:'category', data: labels, ...AXIS_STYLE };
    const val = { type:'value', ...AXIS_STYLE };
    return { ...base, tooltip:{ ...TOOLTIP, trigger:'axis' },
      xAxis: horiz ? val : cat, yAxis: horiz ? { ...cat, inverse:true } : val,
      series:[{ type:'bar', data:values, itemStyle:{ color:PALETTE[1], borderRadius: horiz?[0,4,4,0]:[4,4,0,0] }, barMaxWidth:26 }] };
  }

  if (w.type === 'line') {
    return { ...base, tooltip:{ ...TOOLTIP, trigger:'axis' },
      xAxis:{ type:'category', data:labels, boundaryGap:false, ...AXIS_STYLE },
      yAxis:{ type:'value', ...AXIS_STYLE },
      series:[{ type:'line', data:values, smooth:true, symbolSize:6,
        lineStyle:{ color:PALETTE[2], width:2 }, itemStyle:{ color:PALETTE[2] },
        areaStyle:{ color:'rgba(88,166,255,0.12)' } }] };
  }

  if (w.type === 'stackhbar' || w.type === 'stackvbar' || w.type === 'stackline') {
    const horiz = w.type === 'stackhbar';
    const isLine = w.type === 'stackline';
    const seriesIn = (w.series && w.series.length) ? w.series
      : [{ name:'Series A', values }, { name:'Series B', values: values.map(v=>Math.round(v*0.6)) }];
    const cat = { type:'category', data: labels, ...AXIS_STYLE };
    const val = { type:'value', ...AXIS_STYLE };
    const series = seriesIn.map((s, i) => ({
      name: s.name, type: isLine ? 'line' : 'bar', stack: 'total',
      data: s.values,
      ...(isLine ? { smooth:true, areaStyle:{ opacity:0.25 }, lineStyle:{ color:PALETTE[i%PALETTE.length] } } : { barMaxWidth:30 }),
      itemStyle:{ color: PALETTE[i % PALETTE.length] },
    }));
    return { ...base, grid:{ left:8, right:16, top:12, bottom:28, containLabel:true },
      tooltip:{ ...TOOLTIP, trigger:'axis' },
      legend:{ type:'scroll', bottom:0, textStyle:{ color:'#8fa3c4', fontSize:11 },
        itemWidth:12, itemHeight:8, icon:'roundRect' },
      xAxis: (horiz && !isLine) ? val : cat,
      yAxis: (horiz && !isLine) ? { ...cat, inverse:true } : val,
      series };
  }

  if (w.type === 'combo') {
    // bars + a line on a SECOND y-axis (per the official ECharts combo example) —
    // bar and line scales usually differ, so a shared axis flattens the line.
    const lineVals = values.map((v,i,a) => Math.round((v + (a[i-1]||v)) / 2));
    return { ...base, grid:{ left:8, right:16, top:12, bottom:28, containLabel:true },
      tooltip:{ ...TOOLTIP, trigger:'axis' },
      legend:{ type:'scroll', bottom:0, textStyle:{ color:'#8fa3c4', fontSize:11 },
        itemWidth:12, itemHeight:8, icon:'roundRect' },
      xAxis:{ type:'category', data:labels, ...AXIS_STYLE },
      yAxis:[
        { type:'value', ...AXIS_STYLE },
        { type:'value', ...AXIS_STYLE, splitLine:{ show:false } }
      ],
      series:[
        { name:'Value', type:'bar', yAxisIndex:0, data:values, itemStyle:{ color:PALETTE[1], borderRadius:[4,4,0,0] }, barMaxWidth:26 },
        { name:'Trend', type:'line', yAxisIndex:1, data:lineVals, smooth:true, lineStyle:{ color:PALETTE[7], width:2 }, itemStyle:{ color:PALETTE[7] } }
      ] };
  }

  if (w.type === 'donut' || w.type === 'pie') {
    const data = labels.map((l,i) => ({ name:l, value: values[i] ?? 0 }));
    // Pie sits in the LEFT ~66% (center 33%, radius 66% → right edge ≈ 66%);
    // the scrollable legend owns the RIGHT ~32%, so the two never overlap even
    // with many/long slice names (names ellipsized, full text in the tooltip).
    return { ...base, tooltip:{ ...TOOLTIP, trigger:'item', formatter:'{b}: {c} ({d}%)' },
      legend:{ type:'scroll', orient:'vertical', right:6, top:'middle',
        textStyle:{ color:'#8fa3c4', fontSize:11 }, itemWidth:10, itemHeight:10, icon:'circle',
        pageIconColor:'#8fa3c4', pageTextStyle:{ color:'#8fa3c4' },
        formatter:(name)=> (name && name.length>14) ? name.slice(0,13)+'…' : name },
      color: PALETTE,
      series:[{ type:'pie', radius: w.type==='donut' ? ['42%','66%'] : '66%',
        center:['33%','52%'], data, label:{ show:false },
        emphasis:{ label:{ show:true, fontSize:12, color:'#cfe0ff' } } }] };
  }

  if (w.type === 'scatter') {
    return { ...base, tooltip:{ ...TOOLTIP, trigger:'item' },
      xAxis:{ type:'value', ...AXIS_STYLE }, yAxis:{ type:'value', ...AXIS_STYLE },
      series:[{ type:'scatter', data: w.points || [], symbolSize:12, itemStyle:{ color:PALETTE[2], opacity:0.75 } }] };
  }

  if (w.type === 'funnel' || w.type === 'pyramid') {
    const data = labels.map((l,i) => ({ name:l, value: values[i] ?? 0 }));
    return { ...base, tooltip:{ ...TOOLTIP, trigger:'item' }, color:PALETTE,
      series:[{ type:'funnel', sort: w.type==='pyramid' ? 'ascending' : 'descending',
        top:10, bottom:10, left:'8%', right:'8%', data,
        label:{ color:'#cfe0ff', fontSize:11 } }] };
  }

  if (w.type === 'waterfall') {
    // ECharts waterfall recipe: an invisible "base" stack + the visible delta.
    let running = 0;
    const bases = [], deltas = [];
    values.forEach(v => { bases.push(running); deltas.push(v); running += v; });
    return { ...base, tooltip:{ ...TOOLTIP, trigger:'axis' },
      xAxis:{ type:'category', data:labels, ...AXIS_STYLE }, yAxis:{ type:'value', ...AXIS_STYLE },
      series:[
        { type:'bar', stack:'wf', itemStyle:{ color:'transparent' }, data:bases, silent:true },
        { type:'bar', stack:'wf', itemStyle:{ color:PALETTE[1], borderRadius:[3,3,0,0] }, data:deltas, barMaxWidth:30 }
      ] };
  }

  if (w.type === 'heatmap') {
    const xCats = w.xCats || ['X1','X2','X3'];
    const yCats = w.yCats || ['Y1','Y2','Y3'];
    const data = [];
    let maxV = 1;
    for (let y=0; y<yCats.length; y++) for (let x=0; x<xCats.length; x++) {
      const v = ((x*7 + y*13 + 11) % 20) + 1;  // deterministic sample
      data.push([x, y, v]); if (v>maxV) maxV=v;
    }
    return { textStyle: ECHART_TEXT, tooltip:{ ...TOOLTIP, position:'top' },
      grid:{ left:8, right:16, top:16, bottom:24, containLabel:true },
      xAxis:{ type:'category', data:xCats, ...AXIS_STYLE, splitArea:{ show:true } },
      yAxis:{ type:'category', data:yCats, ...AXIS_STYLE, splitArea:{ show:true } },
      visualMap:{ min:0, max:maxV, calculable:false, show:false,
        inRange:{ color:['#0f1b2e','#1f6feb','#79c0ff'] } },
      series:[{ type:'heatmap', data, label:{ show:false },
        emphasis:{ itemStyle:{ shadowBlur:10, shadowColor:'rgba(0,0,0,0.5)' } } }] };
  }

  return null;
}

// ── Initialise ECharts on all [data-echart] inside a container ─────────
function initCharts(container) {
  container.querySelectorAll('[data-echart]').forEach(el => {
    let w;
    // getAttribute returns the already HTML-decoded value, so JSON.parse works directly.
    try { w = JSON.parse(el.getAttribute('data-echart')); }
    catch(e){ return; }
    const opt = echartOption(w);
    if (!opt) return;
    const chart = window.echarts.init(el, null, { renderer:'canvas' });
    chart.setOption(opt);
    // keep responsive within the chat bubble
    new ResizeObserver(() => chart.resize()).observe(el);
  });
}

// ── Parse a <chart-preview> block and return a DOM element ─────────────
function renderChartPreview(rawJson) {
  const wrapper = document.createElement('div');
  try {
    const config = JSON.parse(rawJson.trim());
    const widgetsHTML = (config.widgets || []).map((w, i) => buildWidget(w, i)).join('');
    wrapper.innerHTML = \`<div class="dp-preview">
      <div class="dp-header">\${esc(config.title || 'Dashboard Preview')}</div>
      <div class="dp-grid">\${widgetsHTML}</div>
    </div>\`;
    // Defer chart init until element is in DOM
    requestAnimationFrame(() => initCharts(wrapper));
  } catch(e) {
    wrapper.innerHTML = \`<pre style="color:var(--red)">⚠ chart-preview parse error: \${esc(e.message)}\\n\${esc(rawJson)}</pre>\`;
  }
  return wrapper;
}

// ── Add a message bubble to the log ────────────────────────────────────
const log = document.getElementById('log');
function add(role, text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const b = document.createElement('div');
  b.className = 'bubble';

  if (role === 'bot') {
    // Split on <chart-preview>...</chart-preview> blocks
    const parts = text.split(/(<chart-preview>[\\s\\S]*?<\\/chart-preview>)/g);
    parts.forEach(part => {
      const match = part.match(/^<chart-preview>([\\s\\S]*?)<\\/chart-preview>$/);
      if (match) {
        b.appendChild(renderChartPreview(match[1]));
      } else if (part.trim()) {
        const md = document.createElement('div');
        md.innerHTML = window.marked ? marked.parse(part) : part.replace(/\\n/g,'<br>');
        b.appendChild(md);
      }
    });
  } else {
    b.textContent = text;
  }

  wrap.appendChild(b);
  log.appendChild(wrap);
  window.scrollTo(0, document.body.scrollHeight);
  return b;
}

// ── Live tool activity bar ─────────────────────────────────────────────
const toolBar    = document.getElementById('tool-bar');
const toolLog    = document.getElementById('tool-log');
const tlItems    = document.getElementById('tl-items');
const tbTool     = document.getElementById('tb-tool');
const tbInput    = document.getElementById('tb-input');
const tbElapsed  = document.getElementById('tb-elapsed');
const tbStep     = document.getElementById('tb-step');
let   elapsedTimer = null;
let   agentStartMs = 0;

function startActivityUI() {
  agentStartMs = Date.now();
  tlItems.innerHTML = '';
  toolBar.classList.add('active');
  toolLog.classList.add('active');
  elapsedTimer = setInterval(() => {
    const s = ((Date.now() - agentStartMs) / 1000).toFixed(0);
    tbElapsed.textContent = s + 's';
  }, 500);
}

function stopActivityUI() {
  clearInterval(elapsedTimer);
  toolBar.classList.remove('active');
  toolLog.classList.remove('active');
  tbTool.textContent = '—';
  tbInput.textContent = '';
  tbStep.textContent = '';
}

function onToolCall(toolName, inputSummary, step) {
  tbTool.textContent  = toolName;
  tbInput.textContent = inputSummary;
  tbStep.textContent  = 'step ' + step;
}

function onToolDone(toolName, durationMs) {
  // Add to sidebar history
  const item = document.createElement('div');
  item.className = 'tl-item';
  item.innerHTML = \`<div class="tl-name">\${esc(toolName)}</div>
    <div class="tl-dur">\${(durationMs/1000).toFixed(1)}s</div>\`;
  tlItems.prepend(item);  // newest at top
  // Clear the active bar tool name
  tbTool.textContent = 'thinking…';
  tbInput.textContent = '';
}

// ── Header meta ────────────────────────────────────────────────────────
const input = document.getElementById('in');
const send  = document.getElementById('send');

fetch('/meta').then(r => r.json()).then(m => {
  document.getElementById('prov').textContent = m.provider;
  document.getElementById('org').textContent  = m.org || '—';
  const d = document.getElementById('deploy');
  d.textContent = m.dryRun ? 'DEPLOY: DRY-RUN (safe)' : 'DEPLOY: LIVE WRITE';
  d.className   = 'deploy ' + (m.dryRun ? 'safe' : 'live');
});

// ── Thinking indicator with cycling progress steps ────────────────────
const STEPS_GENERIC   = ['Connecting to Salesforce…','Calling tools…','Generating response…'];
const STEPS_DASHBOARD = ['Querying dataset fields…','Fetching real data…','Rendering preview…','Finalising…'];
const STEPS_RECIPE    = ['Reading recipe definition…','Running validation…','Analysing results…'];
const STEPS_DEBUG     = ['Fetching asset definition…','Running diagnostics…','Consulting error catalog…','Building fix plan…'];

function pickSteps(q) {
  const lc = q.toLowerCase();
  if (/dashboard|preview|widget|chart|tile/.test(lc)) return STEPS_DASHBOARD;
  if (/recipe|dataflow|node|transform/.test(lc))      return STEPS_RECIPE;
  if (/debug|diagnos|error|broken|fix/.test(lc))      return STEPS_DEBUG;
  return STEPS_GENERIC;
}

function showThinking(q) {
  const steps = pickSteps(q);
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const b = document.createElement('div');
  b.className = 'bubble thinking';
  b.innerHTML = \`<div class="thinking-spinner"></div>
    <div class="thinking-steps">\${steps.map((s,i) =>
      \`<div class="thinking-step\${i===0?' active':''}" data-i="\${i}">\${esc(s)}</div>\`
    ).join('')}</div>\`;
  wrap.appendChild(b);
  log.appendChild(wrap);
  window.scrollTo(0, document.body.scrollHeight);

  let cur = 0;
  const interval = setInterval(() => {
    const els = b.querySelectorAll('.thinking-step');
    if (cur < els.length) {
      els[cur].classList.remove('active');
      els[cur].classList.add('done');
    }
    cur++;
    if (cur < els.length) {
      els[cur].classList.add('active');
    }
    if (cur >= els.length) clearInterval(interval);
  }, 4000);

  return { el: wrap, stop: () => clearInterval(interval) };
}

// ── Submit handler ─────────────────────────────────────────────────────
async function submit() {
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  add('user', q);
  send.disabled = true;
  startActivityUI();
  const indicator = showThinking(q);

  // Pre-create a bot bubble for streaming — we update its innerHTML as chunks arrive.
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  wrap.appendChild(bubble);
  log.appendChild(wrap);

  let fullText = '';

  function renderStreaming(text) {
    // During streaming show plain markdown — chart-preview blocks rendered on done.
    const safe = text.replace(/<chart-preview>[\\s\\S]*?<\\/chart-preview>/g, '*(chart preview loading…)*');
    bubble.innerHTML = window.marked ? marked.parse(safe) : safe.replace(/\\n/g,'<br>');
    window.scrollTo(0, document.body.scrollHeight);
  }

  function renderFinal(text) {
    // Full render with chart-preview blocks.
    bubble.innerHTML = '';
    const parts = text.split(/(<chart-preview>[\\s\\S]*?<\\/chart-preview>)/g);
    parts.forEach(part => {
      const match = part.match(/^<chart-preview>([\\s\\S]*?)<\\/chart-preview>$/);
      if (match) {
        bubble.appendChild(renderChartPreview(match[1]));
      } else if (part.trim()) {
        const md = document.createElement('div');
        md.innerHTML = window.marked ? marked.parse(part) : part.replace(/\\n/g,'<br>');
        bubble.appendChild(md);
      }
    });
    initCharts(bubble);
    window.scrollTo(0, document.body.scrollHeight);
  }

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: q })
    });

    indicator.stop();
    indicator.el.remove();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.error)    { bubble.innerHTML = marked.parse('⚠️ ' + evt.error); }
          else if (evt.chunk)    { fullText += evt.chunk; renderStreaming(fullText); }
          else if (evt.tool)     { onToolCall(evt.tool, evt.input || '', evt.step || 0); }
          else if (evt.toolDone) { onToolDone(evt.toolDone, evt.durationMs || 0); }
          else if (evt.done)     { renderFinal(evt.text || fullText); }
        } catch(_) {}
      }
    }
  } catch(e) {
    indicator.stop();
    indicator.el.remove();
    bubble.innerHTML = marked.parse('⚠️ ' + e.message);
  } finally {
    stopActivityUI();
  }

  send.disabled = false;
  input.focus();
}

send.onclick = submit;
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
input.focus();
</script>
</body></html>`;

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }
  if (req.method === "GET" && req.url === "/meta") {
    return json(res, 200, { provider: ACTIVE_PROVIDER, org: TARGET_ORG, dryRun: DRY_RUN });
  }
  if (req.method === "DELETE" && req.url === "/history") {
    messages.length = 0;
    saveHistory(messages);
    ledger.length = 0;
    saveLedger(ledger);
    return json(res, 200, { ok: true, message: "Session history + components ledger cleared." });
  }
  if (req.method === "GET" && req.url === "/ledger") {
    return json(res, 200, { components: ledger });
  }
  if (req.method === "GET" && req.url === "/status") {
    return json(res, 200, {
      busy: activity.busy,
      step: activity.step,
      elapsedMs: activity.elapsedMs(),
      currentTool: activity.currentTool,
      toolHistory: activity.toolHistory,
    });
  }
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body || "{}");
        if (!message) return json(res, 400, { ok: false, error: "empty message" });

        // On the FIRST turn of a resumed session that has a components ledger,
        // prepend a re-verification reminder so the agent checks the org for drift
        // before trusting remembered build state. Fires once per server process.
        let userMessage = message;
        if (!resumeReminderInjected && ledger.length > 0 && messages.length > 0) {
          const list = ledger.map((e) => `- ${e.type}: ${e.name}`).join("\n");
          userMessage =
            `[SESSION RESUMED] A prior session recorded these components as built:\n${list}\n\n` +
            `Before acting on remembered state, VERIFY each still exists in the org ` +
            `(list-recipes / list-dashboards). Report any that are missing (deleted between sessions) ` +
            `and rebuild if needed. Then address my message below.\n\n---\n\n` + message;
          resumeReminderInjected = true;
        }
        messages.push({ role: "user", content: userMessage });

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        });

        // Keep-alive heartbeat — prevents browser/proxy dropping the connection
        // during long SF CLI calls (describe-object, recipe deploy, etc.) where
        // the agent is silent for 30–120 seconds waiting for the org.
        const heartbeat = setInterval(() => {
          res.write(`: keep-alive\n\n`);
        }, 15000);

        activity.busy = true;
        activity.step = 0;
        activity.startedAt = Date.now();
        activity.toolHistory = [];
        activity.currentTool = null;

        let fullText = "";
        try {
          const stream = await copilot.stream(messages, {
            threadId:   THREAD_ID,
            resourceId: "user",
            maxSteps:   100,
            temperature: 1,
          });

          for await (const event of stream.fullStream) {
            const p = event.payload || {};

            if (event.type === "text-delta") {
              const delta = p.text ?? "";
              if (delta) {
                fullText += delta;
                res.write(`data: ${JSON.stringify({ chunk: delta })}\n\n`);
              }

            } else if (event.type === "tool-call") {
              const toolName = p.toolName || "unknown";
              const args = p.args || {};
              const inputStr = JSON.stringify(args);
              const inputSummary = inputStr.length > 200 ? inputStr.slice(0, 200) + "…" : inputStr;
              toolStart(toolName, inputSummary);
              activity.currentTool.args = args;   // stash for the matching tool-result
              res.write(`data: ${JSON.stringify({ tool: toolName, input: inputSummary, step: activity.step })}\n\n`);

            } else if (event.type === "tool-result") {
              const toolName = p.toolName || "unknown";
              const started = activity.currentTool?.startedAt;
              const callArgs = activity.currentTool?.args;
              const durationMs = started ? Date.now() - started : 0;
              // Auto-record deploy/create/run of recipes+dashboards to the durable ledger
              try { recordBuild(toolName, callArgs, JSON.stringify(p.result ?? p.output ?? "")); } catch { /* non-fatal */ }
              toolEnd(toolName, durationMs);
              res.write(`data: ${JSON.stringify({ toolDone: toolName, durationMs, step: activity.step })}\n\n`);
            }
          }
        } finally {
          clearInterval(heartbeat);
          activity.busy = false;
          activity.currentTool = null;
        }

        messages.push({ role: "assistant", content: fullText });
        saveHistory(messages);   // persist after every turn — survives restart
        res.write(`data: ${JSON.stringify({ done: true, text: fullText })}\n\n`);
        res.end();
      } catch (e) {
        activity.busy = false;
        activity.currentTool = null;
        // Still save the user message that was pushed before the error
        saveHistory(messages);
        res.write(`data: ${JSON.stringify({ error: e.message || String(e) })}\n\n`);
        res.end();
      }
    });
    return;
  }
  json(res, 404, { ok: false, error: "not found" });
});

server.headersTimeout = 0;   // disable headers timeout — streaming responses can take many minutes
server.requestTimeout  = 0;   // disable request timeout for the same reason
server.listen(PORT, () => {
  console.log("");
  console.log("  ┌───────────────────────────────────────────────┐");
  console.log("  │  CRMA Copilot — browser UI                    │");
  console.log(`  │  provider: ${ACTIVE_PROVIDER.padEnd(9)} org: ${(TARGET_ORG || "—").padEnd(16)}│`);
  console.log(`  │  deploy:   ${(DRY_RUN ? "DRY-RUN (safe)" : "LIVE WRITE").padEnd(35)}│`);
  console.log("  ├───────────────────────────────────────────────┤");
  console.log(`  │  Open  →  http://localhost:${PORT}                  │`);
  console.log("  └───────────────────────────────────────────────┘");
  console.log("");
});
