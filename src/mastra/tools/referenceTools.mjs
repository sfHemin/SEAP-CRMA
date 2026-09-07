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
import { searchReference, readReference, listReference, writeReferenceNote } from "../reference.mjs";

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
      isChunk: z.boolean().optional(),
      fullDocPath: z.string().optional(),
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
    isChunk: z.boolean().optional(),
    fullDocPath: z.string().optional(),
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

// ---- write (self-healing) -------------------------------------------------
export const writeReferenceTool = createTool({
  id: "write-reference",
  description:
    "Append a VERIFIED pattern note to the recipe/dashboard cheat-sheet after you successfully " +
    "deployed+ran an asset using a shape that was previously unclear or that you had to debug. " +
    "This is the self-healing loop: record what worked so the next build finds it instantly. " +
    "Only call this AFTER a confirmed successful deploy/run — never for unverified guesses. " +
    "Keep the note short and concrete (the exact JSON key/value that fixed it).",
  inputSchema: z.object({
    title: z.string().describe("Short pattern title, e.g. 'LEFT_OUTER join on composite keys'."),
    note: z.string().describe("The verified working shape — exact JSON keys/values + one line of when to use it."),
    category: z.enum(["recipe", "dashboard"]).describe("Which cheat-sheet to append to."),
  }),
  outputSchema: z.object({
    written: z.boolean(),
    file: z.string(),
    note: z.string().optional(),
  }),
  execute: async (context) => writeReferenceNote(context.title, context.note, context.category),
});

export const referenceTools = {
  searchReference: searchReferenceTool,
  readReference: readReferenceTool,
  listReference: listReferenceTool,
  writeReference: writeReferenceTool,
};
