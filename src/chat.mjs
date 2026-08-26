// chat.mjs — a simple terminal chat loop for the CRMA Copilot.
// Run:  npm run chat
// Keeps conversation history so multi-step tool use (get → edit → validate →
// deploy) works across turns. Type 'exit' to quit.
import readline from "node:readline";
import { copilot } from "./mastra/agents/copilot.mjs";
import { ACTIVE_PROVIDER } from "./mastra/models.mjs";
import { TARGET_ORG, DRY_RUN } from "./mastra/sf.mjs";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let closed = false;
rl.on("close", () => (closed = true));
const ask = (q) =>
  new Promise((res) => {
    if (closed) return res("exit");
    rl.question(q, res);
  });

console.log("");
console.log("  ┌─────────────────────────────────────────────┐");
console.log("  │  CRMA Copilot (Mastra)                        │");
console.log(`  │  provider: ${ACTIVE_PROVIDER.padEnd(10)} org: ${(TARGET_ORG || "—").padEnd(14)}│`);
console.log(`  │  deploy:   ${(DRY_RUN ? "DRY-RUN (safe)" : "LIVE WRITE").padEnd(33)}│`);
console.log("  └─────────────────────────────────────────────┘");
console.log("  Ask me to list/get/edit/debug/create/deploy recipes & dashboards. 'exit' to quit.\n");

const messages = [];
while (true) {
  const input = (await ask("you › ")).trim();
  if (closed && !input) break;
  if (!input) continue;
  if (input.toLowerCase() === "exit") break;
  messages.push({ role: "user", content: input });
  try {
    // Opus/Sonnet on the gateway only accept temperature=1 (they reject 0).
    const res = await copilot.generate(messages, { maxSteps: 50, temperature: 1 });
    console.log("\ncopilot › " + res.text + "\n");
    messages.push({ role: "assistant", content: res.text });
  } catch (e) {
    console.log("\n[error] " + (e.message || e) + "\n");
  }
}
rl.close();
