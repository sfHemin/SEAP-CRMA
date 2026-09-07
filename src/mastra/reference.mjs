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
//   - Large files (>20KB) are split into overlapping chunks so a keyword in the
//     middle of an 8000-line doc is actually findable. Each chunk is a separate
//     index entry with a virtual path "file#chunk-N". read-reference on the
//     original path returns the full text; read-reference on a chunk path returns
//     just that chunk so the agent can read it without consuming huge context.
//   - Robust to the folder moving: RAG_REFERENCE_DIR env overrides the path.
//   - Never crashes the agent if the folder is missing — returns empty results
//     with a clear note so the agent can fall back to its own knowledge.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync, existsSync, appendFileSync } from "node:fs";
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

let INDEX = null; // [{ path, label, section, text, tokens: Map<term,count>, len, chunkOf? }]

// Files larger than this are split into overlapping chunks for better search precision.
const CHUNK_THRESHOLD = 20 * 1024;   // 20 KB
const CHUNK_SIZE      = 8 * 1024;    // ~8 KB per chunk
const CHUNK_OVERLAP   = 1 * 1024;    // 1 KB overlap between chunks

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

function makeEntry(path, label, section, text, chunkOf = null) {
  const toks = tokenize(text);
  const tf = new Map();
  for (const t of toks) if (!STOP.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
  return { path, label, section, text, tokens: tf, len: toks.length, chunkOf };
}

/**
 * Split a large text into overlapping character-boundary chunks.
 * Tries to break at newlines so chunks start at clean line boundaries.
 */
function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    // snap forward to next newline so chunks start cleanly
    if (end < text.length) {
      const nl = text.indexOf("\n", end);
      if (nl >= 0 && nl - end < 200) end = nl + 1;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
    // snap start back to previous newline
    const prevNl = text.lastIndexOf("\n", start);
    if (prevNl >= 0 && start - prevNl < 200) start = prevNl + 1;
  }
  return chunks;
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

    if (text.length > CHUNK_THRESHOLD) {
      // Large file — index as overlapping chunks for precise retrieval.
      // Also keep the full-text entry (chunkOf=null) so read-reference still works.
      INDEX.push(makeEntry(rel, firstMeaningfulLine(text), section, text, null));
      const chunks = chunkText(text);
      chunks.forEach((chunk, i) => {
        const chunkPath = `${rel}#chunk-${i + 1}of${chunks.length}`;
        const chunkLabel = `${firstMeaningfulLine(chunk)} [${rel} chunk ${i + 1}/${chunks.length}]`;
        INDEX.push(makeEntry(chunkPath, chunkLabel, section, chunk, rel));
      });
    } else {
      INDEX.push(makeEntry(rel, firstMeaningfulLine(text), section, text, null));
    }
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
 * Chunks of large files score independently — a chunk that densely matches
 * beats the whole-file entry, so the agent reads a targeted slice rather than
 * a 200KB document.
 * Whole-file entries for chunked files are suppressed in results when a chunk
 * of that same file already ranks in the top results (avoids duplicates).
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
      if (tf) score += tf / Math.sqrt(doc.len || 1);   // length-normalized TF
      if (pathL.includes(t)) score += 2.5;             // path match strong signal
      if (labelL.includes(t)) score += 1.5;
    }
    return { doc, score };
  }).filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Suppress whole-file entries when a chunk of the same file already appears
  // in the top results — the chunk is more targeted.
  const chunkParentsInTop = new Set(
    scored.slice(0, limit * 2)
      .filter(s => s.doc.chunkOf)
      .map(s => s.doc.chunkOf)
  );
  const filtered = scored
    .filter(s => !(s.doc.chunkOf === null && chunkParentsInTop.has(s.doc.path)))
    .slice(0, limit);

  return {
    available: true,
    dir: REFERENCE_DIR,
    results: filtered.map(({ doc, score }) => ({
      path: doc.path,
      section: doc.section,
      label: doc.label,
      score: Number(score.toFixed(3)),
      chars: doc.text.length,
      isChunk: !!doc.chunkOf,
      fullDocPath: doc.chunkOf || doc.path,
      snippet: bestSnippet(doc.text, terms),
    })),
  };
}

/**
 * Return the text of a reference doc (or chunk) by its path.
 * - Pass the exact path from a search result to get the chunk text.
 * - Pass the base file path (no #chunk) to get the full document text.
 * Accepts exact path, suffix match, or basename match.
 */
export function readReference(path) {
  const idx = buildIndex();
  const wanted = String(path).replace(/^\.?\//, "");
  let doc =
    idx.find((d) => d.path === wanted) ||
    idx.find((d) => d.path.toLowerCase() === wanted.toLowerCase()) ||
    idx.find((d) => d.path.toLowerCase().endsWith("/" + wanted.toLowerCase())) ||
    idx.find((d) => d.path.split("/").pop().toLowerCase() === wanted.toLowerCase().replace(/#.*$/, ""));
  if (!doc) {
    return { found: false, path: wanted, text: "",
      note: `No reference doc matches "${path}". Use search-reference first and pass back its exact path.` };
  }
  return {
    found: true,
    path: doc.path,
    section: doc.section,
    label: doc.label,
    chars: doc.text.length,
    isChunk: !!doc.chunkOf,
    fullDocPath: doc.chunkOf || doc.path,
    text: doc.text,
  };
}

/**
 * Self-healing: append a VERIFIED pattern note to the cheat-sheet and invalidate
 * the in-memory index so the note is immediately searchable this session.
 * category "recipe" → "Recipe node cheat-sheet"; "dashboard" → "CRMA_BUILD_KNOWLEDGE.md".
 * Robust: if the target file is absent, writes to a VERIFIED-PATTERNS.md fallback.
 */
export function writeReferenceNote(title, note, category = "recipe") {
  const fileName = category === "dashboard" ? "CRMA_BUILD_KNOWLEDGE.md" : "Recipe node cheat-sheet";
  let target = join(REFERENCE_DIR, fileName);
  if (!existsSync(target)) target = join(REFERENCE_DIR, "VERIFIED-PATTERNS.md");
  const block = `\n\n---\n## VERIFIED PATTERN — ${title}\n${note}\n`;
  try {
    appendFileSync(target, block, "utf8");
    INDEX = null; // invalidate cache so the new note is searchable immediately
    return { written: true, file: relative(REFERENCE_DIR, target) };
  } catch (e) {
    return { written: false, file: fileName, note: `Failed to write: ${e.message}` };
  }
}

/**
 * A compact catalog of everything indexed.
 * Chunks are omitted from the listing to keep it readable — they surface via search.
 */
export function listReference() {
  const idx = buildIndex();
  const wholeDocs = idx.filter((d) => !d.chunkOf);
  const chunkedFiles = new Set(idx.filter(d => d.chunkOf).map(d => d.chunkOf));
  return {
    available: wholeDocs.length > 0,
    dir: REFERENCE_DIR,
    count: wholeDocs.length,
    chunkedFiles: [...chunkedFiles].sort(),
    docs: wholeDocs
      .map((d) => ({
        path: d.path,
        section: d.section,
        label: d.label,
        chars: d.text.length,
        chunked: chunkedFiles.has(d.path),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}
