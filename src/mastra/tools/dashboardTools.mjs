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
function setDeep(root, path, value) {
  const segs = String(path).split(".");
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] == null || typeof cur[segs[i]] !== "object") throw new Error(`path "${segs[i]}" not found`);
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}

export const applyDashboardEdits = createTool({
  id: "apply-dashboard-edits",
  description:
    "Apply edits to a dashboard state and return the edited definition (no deploy). " +
    "Each op is { path: 'widgets.chart_1.parameters.title.label', value: ... } to set, " +
    "or { path, delete: true } to remove a key. Paths are dotted into the state object.",
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
          const segs = op.path.split(".");
          let cur = def;
          for (let j = 0; j < segs.length - 1; j++) cur = cur[segs[j]];
          delete cur[segs[segs.length - 1]];
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
    "Diagnose a broken dashboard: checks dataset existence, row counts, SAQL field references, " +
    "orphaned widgets, and steps with no widget. Returns a structured list of issues with fix hints.",
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
};
