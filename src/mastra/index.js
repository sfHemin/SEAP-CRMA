// index.js — Mastra instance. `mastra dev` (Studio) discovers this export.
// ---------------------------------------------------------------------------
// Registers the CRMA Copilot agent + a logger. Storage is left as Mastra's
// default in-memory store for this local demo tool (Studio prints a note that
// it isn't durable — fine here; nothing needs to survive a restart). For a
// shared/prod deployment, add a storage adapter, e.g.:
//   import { LibSQLStore } from "@mastra/libsql";
//   storage: new LibSQLStore({ id: "crma", url: "file:crma.db" })
// (or @mastra/pg for Postgres).
// ---------------------------------------------------------------------------

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { copilot } from "./agents/copilot.mjs";
import { debugger_ } from "./agents/debugger.mjs";

// Same absolute DB the agent's Memory uses (see copilot.mjs) so Studio's own
// storage and the agent's memory point at one file regardless of cwd.
const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DB_URL = "file:" + join(HERE, "crma-memory.db"); // …/src/mastra/crma-memory.db

export const mastra = new Mastra({
  agents: { copilot, debugger: debugger_ },
  storage: new LibSQLStore({ id: "crma", url: MEMORY_DB_URL }),
  logger: new PinoLogger({ name: "crma-copilot", level: "info" }),
});
