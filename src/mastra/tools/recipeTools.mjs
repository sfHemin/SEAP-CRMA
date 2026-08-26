// recipeTools.mjs — tools the agent uses to work with CRMA recipes.
// ---------------------------------------------------------------------------
// listRecipes / getRecipe / applyRecipeEdits / validateRecipe / deployRecipe /
// createRecipe. Editing is done with the same node-operation model as the
// Recipe Diff tool (setValue / addNode / replaceNode / deleteNode) so changes
// are surgical and auditable rather than a blind full rewrite.
// ---------------------------------------------------------------------------

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  sfRestGet,
  sfSoql,
  sfDescribeObject,
  sfListCustomObjects,
  metadataRetrieve,
  metadataDeploy,
  DRY_RUN,
  waveCreateRecipe,
  waveUpdateRecipe,
  waveFindRecipe,
  waveRunDataflow,
  waveDataflowJobStatus,
  checkIntegrationUserFieldAccess,
  grantIntegrationUserFieldAccess,
  checkReplicationStatus,
} from "../sf.mjs";

const nodeMap = (def) => def?.nodes || def?.recipeDefinition?.nodes || {};

// ---- list -----------------------------------------------------------------
export const listRecipes = createTool({
  id: "list-recipes",
  description: "List CRM Analytics recipes in the target org (name + label + id).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    recipes: z.array(z.object({ name: z.string(), label: z.string().optional(), id: z.string() })),
  }),
  execute: async () => {
    const data = await sfRestGet("/wave/recipes?pageSize=200");
    return { recipes: (data.recipes || []).map((r) => ({ name: r.name, label: r.label, id: r.id })) };
  },
});

// ---- get ------------------------------------------------------------------
export const getRecipe = createTool({
  id: "get-recipe",
  description:
    "Retrieve a recipe's full R3 definition JSON (nodes/ui/runMode) by its metadata name " +
    "(the API name, e.g. Segmentation_Cluster_Analysis_Account_Segmentation1). Use this before editing or debugging.",
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({
    name: z.string(),
    nodeCount: z.number(),
    nodeIds: z.array(z.string()),
    definition: z.any(),
    metaXml: z.string().nullable(),
  }),
  execute: async (context) => {
    const { definition, metaXml } = await metadataRetrieve("WaveRecipe", context.name);
    const nodes = nodeMap(definition);
    return { name: context.name, nodeCount: Object.keys(nodes).length, nodeIds: Object.keys(nodes), definition, metaXml };
  },
});

// ---- edit (apply node operations) -----------------------------------------
const OperationSchema = z.object({
  action: z.enum(["setValue", "addNode", "replaceNode", "deleteNode"]),
  node: z.string(),
  path: z.string().optional(),
  value: z.any().optional(),
  definition: z.any().optional(),
});

function setPath(root, path, value) {
  const segs = String(path).split(".");
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] == null || typeof cur[segs[i]] !== "object") throw new Error(`path segment "${segs[i]}" not found`);
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}

export const applyRecipeEdits = createTool({
  id: "apply-recipe-edits",
  description:
    "Apply surgical node-level edits to a recipe definition and return the edited definition. " +
    "Operations: setValue (dotted path within a node), addNode, replaceNode, deleteNode. " +
    "Does NOT deploy — pass the result to validate-recipe / deploy-recipe.",
  inputSchema: z.object({
    definition: z.any().describe("The recipe definition JSON (from get-recipe)."),
    operations: z.array(OperationSchema),
  }),
  outputSchema: z.object({ definition: z.any(), applied: z.number(), errors: z.array(z.string()) }),
  execute: async (context) => {
    const def = JSON.parse(JSON.stringify(context.definition));
    const nodes = nodeMap(def);
    let applied = 0;
    const errors = [];
    context.operations.forEach((op, i) => {
      try {
        if (op.action === "deleteNode") {
          if (!(op.node in nodes)) throw new Error(`node "${op.node}" not found`);
          delete nodes[op.node];
        } else if (op.action === "addNode" || op.action === "replaceNode") {
          if (!op.definition) throw new Error("missing definition");
          nodes[op.node] = op.definition;
        } else if (op.action === "setValue") {
          if (!(op.node in nodes)) throw new Error(`node "${op.node}" not found`);
          if (op.path == null) throw new Error("missing path");
          setPath(nodes[op.node], op.path, op.value);
        }
        applied++;
      } catch (e) {
        errors.push(`op ${i} (${op.action} ${op.node}): ${e.message}`);
      }
    });
    return { definition: def, applied, errors };
  },
});

// ---- validate (dry-run deploy) --------------------------------------------
export const validateRecipe = createTool({
  id: "validate-recipe",
  description:
    "Validate a recipe definition against the org WITHOUT writing (metadata deploy --dry-run). " +
    "Use to debug: it surfaces the org's own compile/deploy errors. name = target metadata name.",
  inputSchema: z.object({ name: z.string(), definition: z.any(), metaXml: z.string().nullable().optional() }),
  outputSchema: z.object({ ok: z.boolean(), output: z.string() }),
  execute: async (context) => {
    // Force dry-run regardless of env for this tool.
    const prev = process.env.DEPLOY_DRY_RUN;
    process.env.DEPLOY_DRY_RUN = "true";
    const res = await metadataDeploy("WaveRecipe", context.name, context.definition, context.metaXml || null);
    process.env.DEPLOY_DRY_RUN = prev;
    return { ok: /Succeeded/i.test(res.output), output: res.output };
  },
});

// ---- deploy (create OR update via Wave REST) ------------------------------
// NOTE: New recipes MUST be created via Wave REST (POST /wave/recipes), NOT the
// metadata API — a metadata deploy of a *new* WaveRecipe fails with "A Recipe
// must specify a Dataflow". This tool auto-detects: if a recipe with `name`
// already exists it PATCHes it, otherwise it POSTs a new one. Gated by confirm.
export const deployRecipe = createTool({
  id: "deploy-recipe",
  description:
    "Create or update a recipe in the org via the Wave REST API (the reliable path for recipes). " +
    "If a recipe named `name` exists it is updated; otherwise a new one is created. " +
    "Honors DEPLOY_DRY_RUN in .env (when true, refuses to write and tells you). " +
    "Requires explicit user confirmation: call with confirm=true only after the user approves.",
  inputSchema: z.object({
    name: z.string(),
    label: z.string(),
    definition: z.any().describe("The R3 recipe definition {version,nodes,ui,runMode}."),
    confirm: z.boolean().describe("Must be true — the user explicitly approved the write."),
  }),
  outputSchema: z.object({
    deployed: z.boolean(),
    action: z.string(),
    recipeId: z.string().nullable(),
    dataflowId: z.string().nullable(),
    message: z.string(),
  }),
  execute: async (context) => {
    if (!context.confirm) {
      return { deployed: false, action: "refused", recipeId: null, dataflowId: null,
        message: "Refused: confirm=false. Ask the user to approve the write first." };
    }
    if (DRY_RUN) {
      return { deployed: false, action: "dry-run", recipeId: null, dataflowId: null,
        message: "DEPLOY_DRY_RUN=true in .env — write skipped. Set it to false and restart to allow writes." };
    }
    const existing = await waveFindRecipe(context.name);
    if (existing) {
      const r = await waveUpdateRecipe(existing.id, context.name, context.label, context.definition);
      return { deployed: true, action: "updated", recipeId: r.id || existing.id,
        dataflowId: r.targetDataflowId || existing.targetDataflowId || null,
        message: `Updated recipe ${context.name} (${r.id || existing.id}).` };
    }
    const r = await waveCreateRecipe(context.name, context.label, context.definition);
    return { deployed: true, action: "created", recipeId: r.id || null,
      dataflowId: r.targetDataflowId || null,
      message: `Created recipe ${context.name} (${r.id}). targetDataflowId=${r.targetDataflowId}.` };
  },
});

// ---- run (execute the recipe = start its dataflow job) --------------------
export const runRecipe = createTool({
  id: "run-recipe",
  description:
    "Run a recipe (start its dataflow job) so it produces its output dataset. " +
    "Give either the recipe `name` or its `dataflowId`. Returns the job id + initial status; " +
    "use get-recipe-run-status to poll. This performs a real run — gate behind user confirmation. " +
    "If the run fails, returns a diagnostic with the error and suggested fix steps.",
  inputSchema: z.object({
    name: z.string().optional(),
    dataflowId: z.string().optional(),
    confirm: z.boolean().describe("Must be true — running writes a dataset."),
  }),
  outputSchema: z.object({
    started: z.boolean(),
    jobId: z.string().nullable(),
    status: z.string(),
    message: z.string(),
    error: z.string().nullable().optional(),
    diagnosis: z.string().nullable().optional(),
    fixSteps: z.array(z.string()).nullable().optional(),
    autoFixable: z.boolean().optional(),
  }),
  execute: async (context) => {
    if (!context.confirm) {
      return { started: false, jobId: null, status: "refused", message: "Refused: confirm=false. Ask the user first." };
    }
    let dataflowId = context.dataflowId;
    let recipeName = context.name;
    if (!dataflowId && recipeName) {
      const found = await waveFindRecipe(recipeName);
      if (!found) return { started: false, jobId: null, status: "not-found", message: `No recipe named ${recipeName}.` };
      dataflowId = found.targetDataflowId;
    }
    if (!dataflowId) return { started: false, jobId: null, status: "error", message: "Provide name or dataflowId." };
    try {
      const job = await waveRunDataflow(dataflowId);
      return { started: true, jobId: job.id, status: job.status, message: `Started job ${job.id} (${job.status}).` };
    } catch (e) {
      const errMsg = e.message || String(e);
      const diag = diagnoseRunError(errMsg, recipeName);
      return {
        started: false, jobId: null, status: "failed",
        message: `Run failed: ${errMsg}`,
        error: errMsg,
        diagnosis: diag.diagnosis,
        fixSteps: diag.fixSteps,
        autoFixable: diag.autoFixable,
      };
    }
  },
});

function diagnoseRunError(errMsg, recipeName) {
  if (/has not setup replication/i.test(errMsg)) {
    const objMatch = errMsg.match(/Object with name (\S+)/i);
    const obj = objMatch ? objMatch[1] : "the source object";
    return {
      diagnosis: `"${obj}" needs replication enabled in CRMA Data Manager before the recipe can load its data. ` +
        `This cannot be done via API — it requires the Data Manager UI.`,
      fixSteps: [
        "Open Analytics Studio → Data Manager → Connect tab",
        `Find the SFDC Local connection and click it`,
        `Find "${obj}" in the object list and toggle it ON`,
        "Click Save, then run the connection sync to replicate the data",
        `After sync completes, re-run the recipe "${recipeName || ""}"`,
      ],
      autoFixable: false,
    };
  }
  if (/field.*doesn't exist.*Integration User|isn't accessible to the Integration User/i.test(errMsg)) {
    const fieldMatch = errMsg.match(/the '([^']+)' field/i);
    const field = fieldMatch ? fieldMatch[1] : "unknown";
    return {
      diagnosis: `The Analytics Integration User lacks READ access to field "${field}". ` +
        `Use check-field-access then grant-field-access to fix.`,
      fixSteps: [
        `Call check-field-access to confirm which fields are blocked`,
        `Call grant-field-access with the blocked fields (with user approval)`,
        `Re-run the recipe after the permission set is assigned`,
      ],
      autoFixable: true,
    };
  }
  if (/Output dataset label can not be empty/i.test(errMsg)) {
    return {
      diagnosis: `The recipe's OUTPUT/save node is missing a "label" in parameters.dataset. ` +
        `Edit the recipe to add it.`,
      fixSteps: [
        `Get the recipe definition with get-recipe`,
        `Use apply-recipe-edits to set the OUTPUT node's parameters.dataset.label`,
        `Re-deploy and re-run`,
      ],
      autoFixable: true,
    };
  }
  if (/UNKNOWN_EXCEPTION/i.test(errMsg)) {
    return {
      diagnosis: `Salesforce returned a generic UNKNOWN_EXCEPTION. Common causes: ` +
        `(1) the source object hasn't been replicated, (2) the recipe was just created and the ` +
        `internal dataflow hasn't fully initialized, (3) transient org issue.`,
      fixSteps: [
        "Use check-replication to verify all source objects have replication enabled",
        "If replication is missing, follow the Data Manager steps to enable it",
        "If replication is fine, wait 1-2 minutes and retry",
        "If it persists, open the recipe in Analytics Studio to see the org-side error",
      ],
      autoFixable: false,
    };
  }
  return {
    diagnosis: `Unrecognized run error. Check the recipe definition and org state.`,
    fixSteps: [
      "Get the recipe definition and verify it's valid",
      "Check replication status for all source objects",
      "Check FLS for the Integration User on all loaded fields",
      "Try opening the recipe in Analytics Studio for the org's own error details",
    ],
    autoFixable: false,
  };
}

// ---- run status -----------------------------------------------------------
export const getRecipeRunStatus = createTool({
  id: "get-recipe-run-status",
  description: "Poll a recipe/dataflow job by its jobId. Returns status (Queued/Running/Success/Failed) and progress 0-1.",
  inputSchema: z.object({ jobId: z.string() }),
  outputSchema: z.object({ status: z.string(), progress: z.number() }),
  execute: async (context) => {
    const s = await waveDataflowJobStatus(context.jobId);
    return { status: s.status, progress: Number(s.progress) || 0 };
  },
});

// ---- FLS check (Analytics Integration User field access) ------------------
// A recipe can deploy + validate fine yet FAIL at run time with
// "the '<Field>' field ... isn't accessible to the Integration User" because
// CRMA syncs data as the Analytics Cloud Integration User, not the signed-in
// user. Use this BEFORE running (or when a run fails with that error) to see
// which fields the Integration User can actually read.
export const checkFieldAccess = createTool({
  id: "check-field-access",
  description:
    "Check whether the CRM Analytics Integration User can READ the given fields on an object. " +
    "CRMA recipes sync as this user (not the signed-in user), so a recipe can validate but fail at RUN time " +
    "with 'field ... isn't accessible to the Integration User'. Run this before running a recipe on custom " +
    "objects, or when a run fails with a field-access error. Returns per-field readable=true/false.",
  inputSchema: z.object({
    object: z.string().describe("Object API name, e.g. Apartment__c"),
    fields: z.array(z.string()).describe("Field API names (without object prefix), e.g. ['Rent__c','Occupied__c']"),
  }),
  outputSchema: z.object({
    integrationUserId: z.string().nullable(),
    results: z.array(z.object({ field: z.string(), readable: z.boolean(), grantedBy: z.string() })),
    blocked: z.array(z.string()),
  }),
  execute: async (context) => {
    const { integrationUserId, results } = await checkIntegrationUserFieldAccess(context.object, context.fields);
    const blocked = results.filter((r) => !r.readable).map((r) => r.field);
    return { integrationUserId, results, blocked };
  },
});

// ---- FLS fix (grant + assign an FLS-only permission set) ------------------
export const grantFieldAccess = createTool({
  id: "grant-field-access",
  description:
    "Fix 'field not accessible to the Integration User' by deploying an FLS-only permission set granting field " +
    "READ and assigning it to the Analytics Integration User. Honors DEPLOY_DRY_RUN (validates only when on). " +
    "This is a WRITE to the org's security config — get explicit user approval and call with confirm=true. " +
    "Do NOT include required/system fields (they're always readable and will error).",
  inputSchema: z.object({
    object: z.string(),
    fields: z.array(z.string()),
    permissionSetName: z.string().optional().describe("Defaults to CRMA_Integration_FLS."),
    confirm: z.boolean().describe("Must be true — user approved the security-config write."),
  }),
  outputSchema: z.object({ applied: z.boolean(), dryRun: z.boolean(), permissionSet: z.string(), output: z.string() }),
  execute: async (context) => {
    if (!context.confirm) {
      return { applied: false, dryRun: true, permissionSet: context.permissionSetName || "CRMA_Integration_FLS",
        output: "Refused: confirm=false. Ask the user to approve granting field access first." };
    }
    return grantIntegrationUserFieldAccess(context.object, context.fields, context.permissionSetName || "CRMA_Integration_FLS");
  },
});

// ---- describe a Salesforce object (get real field names) ------------------
export const describeObject = createTool({
  id: "describe-object",
  description:
    "Describe a Salesforce object and return ALL its fields with API name, label, type, and whether required. " +
    "Call this FIRST before building a recipe on any object — don't guess field names. " +
    "Example: describe Apartment__c to get the real field list before authoring the recipe.",
  inputSchema: z.object({
    objectName: z.string().describe("Salesforce object API name, e.g. Apartment__c or Account"),
  }),
  outputSchema: z.object({
    objectName: z.string(),
    label: z.string(),
    fieldCount: z.number(),
    fields: z.array(z.object({ name: z.string(), label: z.string(), type: z.string(), required: z.boolean() })),
  }),
  execute: async (context) => {
    return sfDescribeObject(context.objectName);
  },
});

// ---- list custom objects in the org ---------------------------------------
export const listCustomObjects = createTool({
  id: "list-custom-objects",
  description:
    "List all custom objects (API names ending in __c) available in the org. " +
    "Use this when the user asks 'what data do I have?' or 'what can I build analytics on?'",
  inputSchema: z.object({}),
  outputSchema: z.object({ objects: z.array(z.string()) }),
  execute: async () => {
    const objs = await sfListCustomObjects();
    return { objects: objs };
  },
});

// ---- run a SOQL query -----------------------------------------------------
export const runSoql = createTool({
  id: "run-soql",
  description:
    "Run a SOQL query against the org and return the records. Use this to check actual data values " +
    "(e.g. what BillingCountry values exist, record counts, field value distributions) before or after a recipe run.",
  inputSchema: z.object({
    soql: z.string().describe("Full SOQL query string, e.g. SELECT BillingCountry, COUNT(Id) FROM Account GROUP BY BillingCountry"),
  }),
  outputSchema: z.object({ records: z.array(z.any()), count: z.number() }),
  execute: async (context) => {
    const records = await sfSoql(context.soql);
    return { records, count: records.length };
  },
});

// ---- check replication status -----------------------------------------------
export const checkReplication = createTool({
  id: "check-replication",
  description:
    "Check whether source objects have replication enabled on the SFDC_LOCAL connector. " +
    "A recipe CANNOT run until its source objects are replicated. Call this BEFORE run-recipe " +
    "on any custom object. If objects are unreplicated, tell the user the Data Manager steps " +
    "to enable it (this cannot be done via API).",
  inputSchema: z.object({
    objects: z.array(z.string()).describe("Object API names to check, e.g. ['Apartment__c']"),
  }),
  outputSchema: z.object({
    connectorId: z.string().nullable(),
    results: z.array(z.object({ object: z.string(), replicated: z.boolean() })),
    unreplicated: z.array(z.string()),
    allReady: z.boolean(),
    fixInstructions: z.string().nullable(),
  }),
  execute: async (context) => {
    const { connectorId, results, unreplicated } = await checkReplicationStatus(context.objects);
    const allReady = unreplicated.length === 0;
    const fixInstructions = allReady
      ? null
      : `The following objects need replication enabled before the recipe can run: ${unreplicated.join(", ")}.\n` +
        `Steps:\n` +
        `1. Open Analytics Studio → Data Manager → Connect tab\n` +
        `2. Click the SFDC Local connection\n` +
        `3. Find each object listed above and toggle it ON\n` +
        `4. Save and run the connection sync\n` +
        `5. After sync completes, re-run the recipe.`;
    return { connectorId, results, unreplicated, allReady, fixInstructions };
  },
});

export const recipeTools = {
  listRecipes,
  getRecipe,
  applyRecipeEdits,
  validateRecipe,
  deployRecipe,
  runRecipe,
  getRecipeRunStatus,
  checkFieldAccess,
  grantFieldAccess,
  checkReplication,
  describeObject,
  listCustomObjects,
  runSoql,
};
