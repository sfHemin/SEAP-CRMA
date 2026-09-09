// graphTools.mjs — org-wide asset lineage graph + impact analysis (READ-ONLY).
// ---------------------------------------------------------------------------
// Phase 1 of the capability upgrade (see docs/CAPABILITY_UPGRADE_PLAN.md).
// These tools let the agent reason ACROSS every recipe/dashboard/dataset in the
// org instead of one named asset at a time:
//   - build-asset-graph : index all recipes + dashboards, emit a lineage graph
//   - find-assets       : query the graph ("recipes loading Opportunity", orphans)
//   - impact-of-change  : blast radius of changing an asset or a dataset.field
//
// SAFETY: 100% read-only. Uses only list-*/get-* REST GETs. No writes, ever.
// The graph is built by parsing the SAME definitions the other tools fetch, so
// lineage endpoints are:
//   recipe  -> inputs = load nodes (sourceObjectName | dataset name);
//              output = save/output node's dataset name
//   dashboard -> each step's datasets[].name AND SAQL `load "..."` refs
//              + fields referenced in queries / widget columnMap
// Static-resolution caveats are marked `uncertain` rather than asserted:
//   - recipe save names / dataset refs using ${...} template tokens
//   - dashboard SAQL loads that use an id/versionId ("0Fb.../0Fc...") not a name
// ---------------------------------------------------------------------------

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sfRestGet, metadataRetrieve } from "../sf.mjs";

// ---- parsing helpers ------------------------------------------------------

// Un-escape HTML entities (stored dashboard SAQL is HTML-escaped: &quot; &#39;).
function unescapeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

const isTemplateToken = (s) => typeof s === "string" && s.includes("${");
// A CRMA asset id/versionId ref looks like "0Fbhg.../0Fchg..." — not a name.
const looksLikeId = (s) => typeof s === "string" && /^0F[a-zA-Z0-9]{6,}/.test(s);

// Recipe I/O: inputs (loaded objects/datasets) + outputs (saved dataset names).
function parseRecipe(def) {
  const rd = def?.recipeDefinition || def || {};
  const nodes = rd.nodes || {};
  const inputs = [];   // { ref, kind: 'sobject'|'dataset', uncertain? }
  const outputs = [];  // { ref, uncertain? }
  for (const nd of Object.values(nodes)) {
    const p = nd?.parameters || {};
    if (nd?.action === "load") {
      const ds = p.dataset || {};
      // connectedDataset => a Salesforce object; analyticsDataset => a dataset
      const kind = ds.type === "connectedDataset" ? "sobject" : "dataset";
      const ref = ds.sourceObjectName || ds.name || ds.label;
      if (ref) inputs.push({ ref, kind });
    }
    if (nd?.action === "save" || nd?.action === "output") {
      const ds = p.dataset || {};
      const ref = ds.name || ds.label;
      if (ref) outputs.push({ ref, uncertain: isTemplateToken(ref) });
    }
  }
  return { inputs, outputs };
}

// Dashboard -> which datasets it reads, and which dataset.fields it references.
function parseDashboard(def) {
  const state = def?.state || def || {};
  const steps = state.steps || {};
  const datasets = new Map(); // name -> { uncertain }
  const fieldRefs = new Set(); // "dataset.field" when resolvable, else "field"
  const addDs = (name, uncertain = false) => {
    if (!name) return;
    if (!datasets.has(name)) datasets.set(name, { uncertain });
  };

  for (const s of Object.values(steps)) {
    // (a) explicit datasets[] array (compact/aggregateflex/grain steps)
    for (const ds of s?.datasets || []) {
      if (ds?.name) addDs(ds.name, isTemplateToken(ds.name));
    }
    // (b) SAQL string steps: q = load "DatasetName";  (HTML-escaped in storage)
    if (typeof s?.query === "string") {
      const q = unescapeHtml(s.query);
      for (const m of q.matchAll(/load\s+"([^"]+)"/g)) {
        const ref = m[1];
        addDs(ref, looksLikeId(ref) || isTemplateToken(ref));
      }
    }
    // (c) fields referenced in a compact query (measures/groups/filters)
    const cq = s?.query?.query || s?.query;
    if (cq && typeof cq === "object") {
      for (const g of cq.groups || []) if (typeof g === "string") fieldRefs.add(g);
      for (const col of cq.columns || []) {
        const f = Array.isArray(col?.field) ? col.field[1] : col?.field;
        if (typeof f === "string") fieldRefs.add(f);
      }
      for (const src of cq.sources || []) {
        for (const g of src.groups || []) if (typeof g === "string") fieldRefs.add(g);
        for (const col of src.columns || []) {
          const f = Array.isArray(col?.field) ? col.field[1] : col?.field;
          if (typeof f === "string") fieldRefs.add(f);
        }
      }
      for (const flt of cq.filters || []) {
        if (Array.isArray(flt) && typeof flt[0] === "string") fieldRefs.add(flt[0]);
      }
    }
  }
  return {
    datasets: [...datasets].map(([name, v]) => ({ name, uncertain: v.uncertain })),
    fieldRefs: [...fieldRefs],
  };
}

// ---- the graph ------------------------------------------------------------
// In-memory, per-process cache so follow-up questions reuse it (no re-fetch).
let GRAPH = null;

function emptyGraph() {
  return {
    builtAt: null, source: null,
    nodes: [],  // { id, type, name, label }
    edges: [],  // { from, to, kind, uncertain? }
    fieldIndex: {}, // "field" or "dataset.field" -> [assetId,...]
    notes: [],  // caps / uncertain-resolution notes
  };
}

const nid = (type, name) => `${type}:${name}`;

function addNode(g, type, name, label) {
  const id = nid(type, name);
  if (!g.nodes.some((n) => n.id === id)) g.nodes.push({ id, type, name, label: label || name });
  return id;
}
function addEdge(g, from, to, kind, uncertain = false) {
  if (!g.edges.some((e) => e.from === from && e.to === to && e.kind === kind)) {
    g.edges.push({ from, to, kind, ...(uncertain ? { uncertain: true } : {}) });
  }
}

/**
 * Build the org-wide graph from live recipes + dashboards.
 * fetcher: { listRecipes, getRecipe, listDashboards, getDashboard } — injectable
 * so the same builder is unit-testable OFFLINE against local sample JSON.
 */
export async function buildGraph(fetcher, { cap = 200 } = {}) {
  const g = emptyGraph();

  const recipes = await fetcher.listRecipes();
  const dashboards = await fetcher.listDashboards();
  if (recipes.length > cap) g.notes.push(`Analyzed first ${cap} of ${recipes.length} recipes (capped).`);
  if (dashboards.length > cap) g.notes.push(`Analyzed first ${cap} of ${dashboards.length} dashboards (capped).`);

  // Recipes: sobject/dataset --loads--> recipe --produces--> dataset
  for (const r of recipes.slice(0, cap)) {
    const rId = addNode(g, "recipe", r.name, r.label);
    let def;
    try { def = await fetcher.getRecipe(r.name); } catch (e) { g.notes.push(`get-recipe ${r.name} failed: ${e.message}`); continue; }
    const { inputs, outputs } = parseRecipe(def);
    for (const inp of inputs) {
      const t = inp.kind === "sobject" ? "sobject" : "dataset";
      const inId = addNode(g, t, inp.ref);
      addEdge(g, inId, rId, "loads");
    }
    for (const out of outputs) {
      const dsId = addNode(g, "dataset", out.ref);
      addEdge(g, rId, dsId, "produces", out.uncertain);
    }
  }

  // Dashboards: dataset --reads<-- dashboard; index field references
  for (const d of dashboards.slice(0, cap)) {
    const dId = addNode(g, "dashboard", d.name, d.label);
    let def;
    try { def = await fetcher.getDashboard(d.name); } catch (e) { g.notes.push(`get-dashboard ${d.name} failed: ${e.message}`); continue; }
    const { datasets, fieldRefs } = parseDashboard(def);
    for (const ds of datasets) {
      const dsId = addNode(g, "dataset", ds.name);
      addEdge(g, dsId, dId, "reads", ds.uncertain);
    }
    // field index: try to qualify by the dashboard's datasets; else bare field
    for (const f of fieldRefs) {
      const keys = datasets.length
        ? datasets.map((ds) => `${ds.name}.${f}`)
        : [f];
      for (const k of keys) (g.fieldIndex[k] ||= []).push(dId);
    }
  }

  return g;
}

// Live fetcher backed by the org's REST + metadata APIs.
const liveFetcher = {
  async listRecipes() {
    const data = await sfRestGet("/wave/recipes?pageSize=200");
    return (data.recipes || []).map((r) => ({ name: r.name, label: r.label, id: r.id }));
  },
  async listDashboards() {
    const data = await sfRestGet("/wave/dashboards?pageSize=200");
    return (data.dashboards || []).map((d) => ({ name: d.name, label: d.label, id: d.id }));
  },
  async getRecipe(name) {
    const { definition } = await metadataRetrieve("Recipe", name);
    return definition;
  },
  async getDashboard(name) {
    const { definition } = await metadataRetrieve("WaveDashboard", name);
    return definition;
  },
};

// ---- tool: build-asset-graph ----------------------------------------------
export const buildAssetGraph = createTool({
  id: "build-asset-graph",
  description:
    "Build (and cache) an ORG-WIDE lineage graph of every recipe, dashboard, and dataset. " +
    "READ-ONLY: it only lists and reads definitions, never writes. Use this FIRST when a question " +
    "spans many assets — 'which dashboards use dataset X', 'what feeds dataset Y', 'find every recipe " +
    "loading Opportunity', 'what breaks if I rename a field'. After building, use find-assets and " +
    "impact-of-change to query it. Edges: sobject/dataset --loads--> recipe --produces--> dataset " +
    "<--reads-- dashboard. Refs that can't be statically resolved (recipe ${template} tokens, dashboard " +
    "SAQL loads by id) are marked uncertain rather than asserted.",
  inputSchema: z.object({
    refresh: z.boolean().optional().describe("Rebuild even if a cached graph exists this session."),
  }),
  outputSchema: z.object({
    built: z.boolean(),
    counts: z.object({
      recipes: z.number(), dashboards: z.number(), datasets: z.number(),
      sobjects: z.number(), edges: z.number(),
    }),
    notes: z.array(z.string()),
  }),
  execute: async (context) => {
    if (!GRAPH || context?.refresh) {
      GRAPH = await buildGraph(liveFetcher);
      GRAPH.builtAt = "session"; GRAPH.source = "org";
    }
    const c = (t) => GRAPH.nodes.filter((n) => n.type === t).length;
    return {
      built: true,
      counts: {
        recipes: c("recipe"), dashboards: c("dashboard"), datasets: c("dataset"),
        sobjects: c("sobject"), edges: GRAPH.edges.length,
      },
      notes: GRAPH.notes,
    };
  },
});

// Accessor so the sibling tools (find-assets / impact-of-change, Phase 1b/1c)
// share the same cached graph.
export function _getGraph() { return GRAPH; }
export function _setGraph(g) { GRAPH = g; } // test hook

export const graphTools = { buildAssetGraph };
