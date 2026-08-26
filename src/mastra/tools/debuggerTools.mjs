// debuggerTools.mjs — delegation tool that lets the copilot hand off to the
// CRMA Debugger sub-agent. The debugger runs independently (Opus model, full
// tool access, exhaustive investigation protocol) and returns a structured fix
// plan. The copilot presents that plan, gets user approval, then applies it.
// ---------------------------------------------------------------------------

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { debugger_ } from "../agents/debugger.mjs";

export const delegateToDebugger = createTool({
  id: "delegate-to-debugger",
  description:
    "Hand off a hard debugging problem to the CRMA Debugger specialist (Opus model). " +
    "Use this when you cannot resolve a recipe or dashboard error after one attempt, or when " +
    "diagnose-dashboard returns multiple errors you are not sure how to prioritise. " +
    "Pass everything you know: the asset name, the error message, any tool outputs you already " +
    "collected. The debugger investigates independently and returns a structured fix plan.",
  inputSchema: z.object({
    assetType: z.enum(["recipe", "dashboard"]).describe("Whether the problem is in a recipe or a dashboard"),
    assetName: z.string().describe("The metadata API name of the recipe or dashboard"),
    symptom: z.string().describe("What the user reported or what error message was returned"),
    context: z.string().optional().describe(
      "Any extra context you already gathered: tool outputs, error messages, definition excerpts. " +
      "The debugger cannot see the parent conversation — include everything relevant here."
    ),
  }),
  outputSchema: z.object({
    report: z.string().describe("The debugger's full Debug Report (root cause, evidence, fix plan, verification)"),
  }),
  execute: async (input) => {
    const task = [
      `Asset type: ${input.assetType}`,
      `Asset name: ${input.assetName}`,
      `Symptom: ${input.symptom}`,
      input.context ? `Context from copilot:\n${input.context}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await debugger_.generate([{ role: "user", content: task }]);
    return { report: result.text };
  },
});

export const debuggerTools = { delegateToDebugger };
