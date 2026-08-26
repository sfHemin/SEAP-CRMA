// referenceTools.mjs — RAG tools over the CRMA MASTRA reference docs.
// ---------------------------------------------------------------------------
// The agent uses these to LOOK UP the authoritative Salesforce reference (SAQL
// statements/functions, recipe REST resources, dashboard/step/widget/gridlayout
// JSON shapes, filter shapes, interactions/bindings) *only when it needs to* —
// e.g. before writing a non-trivial SAQL query, composing a widget/step, or
// debugging a shape it's unsure about. It is NOT meant for every turn: the agent
// already knows the common shapes (baked into its instructions). This is the
// deeper "when in doubt, check the manual" retrieval layer.
// ---------------------------------------------------------------------------

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchReference, readReference, listReference } from "../reference.mjs";

// ---- search ---------------------------------------------------------------
export const searchReferenceTool = createTool({
  id: "search-reference",
  description:
    "Search the CRMA reference library (SAQL statements & functions, recipe REST API resources, dashboard/" +
    "step/widget/gridlayout JSON shapes, filter shapes, interactions & bindings) for docs relevant to a query. " +
    "Use this WHEN IN DOUBT about exact syntax or a JSON shape — e.g. before writing a non-trivial SAQL query, " +
    "composing a widget/step/binding, or debugging an unfamiliar structure. Returns the top matching docs with " +
    "a path, label, and snippet. Then call read-reference with a returned path to read the full doc. " +
    "You do NOT need this for the common recipe/dashboard shapes already in your instructions.",
  inputSchema: z.object({
    query: z.string().describe("What you're looking for, e.g. 'SAQL cogroup syntax' or 'chart widget columnMap'"),
    limit: z.number().optional().describe("Max docs to return (default 6)."),
  }),
  outputSchema: z.object({
    available: z.boolean(),
    dir: z.string(),
    results: z.array(z.object({
      path: z.string(),
      section: z.string(),
      label: z.string(),
      score: z.number(),
      chars: z.number(),
      snippet: z.string(),
    })),
    note: z.string().optional(),
  }),
  execute: async (context) => searchReference(context.query, context.limit || 6),
});

// ---- read -----------------------------------------------------------------
export const readReferenceTool = createTool({
  id: "read-reference",
  description:
    "Read the FULL text of one CRMA reference doc by its path (as returned by search-reference). " +
    "Use after search-reference when a snippet looks right and you need the complete syntax/shape/examples.",
  inputSchema: z.object({
    path: z.string().describe("The doc path from a search result, e.g. 'SAQL/SAQL Statement.md' or 'Widget json'."),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    path: z.string(),
    section: z.string().optional(),
    label: z.string().optional(),
    chars: z.number().optional(),
    text: z.string(),
    note: z.string().optional(),
  }),
  execute: async (context) => readReference(context.path),
});

// ---- list (catalog) -------------------------------------------------------
export const listReferenceTool = createTool({
  id: "list-reference",
  description:
    "List the catalog of available CRMA reference docs (path + section + label + size). " +
    "Use to see what reference material exists before searching, or to browse a section like SAQL or 'Interaction and bindings'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    available: z.boolean(),
    dir: z.string(),
    count: z.number(),
    docs: z.array(z.object({ path: z.string(), section: z.string(), label: z.string(), chars: z.number() })),
  }),
  execute: async () => listReference(),
});

export const referenceTools = {
  searchReference: searchReferenceTool,
  readReference: readReferenceTool,
  listReference: listReferenceTool,
};
