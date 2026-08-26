// ask.mjs — one-shot: pass a single instruction, print the answer.
// Run:  npm run ask -- "list my recipes"
import { copilot } from "./mastra/agents/copilot.mjs";

const q = process.argv.slice(2).join(" ") || "List the recipes in the org.";
// Opus/Sonnet on the gateway only accept temperature=1 (they reject 0).
const res = await copilot.generate([{ role: "user", content: q }], { maxSteps: 50, temperature: 1 });
console.log("\n" + res.text + "\n");
