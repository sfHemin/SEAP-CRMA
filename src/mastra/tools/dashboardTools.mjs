// dashboardTools.mjs — tools the agent uses to work with CRMA dashboards.
// ---------------------------------------------------------------------------
// listDashboards / getDashboard / applyDashboardEdits / validateDashboard /
// deployDashboard / createDashboardMeta / queryDataset. Dashboard state is a
// { steps, widgets, layouts, ... } object; edits use a JSON-pointer-ish path
// set, and cross-org moves can remap dataset ids by name.
// ---------------------------------------------------------------------------

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sfRestGet, sfRestPost, metadataRetrieve, metadataDeploy, getDatasetFieldMeta } from "../sf.mjs";

// ---- list -----------------------------------------------------------------
export const listDashboards = createTool({
  id: "list-dashboards",
  description: "List Analytics Studio dashboards in the target org (name + label + folder + id).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    dashboards: z.array(z.object({ name: z.string(), label: z.string().optional(), folder: z.string().optional(), id: z.string() })),
  }),
  execute: async () => {
    const data = await sfRestGet("/wave/dashboards?pageSize=200");
    return {
      dashboards: (data.dashboards || []).map((d) => ({ name: d.name, label: d.label, folder: (d.folder || {}).name, id: d.id })),
    };
  },
});

// ---- get ------------------------------------------------------------------
export const getDashboard = createTool({
  id: "get-dashboard",
  description:
    "Retrieve a dashboard's definition by metadata name. Returns the state (steps/widgets/layouts) " +
    "and -meta.xml. Use before editing, debugging, or answering questions about it.",
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({
    name: z.string(),
    stepCount: z.number(),
    widgetCount: z.number(),
    steps: z.array(z.string()),
    definition: z.any(),
    metaXml: z.string().nullable(),
  }),
  execute: async (context) => {
    const { definition, metaXml } = await metadataRetrieve("WaveDashboard", context.name);
    const steps = definition.steps || {};
    const widgets = definition.widgets || {};
    return {
      name: context.name,
      stepCount: Object.keys(steps).length,
      widgetCount: Object.keys(widgets).length,
      steps: Object.keys(steps),
      definition,
      metaXml,
    };
  },
});

// ---- edit -----------------------------------------------------------------
// Navigate a dotted path, treating numeric segments as array indices.
// e.g. "gridLayouts.0.pages.0.widgets" → obj.gridLayouts[0].pages[0].widgets
function navigate(root, segs) {
  let cur = root;
  for (const seg of segs) {
    if (cur == null || typeof cur !== "object") throw new Error(`path segment "${seg}" not found`);
    const idx = Array.isArray(cur) && /^\d+$/.test(seg) ? parseInt(seg, 10) : seg;
    cur = cur[idx];
  }
  return cur;
}

function setDeep(root, path, value) {
  const segs = String(path).split(".");
  const parentSegs = segs.slice(0, -1);
  const lastSeg = segs[segs.length - 1];
  const parent = parentSegs.length ? navigate(root, parentSegs) : root;
  if (parent == null || typeof parent !== "object") throw new Error(`path "${parentSegs.join(".")}" not found`);
  const idx = Array.isArray(parent) && /^\d+$/.test(lastSeg) ? parseInt(lastSeg, 10) : lastSeg;
  parent[idx] = value;
}

function deleteDeep(root, path) {
  const segs = String(path).split(".");
  const parentSegs = segs.slice(0, -1);
  const lastSeg = segs[segs.length - 1];
  const parent = parentSegs.length ? navigate(root, parentSegs) : root;
  if (parent == null || typeof parent !== "object") throw new Error(`path "${parentSegs.join(".")}" not found`);
  if (Array.isArray(parent)) {
    parent.splice(parseInt(lastSeg, 10), 1);
  } else {
    delete parent[lastSeg];
  }
}

export const applyDashboardEdits = createTool({
  id: "apply-dashboard-edits",
  description:
    "Apply edits to a dashboard definition and return the updated definition (no deploy). " +
    "Each op is { path: 'widgets.chart_1.parameters.title.label', value: ... } to set a value, " +
    "or { path, delete: true } to remove a key or splice an array element. " +
    "Numeric path segments are treated as array indices: e.g. 'gridLayouts.0.pages.0.widgets.2.colspan'. " +
    "To replace the entire widgets array in gridLayouts pass the full array as the value on 'gridLayouts.0.pages.0.widgets'.",
  inputSchema: z.object({
    definition: z.any(),
    operations: z.array(z.object({ path: z.string(), value: z.any().optional(), delete: z.boolean().optional() })),
  }),
  outputSchema: z.object({ definition: z.any(), applied: z.number(), errors: z.array(z.string()) }),
  execute: async (context) => {
    const def = JSON.parse(JSON.stringify(context.definition));
    let applied = 0;
    const errors = [];
    context.operations.forEach((op, i) => {
      try {
        if (op.delete) {
          deleteDeep(def, op.path);
        } else {
          setDeep(def, op.path, op.value);
        }
        applied++;
      } catch (e) {
        errors.push(`op ${i} (${op.path}): ${e.message}`);
      }
    });
    return { definition: def, applied, errors };
  },
});

// ---- validate / deploy ----------------------------------------------------
export const validateDashboard = createTool({
  id: "validate-dashboard",
  description: "Validate a dashboard definition against the org WITHOUT writing (deploy --dry-run). Surfaces org errors.",
  inputSchema: z.object({ name: z.string(), definition: z.any(), metaXml: z.string().nullable().optional() }),
  outputSchema: z.object({ ok: z.boolean(), output: z.string() }),
  execute: async (context) => {
    const prev = process.env.DEPLOY_DRY_RUN;
    process.env.DEPLOY_DRY_RUN = "true";
    const res = await metadataDeploy("WaveDashboard", context.name, context.definition, context.metaXml || null);
    process.env.DEPLOY_DRY_RUN = prev;
    return { ok: /Succeeded/i.test(res.output), output: res.output };
  },
});

export const deployDashboard = createTool({
  id: "deploy-dashboard",
  description:
    "Deploy a dashboard definition to the org. Honors DEPLOY_DRY_RUN in .env. " +
    "Requires confirm=true (the user explicitly approved the write).",
  inputSchema: z.object({
    name: z.string(),
    definition: z.any(),
    metaXml: z.string().nullable().optional(),
    confirm: z.boolean(),
  }),
  outputSchema: z.object({ deployed: z.boolean(), dryRun: z.boolean(), output: z.string() }),
  execute: async (context) => {
    if (!context.confirm) {
      return { deployed: false, dryRun: true, output: "Refused: confirm=false. Ask the user to approve the deploy first." };
    }
    return metadataDeploy("WaveDashboard", context.name, context.definition, context.metaXml || null);
  },
});

export const createDashboardMeta = createTool({
  id: "create-dashboard-meta",
  description: "Build the -meta.xml for a NEW dashboard. application = the target app/folder api name (e.g. SharedApp).",
  inputSchema: z.object({ name: z.string(), label: z.string(), application: z.string() }),
  outputSchema: z.object({ metaXml: z.string() }),
  execute: async (context) => {
    const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<WaveDashboard xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <content xsi:nil="true"/>
    <application>${context.application}</application>
    <dateVersion>1</dateVersion>
    <masterLabel>${context.label}</masterLabel>
</WaveDashboard>`;
    return { metaXml };
  },
});

// ---- query a dataset (for answering data questions) -----------------------
export const queryDataset = createTool({
  id: "query-dataset",
  description:
    "Run a SAQL query against a dataset to answer data questions (row counts, top values, etc.). " +
    "Provide the dataset API name; the tool resolves its current version and runs the SAQL you pass, " +
    "with the load line auto-prefixed. Example saql: 'q = group q by all; q = foreach q generate count() as c;'",
  inputSchema: z.object({
    datasetName: z.string(),
    saqlAfterLoad: z.string().describe("SAQL after the initial 'q = load ...;' line (which is added for you)."),
  }),
  outputSchema: z.object({ records: z.any() }),
  execute: async (context) => {
    const ds = await sfRestGet(`/wave/datasets/${context.datasetName}`);
    const id = ds.id;
    const ver = ds.currentVersionId;
    if (!id || !ver) throw new Error(`dataset ${context.datasetName} has no current version`);
    const query = `q = load \"${id}/${ver}\"; ${context.saqlAfterLoad}`;
    const res = await sfRestPost("/wave/query", { query });
    return { records: (res.results && res.results.records) || res };
  },
});

// ---- get-dataset-fields ---------------------------------------------------
export const getDatasetFields = createTool({
  id: "get-dataset-fields",
  description:
    "Return dimension and measure field names for a CRMA dataset (plus row count). " +
    "Use before writing SAQL to confirm field names exist, or when debugging 'field not found' errors.",
  inputSchema: z.object({
    datasetName: z.string().describe("The CRMA dataset API name (e.g. Vacant_Units_Analysis)"),
  }),
  outputSchema: z.object({
    datasetName: z.string(),
    datasetId: z.string(),
    versionId: z.string(),
    rowCount: z.number().nullable(),
    dimensions: z.array(z.object({ name: z.string(), label: z.string() })),
    measures: z.array(z.object({ name: z.string(), label: z.string() })),
  }),
  execute: async (context) => getDatasetFieldMeta(context.datasetName),
});

// ---- diagnose-dashboard ---------------------------------------------------

/**
 * Pull the SAQL field references out of a step's query string.
 * Returns the set of quoted identifiers (single-quoted in SAQL = field name).
 */
function extractSaqlFields(query) {
  const fields = new Set();
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(query)) !== null) fields.add(m[1]);
  return [...fields];
}

export const diagnoseDashboard = createTool({
  id: "diagnose-dashboard",
  description:
    "Diagnose a broken/blank dashboard. Checks dataset existence, row counts, field references, " +
    "orphaned widgets, steps with no widget, AND chart WIRING consistency (widget viz-type vs step " +
    "viz-type, and whether the data binding form matches the viz type — a bar-family chart with a " +
    "leftover donut columnMap, or a donut with no columnMap, renders EMPTY even though the query runs) " +
    "— AND executes every step's query live against /wave/query (both saql and aggregateflex steps) to " +
    "retrieve the exact 'This widget can't be displayed because of a problem with the underlying query' " +
    "errors WITHOUT the user having to open the dashboard and report them. Run this after EVERY dashboard " +
    "deploy. Returns a structured list of issues with fix hints. A step that errors here is a widget that " +
    "will render as a red box; a wiring mismatch is a widget that will render blank.",
  inputSchema: z.object({
    name: z.string().describe("The dashboard metadata API name"),
  }),
  outputSchema: z.object({
    dashboardName: z.string(),
    issues: z.array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        area: z.string(),
        message: z.string(),
        fixHint: z.string().optional(),
      })
    ),
    datasetsSummary: z.array(
      z.object({
        datasetName: z.string(),
        found: z.boolean(),
        rowCount: z.number().nullable().optional(),
        fieldCount: z.number().optional(),
      })
    ),
    summary: z.string(),
  }),
  execute: async (context) => {
    const issues = [];
    const datasetsSummary = [];

    // 1. Retrieve the dashboard definition.
    let definition;
    try {
      const res = await metadataRetrieve("WaveDashboard", context.name);
      definition = res.definition;
    } catch (e) {
      return {
        dashboardName: context.name,
        issues: [{ severity: "error", area: "retrieve", message: `Could not retrieve dashboard: ${e.message}`, fixHint: "Check that the dashboard name is correct and the org is connected." }],
        datasetsSummary: [],
        summary: "Dashboard could not be retrieved.",
      };
    }

    const steps   = definition.steps   || {};
    const widgets = definition.widgets  || {};
    const gridLayouts = definition.gridLayouts || [];

    // 2. Collect dataset names from all saql steps.
    const datasetRefs = new Set();
    for (const [stepId, step] of Object.entries(steps)) {
      if (step.type === "saql" && step.query) {
        // load "DatasetName" or load "id/versionId" — extract the name form.
        const loadMatch = step.query.match(/q\s*=\s*load\s+"([^/"]+)"/);
        if (loadMatch) datasetRefs.add(loadMatch[1]);
      }
    }

    // 3. Resolve each dataset: check it exists and get its fields.
    const fieldsByDataset = {};
    for (const dsName of datasetRefs) {
      try {
        const meta = await getDatasetFieldMeta(dsName);
        fieldsByDataset[dsName] = new Set([
          ...meta.dimensions.map((d) => d.name),
          ...meta.measures.map((m) => m.name),
        ]);
        datasetsSummary.push({
          datasetName: dsName,
          found: true,
          rowCount: meta.rowCount,
          fieldCount: fieldsByDataset[dsName].size,
        });
        if (meta.rowCount === 0) {
          issues.push({
            severity: "warning",
            area: `dataset:${dsName}`,
            message: `Dataset "${dsName}" has 0 rows.`,
            fixHint: "Run the source recipe. If it has already run, check its filter conditions.",
          });
        }
      } catch (e) {
        fieldsByDataset[dsName] = new Set();
        datasetsSummary.push({ datasetName: dsName, found: false });
        issues.push({
          severity: "error",
          area: `dataset:${dsName}`,
          message: `Dataset "${dsName}" not found or has no current version: ${e.message}`,
          fixHint: "Run the source recipe to generate the dataset before deploying the dashboard.",
        });
      }
    }

    // 4. Validate SAQL field references in each step.
    for (const [stepId, step] of Object.entries(steps)) {
      if (step.type !== "saql" || !step.query) continue;
      const loadMatch = step.query.match(/q\s*=\s*load\s+"([^/"]+)"/);
      const dsName = loadMatch ? loadMatch[1] : null;
      const knownFields = dsName && fieldsByDataset[dsName] ? fieldsByDataset[dsName] : null;

      if (!dsName) {
        issues.push({
          severity: "warning",
          area: `step:${stepId}`,
          message: `Step "${stepId}" SAQL does not have a recognisable load line.`,
          fixHint: 'The SAQL load must begin: q = load "DatasetName";',
        });
        continue;
      }

      if (knownFields && knownFields.size > 0) {
        const referenced = extractSaqlFields(step.query);
        const unknown = referenced.filter((f) => !knownFields.has(f));
        if (unknown.length > 0) {
          issues.push({
            severity: "error",
            area: `step:${stepId}`,
            message: `Step "${stepId}" references field(s) not in dataset "${dsName}": ${unknown.join(", ")}`,
            fixHint: `Check field names with get-dataset-fields. Common cause: using the recipe field name vs. the flattened alias (e.g. "Apt_Location__r.Name" vs "Location").`,
          });
        }
      }

      // Check strings/numbers/groups metadata.
      if (!Array.isArray(step.groups) || step.groups.length > 0) {
        issues.push({
          severity: "error",
          area: `step:${stepId}`,
          message: `Step "${stepId}" has non-empty "groups" array: ${JSON.stringify(step.groups)}. This causes "Column X does not exist for grouping".`,
          fixHint: 'Set groups:[] (empty). Put dimension aliases in "strings" and measure aliases in "numbers".',
        });
      }
    }

    // 4b. LIVE EXECUTION CHECK — the definitive test. Static field-matching (step 4) cannot catch
    //     measure-vs-dimension errors (field exists but is a measure -> "Invalid group expression"),
    //     SAQL syntax errors (== vs =), or bad aggregateflex filters. Only RUNNING the query does.
    //     A step that errors here is EXACTLY the "This widget can't be displayed because of a problem
    //     with the underlying query" red box the user sees in Analytics Studio. Retrieve it, don't
    //     make the user hunt for it.
    const datasetIdVersion = {}; // name -> "id/versionId" for saql loads
    for (const ds of datasetsSummary) {
      if (!ds.found) continue;
      try {
        const list = await sfRestGet(`/wave/datasets?pageSize=200`);
        const hit = (list.datasets || []).find((x) => x.name === ds.datasetName);
        if (hit && hit.currentVersionId) datasetIdVersion[ds.datasetName] = `${hit.id}/${hit.currentVersionId}`;
      } catch (e) { /* best effort */ }
    }

    // Translate a compact aggregateflex query {measures,groups,filters} into runnable SAQL.
    function compactToSaql(idv, compact) {
      const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      let inner = compact;
      if (typeof inner === "string") { try { inner = JSON.parse(decode(inner)); } catch { return null; } }
      if (inner && typeof inner.query === "string") { try { inner = JSON.parse(decode(inner.query)); } catch { return null; } }
      if (!inner || !Array.isArray(inner.measures)) return null;
      const groups = (inner.groups || []).map((g) => `'${g}'`);
      let saql = `q = load "${idv}";`;
      for (const f of inner.filters || []) {
        // compact filter shape: ["field", [values], "operator"]
        if (Array.isArray(f) && f.length >= 2) {
          const field = f[0]; const vals = Array.isArray(f[1]) ? f[1] : [f[1]];
          const vlist = vals.map((v) => `"${v}"`).join(", ");
          saql += ` q = filter q by '${field}' in [${vlist}];`;
        }
      }
      saql += groups.length ? ` q = group q by (${groups.join(", ")});` : ` q = group q by all;`;
      const sel = [];
      for (const g of inner.groups || []) sel.push(`'${g}' as '${g}'`);
      inner.measures.forEach((m, i) => {
        const fn = m[0]; const fld = m[1];
        sel.push(fld === "*" ? `${fn}() as 'm${i}'` : `${fn}('${fld}') as 'm${i}'`);
      });
      saql += ` q = foreach q generate ${sel.join(", ")}; q = limit q 10;`;
      return saql;
    }

    for (const [stepId, step] of Object.entries(steps)) {
      let saqlToRun = null;
      const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      if (step.type === "saql" && step.query) {
        const loadMatch = decode(step.query).match(/load\s+"([^/"]+)"/);
        const dsName = loadMatch ? loadMatch[1] : null;
        const idv = dsName ? datasetIdVersion[dsName] : null;
        saqlToRun = idv ? decode(step.query).replace(new RegExp(`"${dsName}"`), `"${idv}"`) : decode(step.query);
      } else if (step.type === "aggregateflex") {
        // find its dataset name
        const dsName = (step.datasets && step.datasets[0] && step.datasets[0].name) || null;
        const idv = dsName ? datasetIdVersion[dsName] : null;
        if (idv) saqlToRun = compactToSaql(idv, step.query);
      }
      if (!saqlToRun) continue;
      try {
        const res = await sfRestPost("/wave/query", { query: saqlToRun });
        if (res && res.errorCode) {
          issues.push({
            severity: "error",
            area: `step:${stepId}`,
            message: `Step "${stepId}" query FAILS at execution (${res.errorCode}): ${res.message}`,
            fixHint: "This is the red 'widget can't be displayed' error. " +
              "Common causes: grouping by a MEASURE (cast to dimension or use a date-derived dimension), " +
              "SAQL '==' (use single '='), or a field the recipe renamed. Fix the step query.",
          });
        }
      } catch (e) {
        // sfRestPost throws on an error-array response; the clean API error body is in e.stdout.
        // Parse out the {errorCode, message} so we surface "Invalid group expression: FiscalYear..."
        // instead of the raw "Command failed: sf api request..." wrapper.
        let clean = String(e.message || e);
        const body = e.stdout || "";
        const b = body.indexOf("[");
        const o = body.indexOf("{");
        const start = b === -1 ? o : (o === -1 ? b : Math.min(b, o));
        if (start !== -1) {
          try {
            const parsed = JSON.parse(body.slice(start));
            const err = Array.isArray(parsed) ? parsed[0] : parsed;
            if (err && err.message) clean = `${err.errorCode || "error"}: ${err.message}`;
          } catch { /* keep wrapper message */ }
        }
        issues.push({
          severity: "error",
          area: `step:${stepId}`,
          message: `Step "${stepId}" query FAILS at execution — ${clean.slice(0, 260)}`,
          fixHint: "This is the red 'widget can't be displayed' box in Studio. Common causes: " +
            "grouping by a MEASURE (use a date-derived dimension or cast to dimension in the recipe), " +
            "SAQL '==' (use single '='), or a field the recipe renamed.",
        });
      }
    }

    // 5. Find orphaned widgets (no step reference) and steps with no widget.
    const widgetStepRefs = new Set(
      Object.values(widgets)
        .map((w) => w.parameters?.step)
        .filter(Boolean)
    );
    const stepIds = new Set(Object.keys(steps));

    for (const [wId, widget] of Object.entries(widgets)) {
      const ref = widget.parameters?.step;
      if (!ref) {
        // text widgets legitimately have no step
        if (widget.type !== "text") {
          issues.push({
            severity: "warning",
            area: `widget:${wId}`,
            message: `Widget "${wId}" (type:${widget.type}) has no step reference.`,
            fixHint: 'Set parameters.step to the step id this widget should display.',
          });
        }
      } else if (!stepIds.has(ref)) {
        issues.push({
          severity: "error",
          area: `widget:${wId}`,
          message: `Widget "${wId}" references step "${ref}" which does not exist.`,
          fixHint: "Either add the missing step or update the widget's step reference.",
        });
      }

      // 5b. CHART WIRING CONSISTENCY — a chart type is declared in the widget AND the step, and each
      // viz type binds data with mutually-exclusive keys. A type-change edit that updates only some of
      // them leaves a hybrid the renderer can't bind → the widget renders EMPTY (blank + ⚠️) even though
      // the query executes fine. This is a RENDER-WIRING failure the live query check (4b) cannot catch.
      // See DASHBOARD_PATTERNS.md #0e. Live case 2026-09-07: donut→hbar left donut columnMap on an hbar.
      if (widget.type === "chart" && ref && stepIds.has(ref)) {
        const p = widget.parameters || {};
        const widgetViz = String(p.visualizationType || "").toLowerCase();
        const step = steps[ref] || {};
        const stepViz = String(step.visualizationParameters?.visualizationType || "").toLowerCase();

        // (a) widget viz vs step viz must match (when both are declared)
        if (widgetViz && stepViz && widgetViz !== stepViz) {
          issues.push({
            severity: "error",
            area: `widget:${wId}`,
            message: `Chart "${wId}" viz-type mismatch: widget says "${widgetViz}" but its step "${ref}" says "${stepViz}". A widget/step type mismatch renders the widget EMPTY (blank + warning).`,
            fixHint: `Set BOTH to the same type: widgets.${wId}.parameters.visualizationType and steps.${ref}.visualizationParameters.visualizationType.`,
          });
        }

        // (b) data binding form must match the viz type
        const viz = widgetViz || stepViz;
        const barFamily = ["hbar", "vbar", "stackhbar", "stackvbar", "line", "combo", "time", "time-bar", "time-combo"];
        const columnMapTypes = ["donut", "pie", "scatter", "funnel", "pyramid", "stackpyramid", "treemap", "matrix", "heatmap"];
        const cm = p.columnMap;
        const cmHasFields = cm && typeof cm === "object" && Object.values(cm).some(v => Array.isArray(v) && v.length);
        // bar-family needs measureAxis1/dimensionAxis as FIELD ARRAYS (not the styling objects)
        const mA1 = p.measureAxis1;
        const dA = p.dimensionAxis;
        const hasAxisFieldArrays = (Array.isArray(mA1) && mA1.length) && (Array.isArray(dA) && dA.length);

        if (viz && barFamily.includes(viz)) {
          if (cmHasFields) {
            issues.push({
              severity: "error",
              area: `widget:${wId}`,
              message: `Chart "${wId}" is "${viz}" (bar family) but has a populated columnMap (${Object.keys(cm).join(",")}). Bar-family charts bind via measureAxis1[]+dimensionAxis[] field arrays and must NOT use columnMap — this leftover columnMap (likely from a prior donut/pie/scatter type) renders the widget EMPTY.`,
              fixHint: `Delete widgets.${wId}.parameters.columnMap and set measureAxis1:["<alias>"] + dimensionAxis:["<dim>"] (see a working bar widget / DASHBOARD_PATTERNS.md #0e).`,
            });
          } else if (!hasAxisFieldArrays) {
            issues.push({
              severity: "error",
              area: `widget:${wId}`,
              message: `Chart "${wId}" is "${viz}" (bar family) but has no measureAxis1[]/dimensionAxis[] FIELD ARRAYS (they're missing or are styling objects only). Nothing binds the data → the widget renders EMPTY.`,
              fixHint: `Set widgets.${wId}.parameters.measureAxis1:["<measureAlias>"] and dimensionAxis:["<dimField>"] as ARRAYS.`,
            });
          }
        } else if (viz && columnMapTypes.includes(viz)) {
          if (!cmHasFields) {
            issues.push({
              severity: "error",
              area: `widget:${wId}`,
              message: `Chart "${wId}" is "${viz}" but has no populated columnMap. ${viz} binds data via columnMap (e.g. donut/pie: {measure,dimension}; scatter: {x,y,r,plots}; funnel: {dimension,plots}) → without it the widget renders EMPTY.`,
              fixHint: `Set widgets.${wId}.parameters.columnMap with the exact keys for "${viz}" (search-reference "${viz} visualizationType skeleton").`,
            });
          }
        }
      }
    }

    for (const stepId of stepIds) {
      if (!widgetStepRefs.has(stepId)) {
        issues.push({
          severity: "info",
          area: `step:${stepId}`,
          message: `Step "${stepId}" is not referenced by any widget (it may be a hidden/filter step).`,
        });
      }
    }

    // 6. Check grid layout — widgets in gridLayout but not in widgets map, and vice versa.
    const gridWidgetNames = new Set(
      (gridLayouts[0]?.pages || []).flatMap((p) => (p.widgets || []).map((w) => w.name))
    );
    for (const wName of gridWidgetNames) {
      if (!widgets[wName]) {
        issues.push({
          severity: "error",
          area: `gridLayout:${wName}`,
          message: `Widget "${wName}" is in the grid layout but not defined in widgets.`,
          fixHint: "Add the widget definition to the widgets map or remove it from gridLayouts.",
        });
      }
    }
    for (const wName of Object.keys(widgets)) {
      if (!gridWidgetNames.has(wName)) {
        issues.push({
          severity: "warning",
          area: `gridLayout:${wName}`,
          message: `Widget "${wName}" is defined but not placed in any grid layout page.`,
          fixHint: "Add a grid layout entry for this widget so it appears on the dashboard.",
        });
      }
    }

    const errorCount   = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    const summary = issues.length === 0
      ? "No issues found."
      : `${errorCount} error(s), ${warningCount} warning(s), ${issues.filter((i) => i.severity === "info").length} info(s).`;

    return { dashboardName: context.name, issues, datasetsSummary, summary };
  },
});

// ---- cross-org dataset id remap (by name) ---------------------------------
export const remapDatasetIds = createTool({
  id: "remap-dataset-ids",
  description:
    "Remap dataset ids inside a dashboard definition from a source org to the target org by matching " +
    "dataset NAMES (dashboards reference datasets by id in state). Pass a map of {name: newDatasetId}.",
  inputSchema: z.object({
    definition: z.any(),
    idByName: z.record(z.string()).describe("dataset name -> target-org dataset id"),
    oldIdByName: z.record(z.string()).describe("dataset name -> source-org dataset id (to find & replace)"),
  }),
  outputSchema: z.object({ definition: z.any(), replaced: z.number() }),
  execute: async (context) => {
    let raw = JSON.stringify(context.definition);
    let replaced = 0;
    for (const [name, oldId] of Object.entries(context.oldIdByName)) {
      const newId = context.idByName[name];
      if (!newId) continue;
      const before = raw;
      raw = raw.split(oldId).join(newId);
      if (raw !== before) replaced++;
    }
    return { definition: JSON.parse(raw), replaced };
  },
});

// ---- render-dashboard-preview ---------------------------------------------
// Derives BOTH the ASCII mockup and the <chart-preview> JSON block from the
// .wdash definition + pre-queried step data. This is the SINGLE SOURCE OF
// TRUTH for the preview — both outputs are derived from the definition, so
// they are always in sync with what will actually deploy.
//
// stepData: { [stepId]: { labels?: string[], values?: number[], total?: number } }
//   — the agent passes in the query-dataset results it already fetched.
//   For number tiles: { total: 455 }
//   For bar/donut steps: { labels: ["A","B"], values: [100, 50] }

function wdashTypeToPreviewType(widget) {
  if (widget.type === "number")       return "number";
  if (widget.type === "text")         return "text";
  if (widget.type === "table")        return "table";
  if (widget.type === "pivottable")   return "table";
  if (widget.type === "filterpanel")  return "filterpanel";
  if (widget.type === "listselector") return "filter";   // dropdown / list filter control
  if (widget.type === "toggle")       return "filter";
  if (widget.type !== "chart")        return "unknown";
  const vt = (widget.parameters?.visualizationType || "").toLowerCase();
  // stacked variants — must render as MULTIPLE stacked series, not a plain bar/line
  if (vt === "stackhbar") return "stackhbar";
  if (vt === "stackvbar") return "stackvbar";
  if (vt === "stackline") return "stackline";
  // horizontal bars
  if (vt === "hbar") return "hbar";
  // vertical / column bars
  if (vt === "vbar" || vt === "bar") return "vbar";
  // line / time series
  if (vt === "line" || vt === "time" || vt === "time-bar") return "line";
  // combo (bar + line) — now rendered faithfully by ECharts (mixed series)
  if (vt === "combo" || vt === "time-combo") return "combo";
  // donut / pie
  if (vt === "donut" || vt === "pie") return "donut";
  // scatter / dot plots
  if (vt === "scatter" || vt === "hdot" || vt === "vdot") return "scatter";
  // funnel / pyramid — native in ECharts
  if (["funnel","pyramid","stackpyramid"].includes(vt)) return "funnel";
  // waterfall — native (stacked-bar recipe) in ECharts
  if (["waterfall","stackwaterfall"].includes(vt)) return "waterfall";
  // matrix / heatmap — native in ECharts
  if (["matrix","heatmap","calheatmap"].includes(vt)) return "heatmap";
  return "vbar"; // safe fallback for unrecognised chart types
}

// Placeholder sample values so a widget's SHAPE is visible even before any
// real query runs. The user wants a "raw preview" — the exact numbers do not
// matter, only that it looks like a real chart/table. Descending values read
// naturally on bars/funnels.
function sampleValues(n) {
  const base = [100, 78, 61, 47, 36, 28, 21, 15, 11, 8, 6, 4];
  return Array.from({ length: Math.max(1, n) }, (_, i) => base[i] ?? Math.max(2, 4 - i));
}
function samplePoints(n) {
  // pseudo-scatter cloud, deterministic (no Math.random — must stay resume-safe)
  return Array.from({ length: Math.max(3, n) }, (_, i) => [
    Math.round(20 + (i * 37) % 80),
    Math.round(15 + (i * 53) % 85),
  ]);
}

// Extract dimension labels and measure aliases from an aggregateflex step definition.
// Returns { dimensionFields: string[], measureAliases: string[] }
function extractAggregateflexMeta(step) {
  const q = step.query || {};
  // Compact Form 2.0 — sources array
  if (Array.isArray(q.sources) && q.sources.length) {
    const firstSrc = q.sources[0];
    return {
      dimensionFields: firstSrc.groups || [],
      measureAliases:  (firstSrc.columns || []).map(c => c.name).filter(Boolean),
    };
  }
  // Compact Form 1.0 — groups + measures arrays
  const groups   = q.groups   || [];
  const measures = q.measures || [];
  const measureAliases = measures.map(m => {
    if (typeof m === "string") return m;
    if (Array.isArray(m) && m.length >= 3) return m[2]; // ["count","*","alias"]
    return null;
  }).filter(Boolean);
  return { dimensionFields: groups, measureAliases };
}

function buildAsciiBar(label, value, maxValue, barWidth = 20) {
  const filled = maxValue > 0 ? Math.round((value / maxValue) * barWidth) : 0;
  const bar = "█".repeat(filled).padEnd(barWidth);
  return `  ${label.slice(0, 18).padEnd(18)}  ${bar}  ${String(value).padStart(5)}`;
}

function renderAsciiWidget(widgetId, widget, stepData) {
  const title = widget.parameters?.title?.label
    || widget.parameters?.numberLabel
    || widgetId;
  const stepId = widget.parameters?.step;
  const data = stepId && stepData ? stepData[stepId] : null;
  const ptype = wdashTypeToPreviewType(widget);

  if (widget.type === "text") {
    const text = widget.parameters?.richTextContent?.replace(/<[^>]+>/g, "").trim() || title;
    return `  ${text}`;
  }

  if (ptype === "number") {
    const val = data?.total != null ? String(data.total) : "—";
    const w = Math.max(title.length, val.length) + 6;
    const border = "─".repeat(w);
    const pad = (s) => "│" + s.padStart(Math.floor((w + s.length) / 2)).padEnd(w) + "│";
    return [`┌${border}┐`, pad(title), pad(""), pad(val), pad(""), `└${border}┘`].join("\n");
  }

  if (ptype === "hbar") {
    const labels = data?.labels || [];
    const values = data?.values || [];
    const maxVal = Math.max(...values, 1);
    const rows = labels.map((l, i) => buildAsciiBar(l, values[i] || 0, maxVal));
    return [`  ${title}`, "", ...rows].join("\n");
  }

  if (ptype === "vbar") {
    const labels = data?.labels || [];
    const values = data?.values || [];
    const maxVal = Math.max(...values, 1);
    const height = 5;
    const cols = labels.map((l, i) => {
      const filled = Math.round((values[i] / maxVal) * height);
      return { label: l.slice(0, 6), filled };
    });
    const rows = [];
    for (let r = height; r > 0; r--) {
      rows.push("  " + cols.map(c => (c.filled >= r ? " ██  " : "     ")).join(""));
    }
    rows.push("  " + cols.map(c => c.label.padEnd(5)).join(""));
    return [`  ${title}`, "", ...rows].join("\n");
  }

  if (ptype === "line") {
    const values = data?.values || [];
    const labels = data?.labels || [];
    const chars  = ["▁","▂","▃","▄","▅","▆","▇","█"];
    const maxVal = Math.max(...values, 1);
    const spark  = values.map(v => chars[Math.round((v / maxVal) * (chars.length - 1))]).join("");
    const lbl    = labels.length ? labels[0] + " … " + labels[labels.length - 1] : "";
    return [`  ${title}`, "", `  ${spark}`, `  ${lbl}`].join("\n");
  }

  if (ptype === "donut" || ptype === "pie") {
    const labels = data?.labels || [];
    const values = data?.values || [];
    const total  = values.reduce((a, b) => a + b, 0) || 1;
    const dots   = ["●","○","◉","◎","◌"];
    const rows   = labels.map((l, i) => {
      const pct = Math.round((values[i] / total) * 100);
      return `  ${dots[i % dots.length]}  ${l.slice(0, 20).padEnd(20)}  ${String(pct).padStart(3)}%`;
    });
    return [`  ${title}`, "", ...rows].join("\n");
  }

  if (ptype === "table") {
    const cols = widget.parameters?.columns || [];
    const header = cols.slice(0, 5).map(c => c.slice(0, 12).padEnd(12)).join("  ");
    const sep    = cols.slice(0, 5).map(() => "─".repeat(12)).join("  ");
    return [`  ${title}`, `  ${header}`, `  ${sep}`, `  (table — ${cols.length} columns)`].join("\n");
  }

  if (ptype === "filterpanel") {
    const filters = widget.parameters?.filters || [];
    const fields  = filters.map(f => f.field || "").filter(Boolean);
    return [`  Filters: ${fields.join(", ") || "(global)"}`].join("\n");
  }

  if (ptype === "scatter") {
    const labels = data?.labels || [];
    const values = data?.values || [];
    const dots   = values.map((v, i) => `  (${labels[i] || i}, ${v})`).slice(0, 5);
    return [`  ${title}`, "", ...dots, `  [scatter — ${values.length} points]`].join("\n");
  }

  return `  ${title}\n  [${widget.parameters?.visualizationType || widget.type}]`;
}

export const renderDashboardPreview = createTool({
  id: "render-dashboard-preview",
  description:
    "Derive the <chart-preview> block from the .wdash definition and pre-queried step data. Call this " +
    "after building or editing a definition to show the user the intended SHAPE for approval BEFORE " +
    "deploy — never hand-author the preview. The browser renders it as live charts, tables, KPI tiles " +
    "and filter dropdowns (ECharts + HTML): EVERY widget in the definition is drawn as its true type, " +
    "with placeholder sample data where no query has run. Paste chartPreview into chat; do NOT also " +
    "paste the ascii (it's a redundant plain-text fallback for non-browser surfaces only). " +
    "IMPORTANT: this proves LAYOUT/shape, not values or renderability — it executes NO queries. A " +
    "perfect preview can still deploy with broken 'can't be displayed' widgets. Proof of rendering " +
    "comes ONLY from diagnose-dashboard (live query execution) AFTER deploy.",
  inputSchema: z.object({
    label:      z.string().describe("Human-readable dashboard label, e.g. 'Vacant Units Overview'"),
    definition: z.any().describe("The full .wdash definition object (steps, widgets, gridLayouts)"),
    stepData:   z.record(
      z.object({
        total:   z.number().optional().describe("For number tile steps — the single metric value"),
        labels:  z.array(z.string()).optional().describe("Dimension labels for bar/donut/line steps"),
        values:  z.array(z.number()).optional().describe("Measure values aligned with labels"),
        _dummy:  z.boolean().optional().describe("true when data is placeholder, not from real query"),
        _derived: z.boolean().optional().describe("true when labels/values derived from step metadata"),
      })
    ).describe("Map of stepId → queried data. Pass empty object if no data queried yet."),
  }),
  outputSchema: z.object({
    ascii:        z.string().describe("Plain-text fallback mockup — do NOT render by default; browser preview is primary. Use only on non-browser surfaces."),
    chartPreview: z.string().describe("The complete <chart-preview>...</chart-preview> block — paste this into chat; the browser renders it as live charts/tables/KPIs/filters (ECharts + HTML)"),
    hasDummyData: z.boolean().describe("true if any stepData entry is dummy/placeholder rather than real queried data"),
    widgetSummary: z.array(z.object({
      widgetId:    z.string(),
      type:        z.string(),
      previewType: z.string(),
      title:       z.string(),
      stepId:      z.string().optional(),
      hasData:     z.boolean(),
      isDummy:     z.boolean(),
    })),
  }),
  execute: async (context) => {
    const { label, definition } = context;
    const widgets     = definition.widgets     || {};
    const gridLayouts = definition.gridLayouts || [];
    const steps       = definition.steps       || {};

    // Merge caller-supplied stepData with auto-derived metadata from aggregateflex steps.
    // For aggregateflex steps without queried data, we at least know the dimension/measure
    // field names from the step definition — surface those as placeholder labels.
    const stepData = { ...(context.stepData || {}) };
    for (const [stepId, step] of Object.entries(steps)) {
      if (step.type === "aggregateflex" && !stepData[stepId]) {
        const { dimensionFields, measureAliases } = extractAggregateflexMeta(step);
        if (dimensionFields.length || measureAliases.length) {
          stepData[stepId] = {
            labels: dimensionFields,   // field names as placeholder dimension labels
            values: measureAliases.map(() => 0), // zeroes — no real data queried yet
            _derived: true,            // flag: placeholder, not real query results
          };
        }
      }
    }

    // Determine widget render order from gridLayout page order (top→bottom, left→right).
    const gridWidgets = (gridLayouts[0]?.pages?.[0]?.widgets || [])
      .slice()
      .sort((a, b) => a.row !== b.row ? a.row - b.row : a.column - b.column)
      .map(gw => gw.name)
      .filter(n => widgets[n]);

    // Any widgets not in grid go at the end.
    const allIds = [
      ...gridWidgets,
      ...Object.keys(widgets).filter(id => !gridWidgets.includes(id)),
    ];

    // ── ASCII mockup ──────────────────────────────────────────────────────
    const border = "─".repeat(66);
    const headerLine = label.length <= 64
      ? `│  ${label.padEnd(64)}  │`
      : `│  ${label.slice(0, 64)}  │`;

    const widgetLines = [];
    // Pair widgets side-by-side when gridLayout has them on the same rows.
    const placed = new Set();
    for (const gw of (gridLayouts[0]?.pages?.[0]?.widgets || [])) {
      if (placed.has(gw.name)) continue;
      // Find widgets that share the same row band.
      const rowBand = (gridLayouts[0]?.pages?.[0]?.widgets || [])
        .filter(w => !placed.has(w.name) && Math.abs(w.row - gw.row) < 3)
        .sort((a, b) => a.column - b.column);
      if (rowBand.length === 1) {
        placed.add(gw.name);
        const w = widgets[gw.name];
        if (w) widgetLines.push(renderAsciiWidget(gw.name, w, stepData));
      } else {
        const pair = rowBand.slice(0, 2);
        pair.forEach(r => placed.add(r.name));
        const leftId  = pair[0].name;
        const rightId = pair[1].name;
        const leftW   = widgets[leftId];
        const rightW  = widgets[rightId];
        if (leftW && rightW) {
          const leftLines  = renderAsciiWidget(leftId,  leftW,  stepData).split("\n");
          const rightLines = renderAsciiWidget(rightId, rightW, stepData).split("\n");
          const maxH = Math.max(leftLines.length, rightLines.length);
          const sep = "│";
          const combined = Array.from({ length: maxH }, (_, i) => {
            const l = (leftLines[i]  || "").padEnd(28);
            const r = (rightLines[i] || "").padEnd(28);
            return `  ${l}  ${sep}  ${r}`;
          }).join("\n");
          widgetLines.push(combined);
        }
      }
    }

    const ascii = [
      `┌${border}┐`,
      headerLine,
      `├${border}┤`,
      widgetLines.join(`\n├${"─".repeat(66)}┤\n`),
      `└${border}┘`,
    ].join("\n");

    // ── <chart-preview> JSON block ────────────────────────────────────────
    // Map .wdash type to preview type string and extract data per widget.
    // Every widget in the definition is represented in the preview — nothing is
    // silently dropped. When real query data is absent we emit placeholder shape
    // data (sampleValues) so the widget still renders as its true type. The user
    // wants a "raw preview": faithful SHAPE, not exact numbers.
    const previewWidgets = allIds
      .map(wId => {
        const w = widgets[wId];
        if (!w) return null;
        const ptype  = wdashTypeToPreviewType(w);
        const stepId = w.parameters?.step;
        const data   = stepId && stepData[stepId] ? stepData[stepId] : null;
        const title  = w.parameters?.title?.label || w.parameters?.numberLabel || wId;

        // labels/values with placeholder fallback so the shape is always visible.
        // Treat auto-derived metadata (_derived) or all-zero values as "no real
        // data" and substitute sample multi-point data — a single flat bar labeled
        // with a field name is not a useful SHAPE preview.
        const hasRealData = data && !data._derived
          && Array.isArray(data.values) && data.values.some(v => v);
        const labels = hasRealData && data.labels?.length
          ? data.labels
          : ["A", "B", "C", "D", "E"];
        const values = hasRealData && data.values?.length
          ? data.values
          : sampleValues(labels.length);

        if (ptype === "text") {
          const text = w.parameters?.richTextContent?.replace(/<[^>]+>/g, "").trim() || title;
          return { type: "text", title, text };
        }
        if (ptype === "number") {
          return { type: "number", title, value: data?.total ?? null };
        }
        if (["hbar","vbar","bar","line","combo","funnel","waterfall","pyramid"].includes(ptype)) {
          return { type: ptype, title, labels, values };
        }
        if (["stackhbar","stackvbar","stackline"].includes(ptype)) {
          // Stacked charts need MULTIPLE series. Series names come from the step's
          // measures (or a 2nd grouping dimension); fall back to 2 sample series so
          // the STACKED shape is visible even without real data.
          const { measureAliases, dimensionFields } = extractAggregateflexMeta(steps[stepId] || {});
          let seriesNames = measureAliases.length > 1
            ? measureAliases
            : (dimensionFields[1] ? [dimensionFields[1], "Other"] : ["Series A", "Series B"]);
          seriesNames = seriesNames.slice(0, 4);
          const series = seriesNames.map((name, si) => ({
            name,
            values: labels.map((_, i) => Math.max(2, Math.round((sampleValues(labels.length)[i] || 10) / (si + 1)))),
          }));
          return { type: ptype, title, labels, series };
        }
        if (ptype === "donut" || ptype === "pie") {
          return { type: ptype, title, labels, values };
        }
        if (ptype === "heatmap") {
          // heatmap needs two category axes; the first two step groups map to x/y.
          const { dimensionFields } = extractAggregateflexMeta(steps[stepId] || {});
          const xCats = dimensionFields[0] ? [dimensionFields[0], "…", "…"] : ["X1","X2","X3"];
          const yCats = dimensionFields[1] ? [dimensionFields[1], "…", "…"] : ["Y1","Y2","Y3"];
          return { type: "heatmap", title, xCats, yCats };
        }
        if (ptype === "scatter") {
          return { type: "scatter", title, points: samplePoints(values.length) };
        }
        if (ptype === "table") {
          const cols = w.parameters?.columns
            || w.parameters?.columnMap && Object.keys(w.parameters.columnMap)
            || [];
          return { type: "table", title, columns: cols };
        }
        if (ptype === "filter") {
          // listselector / toggle → a real dropdown control. Derive the field it filters.
          const st = steps[stepId] || {};
          const { dimensionFields } = extractAggregateflexMeta(st);
          const field = dimensionFields[0]
            || w.parameters?.title?.label
            || wId;
          return { type: "filter", title, field };
        }
        // unknown → still show a labeled placeholder box, never drop it
        return { type: "placeholder", title, kind: w.type || "widget" };
      })
      .filter(Boolean);

    const chartPreviewJson = JSON.stringify({ title: label, widgets: previewWidgets }, null, 2);
    const chartPreview = `<chart-preview>\n${chartPreviewJson}\n</chart-preview>`;

    // ── Widget summary ────────────────────────────────────────────────────
    const widgetSummary = allIds.map(wId => {
      const w = widgets[wId];
      if (!w) return null;
      const stepId = w.parameters?.step;
      const sd = stepId ? stepData[stepId] : null;
      return {
        widgetId:    wId,
        type:        w.type,
        previewType: wdashTypeToPreviewType(w),
        title:       w.parameters?.title?.label || w.parameters?.numberLabel || wId,
        stepId:      stepId || undefined,
        hasData:     !!(sd),
        isDummy:     !!(sd?._dummy || sd?._derived),
      };
    }).filter(Boolean);

    const hasDummyData = Object.values(stepData).some(sd => sd._dummy || sd._derived);

    return { ascii, chartPreview, hasDummyData, widgetSummary };
  },
});

export const dashboardTools = {
  listDashboards,
  getDashboard,
  applyDashboardEdits,
  validateDashboard,
  deployDashboard,
  createDashboardMeta,
  queryDataset,
  remapDatasetIds,
  getDatasetFields,
  diagnoseDashboard,
  renderDashboardPreview,
};
