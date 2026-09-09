// restTools.mjs — Phase 2: read-only REST/SOQL improviser.
// ---------------------------------------------------------------------------
// `wave-rest-get` lets the agent answer NOVEL, one-off questions that have no
// pre-built tool ("how many datasets over 100MB", "list dashboards not modified
// in 6 months", "what dataspaces exist", "org limits") by issuing a single
// **read-only** Salesforce/Wave REST GET — instead of stopping or delegating.
//
// SAFETY (enforced in CODE, not just the prompt):
//   1. GET ONLY. This tool has no `method` input and only ever calls sfRestGet,
//      which shells `sf api request rest <path>` with NO --method flag → GET.
//      There is no reachable code path that POSTs/PATCHes/PUTs/DELETEs. Writes
//      still go exclusively through the gated recipe/dashboard deploy tools.
//   2. PATH ALLOWLIST. The resource must match an allowlisted prefix
//      (/wave/*, /query, /queryAll, /tooling/query, /limits). Anything else —
//      including /sobjects/.../  DML-ish or apex paths — is hard-rejected.
//   3. SIZE CAP. Large arrays in the response are truncated to `limit` with an
//      explicit note (never silently). No unbounded dumps into context.
//   4. RATE CAP. A per-process call counter caps total GETs so a loop can't
//      hammer the org; the cap is surfaced, not silent.
//
// `run-soql` already covers SELECTs; this widens READ coverage to the rest of
// the Wave/analytics REST surface without opening any write path.
// ---------------------------------------------------------------------------

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sfRestGet } from "../sf.mjs";

// Allowlisted resource prefixes (checked against the NORMALIZED path — i.e.
// after any leading /services/data/vXX is stripped). Read-only surfaces only.
export const ALLOW_PREFIXES = [
  "/wave/",        // all CRM Analytics / Wave read resources (datasets, recipes,
                   // dashboards, lenses, apps, folders, dataflowjobs, dataConnectors,
                   // templates, dataspaces, xmd, …) — GETs are read-only
  "/query",        // SOQL over REST: /query?q=SELECT+... (also matches /queryAll)
  "/tooling/query",// Tooling API SOQL (e.g. metadata about assets)
  "/limits",       // org limits — read-only
];

const MAX_CALLS_PER_SESSION = 200; // rate backstop; surfaced, never silent
let CALLS = 0;

/**
 * Normalize a caller-supplied path to the bare resource path used for the
 * allowlist check. Accepts both "/wave/datasets" and a fully-qualified
 * "/services/data/v62.0/wave/datasets" (the /services/data/vXX prefix is
 * stripped, since sfRestGet re-adds it for bare paths).
 */
export function normalizeResource(raw) {
  let p = String(raw || "").trim();
  if (!p) return "";
  if (!p.startsWith("/")) p = "/" + p;
  const m = p.match(/^\/services\/data\/v[0-9.]+/i);
  if (m) p = p.slice(m[0].length) || "/";
  return p;
}

/**
 * Decide whether a path is an allowed read-only resource.
 * Returns { ok, resource, reason }. Pure — safe to unit-test offline.
 */
export function checkPath(raw) {
  const resource = normalizeResource(raw);
  if (!resource || resource === "/") {
    return { ok: false, resource, reason: "Empty path. Provide a resource like '/wave/datasets'." };
  }
  // Defence in depth: this tool is GET-only, but reject anything that even
  // looks like it targets a mutation/exec surface, so a bad path fails loudly.
  const lower = resource.toLowerCase();
  const banned = ["/apexrest", "/actions/", "/composite/", "/tooling/sobjects/", "/tooling/executeanonymous"];
  if (banned.some((b) => lower.startsWith(b))) {
    return { ok: false, resource, reason: `Path '${resource}' targets a non-read surface and is blocked.` };
  }
  const prefixOk = ALLOW_PREFIXES.some((pre) =>
    lower === pre || lower === pre.replace(/\/$/, "") || lower.startsWith(pre)
  );
  if (!prefixOk) {
    return {
      ok: false,
      resource,
      reason: `Path '${resource}' is not on the read-only allowlist. Allowed prefixes: ${ALLOW_PREFIXES.join(", ")}.`,
    };
  }
  return { ok: true, resource, reason: "" };
}

/**
 * Truncate large arrays in a response to `limit` items, recording what was cut.
 * Handles both a top-level array and object-with-array-properties (the common
 * Wave shape: { recipes:[…] }, { datasets:[…] }, { records:[…] }).
 */
export function capResult(data, limit) {
  const notes = [];
  if (Array.isArray(data)) {
    if (data.length > limit) {
      notes.push(`array: returned first ${limit} of ${data.length} items (capped)`);
      return { data: data.slice(0, limit), notes };
    }
    return { data, notes };
  }
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length > limit) {
        data[k] = v.slice(0, limit);
        notes.push(`${k}: returned first ${limit} of ${v.length} items (capped)`);
      }
    }
  }
  return { data, notes };
}

export const waveRestGet = createTool({
  id: "wave-rest-get",
  description:
    "READ-ONLY. Issue a single Salesforce/Wave REST **GET** to answer a novel, one-off question that has " +
    "no dedicated tool — e.g. 'how many datasets and their sizes', 'list dataspaces', 'apps/folders', " +
    "'dataflow job history', 'org limits', or a Tooling/REST SOQL. This tool CANNOT write: it only ever " +
    "performs GET, and the path must be on the read-only allowlist (/wave/*, /query, /queryAll, " +
    "/tooling/query, /limits) — anything else is rejected. Large arrays are truncated to `limit` with a " +
    "note. Prefer the specific tools (list-recipes/get-recipe/get-dataset-fields/run-soql/build-asset-graph) " +
    "when one fits; reach for this only for questions those don't cover. For plain SELECTs use run-soql. " +
    "Pass the path only (e.g. '/wave/datasets?pageSize=200'); do NOT include /services/data/vXX.",
  inputSchema: z.object({
    path: z.string().describe(
      "REST resource path, e.g. '/wave/datasets?pageSize=200', '/wave/dataflowjobs?pageSize=50', " +
      "'/wave/dataspaces', '/limits', or '/tooling/query?q=SELECT+Id+FROM+WaveDataset'. " +
      "Leading /services/data/vXX is optional (stripped automatically)."
    ),
    limit: z.number().optional().describe("Max items to keep from any array in the response (default 50, max 500)."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    resource: z.string(),
    data: z.any().optional(),
    truncated: z.boolean(),
    notes: z.array(z.string()),
    error: z.string().optional(),
  }),
  execute: async (context) => {
    const check = checkPath(context.path);
    if (!check.ok) {
      // Hard block — surfaced as a normal (non-throwing) rejection so the agent
      // can read the reason and choose a different, allowed path.
      return { ok: false, resource: check.resource, truncated: false, notes: [], error: check.reason };
    }
    if (CALLS >= MAX_CALLS_PER_SESSION) {
      return {
        ok: false, resource: check.resource, truncated: false, notes: [],
        error: `Rate cap reached (${MAX_CALLS_PER_SESSION} GETs this session). Restart the session to reset.`,
      };
    }
    const limit = Math.min(Math.max(Number(context.limit) || 50, 1), 500);
    try {
      CALLS += 1;
      // sfRestGet issues GET only (no --method flag) and accepts the bare path.
      const raw = await sfRestGet(check.resource);
      const { data, notes } = capResult(raw, limit);
      if (CALLS >= Math.floor(MAX_CALLS_PER_SESSION * 0.9)) {
        notes.push(`Approaching rate cap: ${CALLS}/${MAX_CALLS_PER_SESSION} GETs used this session.`);
      }
      return { ok: true, resource: check.resource, data, truncated: notes.length > 0, notes };
    } catch (e) {
      return { ok: false, resource: check.resource, truncated: false, notes: [], error: String(e?.message || e) };
    }
  },
});

// Test hooks (unit tests reset the session counter without touching an org).
export function _resetCalls() { CALLS = 0; }
export function _getCalls() { return CALLS; }

export const restTools = { waveRestGet };
