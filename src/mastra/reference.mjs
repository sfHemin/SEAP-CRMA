// reference.mjs — a tiny, zero-dependency RAG index over the CRMA docs.
// ---------------------------------------------------------------------------
// The folder "CRMA MASTRA reference" (sibling of this project on the Desktop)
// holds Salesforce's own reference material: SAQL statements/functions, recipe
// REST resources, dashboard/step/widget/gridlayout JSON shapes, filter shapes,
// and interaction/binding docs. These are large (SAQL Functions alone is ~78KB)
// so we DON'T stuff them into the agent's system prompt. Instead the agent
// RETRIEVES on demand: search-reference to find the right doc + snippet, then
// read-reference to pull the full text when it needs the details.
//
// Design goals:
//   - No new npm deps. Pure Node fs + a small TF-style keyword scorer.
//   - Built lazily and cached: first search reads + chunks every text file once.
//   - Robust to the folder moving: RAG_REFERENCE_DIR env overrides the path.
//   - Never crashes the agent if the folder is missing — returns empty results
//     with a clear note so the agent can fall back to its own knowledge.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The reference folder lives next to the "CRMA Mastra" project:
//   .../Desktop/CRMA Assets/CRMA MASTRA reference
// From here (…/CRMA Mastra/src/mastra) that's four levels up + the folder.
// Default: reference/ folder inside the project root (CRMA Mastra/reference/).
// Falls back to the legacy sibling path (../../../CRMA MASTRA reference) if not found.
const _inProject = join(HERE, "..", "..", "reference");
const _legacy = join(HERE, "..", "..", "..", "CRMA MASTRA reference");
const { existsSync: _ex } = await import("node:fs");
const DEFAULT_DIR = _ex(_inProject) ? _inProject : _legacy;
export const REFERENCE_DIR = process.env.RAG_REFERENCE_DIR || DEFAULT_DIR;

// Only index human/text/JSON docs — never binaries or images.
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".db", ".zip"]);
const STOP = new Set(
  ("the a an and or of to in for on with is are be as by at from this that these those " +
   "you your it its if then else use used using can will not no yes see also how what when " +
   "which who where why into out over under more most such per each any all some other").split(" ")
);

let INDEX = null; // [{ path, label, section, text, tokens: Map<term,count>, len }]

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { walk(full, acc); continue; }
    if (SKIP_EXT.has(extname(e.name).toLowerCase())) continue;
    try { if (statSync(full).size > 2 * 1024 * 1024) continue; } catch { continue; }
    acc.push(full);
  }
  return acc;
}

function tokenize(s) {
  return String(s).toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
}

function firstMeaningfulLine(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^#+\s*/, "").trim();
    if (line.length >= 3) return line.slice(0, 120);
  }
  return "";
}

/** Build (once) the in-memory index of every reference doc. */
function buildIndex() {
  if (INDEX) return INDEX;
  INDEX = [];
  if (!existsSync(REFERENCE_DIR)) return INDEX;
  for (const file of walk(REFERENCE_DIR)) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (!text.trim()) continue;
    const rel = relative(REFERENCE_DIR, file);
    const section = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "(root)";
    const toks = tokenize(text);
    const tf = new Map();
    for (const t of toks) if (!STOP.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    INDEX.push({ path: rel, label: firstMeaningfulLine(text), section, text, tokens: tf, len: toks.length });
  }
  return INDEX;
}

/** A short context window around the best-matching query term in a doc. */
function bestSnippet(text, queryTerms) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of queryTerms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, 240).replace(/\s+/g, " ").trim();
  const start = Math.max(0, at - 120);
  return (start > 0 ? "…" : "") + text.slice(start, at + 240).replace(/\s+/g, " ").trim() + "…";
}

/**
 * Search the reference corpus. Returns the top-N docs by a simple TF score
 * (sum of query-term frequencies, length-normalized, with a small bonus for
 * matches in the file path/label so "widget json" finds the Widget doc).
 */
export function searchReference(query, limit = 6) {
  const idx = buildIndex();
  if (idx.length === 0) {
    return { available: false, dir: REFERENCE_DIR, results: [],
      note: "Reference folder not found. Set RAG_REFERENCE_DIR or fall back to built-in knowledge." };
  }
  const terms = [...new Set(tokenize(query).filter((t) => !STOP.has(t)))];
  if (terms.length === 0) return { available: true, dir: REFERENCE_DIR, results: [] };

  const scored = idx.map((doc) => {
    let score = 0;
    const pathL = doc.path.toLowerCase(), labelL = doc.label.toLowerCase();
    for (const t of terms) {
      const tf = doc.tokens.get(t) || 0;
      if (tf) score += tf / Math.sqrt(doc.len || 1);          // length-normalized TF
      if (pathL.includes(t)) score += 2.5;                    // title/path match is a strong signal
      if (labelL.includes(t)) score += 1.5;
    }
    return { doc, score };
  }).filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    available: true,
    dir: REFERENCE_DIR,
    results: scored.map(({ doc, score }) => ({
      path: doc.path,
      section: doc.section,
      label: doc.label,
      score: Number(score.toFixed(3)),
      chars: doc.text.length,
      snippet: bestSnippet(doc.text, terms),
    })),
  };
}

/** Return the full text of one reference doc by its path (as returned by search). */
export function readReference(path) {
  const idx = buildIndex();
  // Accept exact rel path, a suffix match, or a basename match — the agent may
  // pass any of these back from a search result.
  const wanted = String(path).replace(/^\.?\//, "");
  let doc =
    idx.find((d) => d.path === wanted) ||
    idx.find((d) => d.path.toLowerCase() === wanted.toLowerCase()) ||
    idx.find((d) => d.path.toLowerCase().endsWith("/" + wanted.toLowerCase())) ||
    idx.find((d) => d.path.split("/").pop().toLowerCase() === wanted.toLowerCase());
  if (!doc) {
    return { found: false, path: wanted, text: "",
      note: `No reference doc matches "${path}". Use search-reference first and pass back its exact path.` };
  }
  return { found: true, path: doc.path, section: doc.section, label: doc.label, chars: doc.text.length, text: doc.text };
}

/** A compact catalog of everything indexed (path + section + label + size). */
export function listReference() {
  const idx = buildIndex();
  return {
    available: idx.length > 0,
    dir: REFERENCE_DIR,
    count: idx.length,
    docs: idx.map((d) => ({ path: d.path, section: d.section, label: d.label, chars: d.text.length }))
             .sort((a, b) => a.path.localeCompare(b.path)),
  };
}
