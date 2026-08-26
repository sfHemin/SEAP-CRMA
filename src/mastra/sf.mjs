// sf.mjs — Salesforce I/O for the agent, via the already-authed `sf` CLI.
// ---------------------------------------------------------------------------
// No OAuth app, no cookie: we reuse the user's `sf` CLI session. Two channels:
//   1. REST   — `sf api request rest <path>` for listing/querying Wave assets.
//   2. Metadata — `sf project retrieve/deploy start` for reading & writing
//      recipe (.wdpr) and dashboard (.wdash) definitions. This is the RELIABLE
//      write path (the Wave REST PATCH/POST is unreliable on these orgs).
//
// Metadata ops need a DX project on disk; we lazily create a scratch one under
// .sfdx-work/ and reuse it. All shell calls are promise-wrapped with captured
// stdout/stderr so tools can surface clean errors to Claude.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, "..", "..");                // CRMA Mastra/
const WORK_DIR = join(PROJECT_ROOT, ".sfdx-work");          // scratch DX project
const WAVE_DIR = join(WORK_DIR, "force-app", "main", "default", "wave");

export const TARGET_ORG = process.env.SF_TARGET_ORG || "";
export const DRY_RUN = String(process.env.DEPLOY_DRY_RUN || "true").toLowerCase() !== "false";
const API = "v62.0";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, cwd: opts.cwd, env: process.env }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function requireOrg() {
  if (!TARGET_ORG) throw new Error("SF_TARGET_ORG is not set in .env (use an alias from `sf org list`).");
}

// --- REST channel ----------------------------------------------------------

/** GET a Wave REST path, return parsed JSON. `path` is like "/wave/recipes". */
export async function sfRestGet(path) {
  requireOrg();
  const full = path.startsWith("/services/") ? path : `/services/data/${API}${path}`;
  const { stdout } = await run("sf", ["api", "request", "rest", full, "--target-org", TARGET_ORG]);
  const start = stdout.indexOf("{");
  const arr = stdout.indexOf("[");
  const from = arr >= 0 && (arr < start || start < 0) ? arr : start;
  return JSON.parse(stdout.slice(from));
}

/** POST JSON to a Wave REST path (used for SAQL query only — writes go via Metadata). */
export async function sfRestPost(path, body) {
  requireOrg();
  await ensureProject();
  const full = path.startsWith("/services/") ? path : `/services/data/${API}${path}`;
  const tmp = join(WORK_DIR, "_body.json");
  writeFileSync(tmp, JSON.stringify(body));
  const { stdout } = await run("sf", ["api", "request", "rest", full, "--method", "POST", "--body", `@${tmp}`, "--target-org", TARGET_ORG]);
  const s = stdout.indexOf("{");
  return JSON.parse(stdout.slice(s));
}

/** Send JSON with an arbitrary method (PATCH/PUT/DELETE) to a Wave REST path. */
export async function sfRestSend(method, path, body) {
  requireOrg();
  await ensureProject();
  const full = path.startsWith("/services/") ? path : `/services/data/${API}${path}`;
  const tmp = join(WORK_DIR, "_body.json");
  writeFileSync(tmp, JSON.stringify(body || {}));
  const { stdout } = await run("sf", ["api", "request", "rest", full, "--method", method, "--body", `@${tmp}`, "--target-org", TARGET_ORG]);
  const s = stdout.indexOf("{");
  const a = stdout.indexOf("[");
  const from = a >= 0 && (a < s || s < 0) ? a : s;
  const parsed = JSON.parse(stdout.slice(from));
  // Wave returns an array of {errorCode,message} on failure.
  if (Array.isArray(parsed) && parsed[0]?.errorCode) {
    throw new Error(`${parsed[0].errorCode}: ${parsed[0].message}`);
  }
  return parsed;
}

// --- Wave REST write path for RECIPES --------------------------------------
// IMPORTANT: New recipes MUST be created via Wave REST (POST /wave/recipes with
// a `recipeDefinition`), NOT metadata deploy. A metadata deploy of a *new*
// WaveRecipe silently fails ("A Recipe must specify a Dataflow") — it only works
// to UPDATE recipes that already exist server-side. (Dashboards differ — they
// deploy fine via metadata.) Proven on storm-org 2026-08-25.

/** Create a new recipe. Returns the created recipe (with id + targetDataflowId). */
export async function waveCreateRecipe(name, label, definitionObj, format = "R3") {
  return sfRestSend("POST", "/wave/recipes", { name, label, format, recipeDefinition: definitionObj });
}

/** Update an existing recipe by id (PATCH). */
export async function waveUpdateRecipe(recipeId, name, label, definitionObj, format = "R3") {
  return sfRestSend("PATCH", `/wave/recipes/${recipeId}`, { name, label, format, recipeDefinition: definitionObj });
}

/** Look up a recipe id + targetDataflowId by metadata name. Returns null if absent. */
export async function waveFindRecipe(name) {
  const data = await sfRestGet("/wave/recipes?pageSize=200");
  const r = (data.recipes || []).find((x) => x.name === name);
  return r ? { id: r.id, name: r.name, label: r.label, targetDataflowId: r.targetDataflowId } : null;
}

/** Start a recipe's dataflow job (runs the recipe). Returns the job {id,status}. */
export async function waveRunDataflow(dataflowId) {
  return sfRestPost("/wave/dataflowjobs", { dataflowId, command: "start" });
}

/** Poll a dataflow job once. Returns {status, progress}. */
export async function waveDataflowJobStatus(jobId) {
  const j = await sfRestGet(`/wave/dataflowjobs/${jobId}`);
  return { status: j.status, progress: j.progress };
}

/**
 * Describe a Salesforce object — returns all fields with name, label, type,
 * and required. Use this to get real field API names before building a recipe.
 */
export async function sfDescribeObject(objectName) {
  requireOrg();
  const { stdout } = await run("sf", ["sobject", "describe", "--sobject", objectName, "--target-org", TARGET_ORG, "--json"]);
  const parsed = JSON.parse(stdout);
  const desc = parsed.result || parsed;
  const fields = (desc.fields || []).map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    required: !f.nillable && !f.defaultedOnCreate,
  }));
  return { objectName, label: desc.label || objectName, fieldCount: fields.length, fields };
}

/**
 * List all custom objects (API names ending in __c) in the org.
 */
export async function sfListCustomObjects() {
  requireOrg();
  const { stdout } = await run("sf", ["sobject", "list", "--sobject-type", "custom", "--target-org", TARGET_ORG, "--json"]);
  const parsed = JSON.parse(stdout);
  return (parsed.result || []);
}

// --- Field-Level Security (FLS) for the Analytics Integration User ---------
// CRMA recipes sync data as the "Analytics Cloud Integration User", NOT as the
// signed-in user. If that user lacks field read on a custom field, the recipe
// deploys/validates fine but the RUN fails with "the '<Field>' field doesn't
// exist, is deprecated, or isn't accessible to the Integration User". The fix
// is a permission set granting field read, assigned to that Integration User.

/** Run a SOQL query via the CLI, return the records array. */
export async function sfSoql(soql) {
  requireOrg();
  const { stdout } = await run("sf", ["data", "query", "--query", soql, "--target-org", TARGET_ORG, "--json"]);
  const parsed = JSON.parse(stdout);
  return parsed.result?.records || [];
}

/**
 * Check whether the Analytics Cloud Integration User can READ each field.
 * A field is readable if it's granted by that user's profile OR any assigned
 * permission set, or if it's a required/system field (always readable).
 * @param {string} objectApi e.g. "Apartment__c"
 * @param {string[]} fields  field API names (without the object prefix)
 * @returns {Promise<{integrationUserId:string|null, results:Array<{field:string,readable:boolean,grantedBy:string}>}>}
 */
export async function checkIntegrationUserFieldAccess(objectApi, fields) {
  // 1. Find the Analytics Cloud Integration User.
  const users = await sfSoql(
    "SELECT Id, Name FROM User WHERE Profile.Name='Analytics Cloud Integration User' AND IsActive=true LIMIT 1"
  );
  const integrationUserId = users[0]?.Id || null;

  // 2. Pull every FieldPermissions row for this object that the user gets,
  //    via their profile's PermissionSet or any assigned permission set.
  //    (Every profile has an implicit PermissionSet; assignments cover both.)
  let granted = new Set();
  if (integrationUserId) {
    const esc = String(objectApi).replace(/'/g, "\\'");
    const rows = await sfSoql(
      `SELECT Field FROM FieldPermissions WHERE SobjectType='${esc}' AND PermissionsRead=true ` +
      `AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId='${integrationUserId}')`
    );
    granted = new Set(rows.map((r) => r.Field)); // e.g. "Apartment__c.Rent__c"
  }

  const results = fields.map((f) => {
    const full = f.includes(".") ? f : `${objectApi}.${f}`;
    return { field: full, readable: granted.has(full), grantedBy: granted.has(full) ? "assigned" : "" };
  });
  return { integrationUserId, results };
}

/**
 * Grant the Integration User field read on the given fields by deploying an
 * FLS-only permission set and assigning it. Honors DEPLOY_DRY_RUN. Required and
 * system fields can't be in FLS (always readable) — caller should pre-filter.
 * @returns {{applied:boolean, dryRun:boolean, permissionSet:string, output:string}}
 */
export async function grantIntegrationUserFieldAccess(objectApi, fields, permSetName = "CRMA_Integration_FLS") {
  requireOrg();
  await ensureProject();
  const dry = String(process.env.DEPLOY_DRY_RUN || "true").toLowerCase() !== "false";

  const fieldXml = fields
    .map((f) => (f.includes(".") ? f : `${objectApi}.${f}`))
    .map((full) => `    <fieldPermissions><field>${full}</field><readable>true</readable><editable>false</editable></fieldPermissions>`)
    .join("\n");
  const psXml = `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>${permSetName}</label>
    <description>Field read for the CRMA Analytics Integration User. FLS only, no object CRUD.</description>
    <hasActivationRequired>false</hasActivationRequired>
${fieldXml}
</PermissionSet>`;
  const psDir = join(WAVE_DIR, "..", "permissionsets");
  mkdirSync(psDir, { recursive: true });
  writeFileSync(join(psDir, `${permSetName}.permissionset-meta.xml`), psXml);

  const args = ["project", "deploy", "start", "--metadata", `PermissionSet:${permSetName}`, "--target-org", TARGET_ORG];
  if (dry) args.push("--dry-run");
  let output;
  try {
    const { stdout } = await run("sf", args, { cwd: WORK_DIR });
    output = tail(stdout);
  } catch (e) {
    return { applied: false, dryRun: dry, permissionSet: permSetName, output: tail((e.stdout || "") + "\n" + (e.stderr || e.message)) };
  }
  if (dry) {
    return { applied: false, dryRun: true, permissionSet: permSetName, output: output + "\n(DRY RUN — set DEPLOY_DRY_RUN=false to actually grant + assign.)" };
  }

  // Assign the perm set to the Integration User.
  const users = await sfSoql(
    "SELECT Id FROM User WHERE Profile.Name='Analytics Cloud Integration User' AND IsActive=true LIMIT 1"
  );
  const uid = users[0]?.Id;
  const ps = await sfSoql(`SELECT Id FROM PermissionSet WHERE Name='${permSetName}' LIMIT 1`);
  const psid = ps[0]?.Id;
  if (uid && psid) {
    const exists = await sfSoql(`SELECT Id FROM PermissionSetAssignment WHERE PermissionSetId='${psid}' AND AssigneeId='${uid}'`);
    if (exists.length === 0) {
      await run("sf", ["data", "create", "record", "--sobject", "PermissionSetAssignment",
        "--values", `PermissionSetId=${psid} AssigneeId=${uid}`, "--target-org", TARGET_ORG]);
    }
    return { applied: true, dryRun: false, permissionSet: permSetName, output: output + `\nAssigned ${permSetName} to Integration User ${uid}.` };
  }
  return { applied: false, dryRun: false, permissionSet: permSetName, output: output + "\nDeployed but could not resolve Integration User / PermissionSet id to assign." };
}

// --- Metadata channel (scratch DX project) --------------------------------

// Lazily scaffold a one-time DX project the metadata commands run inside.
async function ensureProject() {
  if (existsSync(join(WORK_DIR, "sfdx-project.json"))) return;
  mkdirSync(PROJECT_ROOT, { recursive: true });
  try {
    await run("sf", ["project", "generate", "--name", ".sfdx-work", "--template", "empty"], { cwd: PROJECT_ROOT });
  } catch (e) {
    if (!existsSync(join(WORK_DIR, "sfdx-project.json"))) {
      throw new Error(`project generate failed: ${e.stderr || e.message}`);
    }
  }
}

/** Retrieve a recipe or dashboard's definition JSON from the org. */
export async function metadataRetrieve(type, fullName) {
  requireOrg();
  await ensureProject();
  await run("sf", ["project", "retrieve", "start", "--metadata", `${type}:${fullName}`, "--target-org", TARGET_ORG], { cwd: WORK_DIR });
  const ext = type === "WaveRecipe" ? "wdpr" : "wdash";
  const file = join(WAVE_DIR, `${fullName}.${ext}`);
  const meta = join(WAVE_DIR, `${fullName}.${ext}-meta.xml`);
  return {
    definition: JSON.parse(readFileSync(file, "utf8")),
    metaXml: existsSync(meta) ? readFileSync(meta, "utf8") : null,
    file,
    metaFile: meta,
  };
}

/**
 * Write a recipe/dashboard definition back and deploy it.
 * Honors DEPLOY_DRY_RUN — when true, runs `--dry-run` (validation only).
 * @returns {{deployed:boolean, dryRun:boolean, output:string}}
 */
export async function metadataDeploy(type, fullName, definitionObj, metaXml) {
  requireOrg();
  await ensureProject();
  mkdirSync(WAVE_DIR, { recursive: true });
  const ext = type === "WaveRecipe" ? "wdpr" : "wdash";
  const obj = typeof definitionObj === "string" ? JSON.parse(definitionObj) : definitionObj;
  writeFileSync(join(WAVE_DIR, `${fullName}.${ext}`), JSON.stringify(obj));
  if (metaXml) writeFileSync(join(WAVE_DIR, `${fullName}.${ext}-meta.xml`), metaXml);

  const args = ["project", "deploy", "start", "--metadata", `${type}:${fullName}`, "--target-org", TARGET_ORG];
  if (DRY_RUN) args.push("--dry-run");
  try {
    const { stdout } = await run("sf", args, { cwd: WORK_DIR });
    return { deployed: !DRY_RUN, dryRun: DRY_RUN, output: tail(stdout) };
  } catch (e) {
    return { deployed: false, dryRun: DRY_RUN, output: tail((e.stdout || "") + "\n" + (e.stderr || e.message)) };
  }
}

// --- Dataset field metadata ---------------------------------------------------

/**
 * Return dimension + measure field names for a CRMA dataset, along with
 * its current row count. Used by the diagnose-dashboard and get-dataset-fields
 * tools to validate SAQL field references without running a query.
 */
export async function getDatasetFieldMeta(datasetName) {
  const ds = await sfRestGet(`/wave/datasets/${datasetName}`);
  const id = ds.id;
  const verId = ds.currentVersionId;
  if (!id || !verId) throw new Error(`Dataset "${datasetName}" not found or has no current version.`);

  let dimensions = [];
  let measures = [];
  let rowCount = null;

  try {
    const xmd = await sfRestGet(`/wave/datasets/${id}/versions/${verId}/xmd/main`);
    dimensions = (xmd.dimensions || []).map((d) => ({ name: d.field, label: d.label || d.field }));
    measures   = (xmd.measures   || []).map((m) => ({ name: m.field, label: m.label || m.field }));
  } catch {
    // XMD unavailable — dataset may be empty or still loading
  }

  try {
    const ver = await sfRestGet(`/wave/datasets/${id}/versions/${verId}`);
    rowCount = ver.totalRows ?? null;
  } catch {
    // version detail unavailable
  }

  return { datasetName, datasetId: id, versionId: verId, rowCount, dimensions, measures };
}

// --- Replication check -------------------------------------------------------
// A recipe can only load data from objects that have replication enabled on the
// SFDC_LOCAL connector. Without it, the run fails with "Object with name X and
// connection SFDC_LOCAL has not setup replication". The REST API only exposes
// read-only access to this — enablement requires the Data Manager UI.

/**
 * Check whether each source object in a recipe has replication enabled.
 * @param {string[]} objectNames Array of Salesforce object API names.
 * @returns {Promise<{connectorId:string|null, results:Array<{object:string,replicated:boolean}>, unreplicated:string[]}>}
 */
export async function checkReplicationStatus(objectNames) {
  const connectors = await sfRestGet("/wave/dataConnectors");
  const local = (connectors.dataConnectors || []).find(
    (c) => c.connectorType === "SfdcLocal" || c.name === "SFDC_LOCAL"
  );
  if (!local) {
    return { connectorId: null, results: objectNames.map((o) => ({ object: o, replicated: false })), unreplicated: objectNames };
  }
  const results = [];
  const unreplicated = [];
  for (const obj of objectNames) {
    try {
      const so = await sfRestGet(`/wave/dataConnectors/${local.id}/sourceObjects/${obj}`);
      const rep = so.replicated === true;
      results.push({ object: obj, replicated: rep });
      if (!rep) unreplicated.push(obj);
    } catch {
      results.push({ object: obj, replicated: false });
      unreplicated.push(obj);
    }
  }
  return { connectorId: local.id, results, unreplicated };
}

function tail(s, n = 1200) {
  return String(s).slice(-n);
}

/** List existing metadata full-names of a type in the scratch project (post-retrieve). */
export function listLocalWave() {
  if (!existsSync(WAVE_DIR)) return [];
  return readdirSync(WAVE_DIR).filter((f) => f.endsWith(".wdpr") || f.endsWith(".wdash"));
}
