# HOW THE AGENT'S RAG WORKS — and how to add docs so they are NEVER missed

> **Read this before adding, moving, or deleting anything in `reference/`.**
> Purpose: the agent (CRMA Copilot) grounds its recipe/dashboard authoring in the
> files under this `reference/` folder. This doc explains exactly how a file gets
> into the agent's consideration, the ONE way a good doc can still be "missed,"
> and the checklist that prevents it.

Concepts covered (keywords for search): RAG retrieval, reference library, indexing,
search-reference, read-reference, list-reference, add new reference doc, discoverability,
keyword search, TF scoring, chunking, how agent finds docs, template recipe tokens.

---

## 1. The short version (TL;DR)

- **Auto-discovery is real.** Drop any `.md` / `.json` / text file *anywhere* under
  `reference/` (any depth of subfolder) and it is indexed automatically. **No manifest,
  no registration, no code change.** Verified by running the live index.
- **You do NOT need to "point" the agent at a file.** There is no allow-list. The
  indexer walks the whole tree. Instruction/doc citations (e.g. `read-reference "Org
  examples/..."`) are *hints*, not gates — the agent also finds files it was never told about.
- **The only way a good doc gets missed:** search is **keyword-based**, not semantic.
  A file is findable *only by the literal words it contains or its filename/path.*
  If the concept is worded differently than the doc's text, search won't surface it.
  → Fix = the **Add-a-doc checklist** in §5 (front-load concept keywords). One rule, no code.
- **Binaries & huge files are skipped:** `.png .jpg .jpeg .gif .webp .pdf .db .zip`,
  and any file **> 2 MB**. Everything else is indexed.

---

## 2. Where the corpus lives (path resolution)

`src/mastra/reference.mjs` resolves the folder in this order:

1. `RAG_REFERENCE_DIR` env var, if set (absolute path override).
2. else **in-repo `./reference`** (this folder) — the default, ships committed.
3. else legacy sibling `../../../CRMA MASTRA reference` (fallback only).

For the handoff, `.env` leaves `RAG_REFERENCE_DIR` commented out, so it auto-resolves
to this in-repo `reference/`. **Nothing external is required.**

---

## 3. How a file becomes "known" to the agent (the pipeline)

```
reference/**  ──walk()──▶  index (built once, cached)  ──▶  3 tools the agent calls
   any .md/.json/text          per file:                       • search-reference (query → top docs + snippet)
   any subfolder depth         - <20KB → 1 whole-doc entry      • read-reference  (path → full text or chunk)
                               - >20KB → whole-doc + overlapping • list-reference  (catalog of everything)
                                         ~8KB chunks (each
                                         separately searchable)
```

Key mechanics (from `reference.mjs`):

- **`walk()`** recurses the entire tree. Subfolders are fine and encouraged (the
  first path segment becomes the doc's "section" — e.g. `SAQL`, `EChart`, `Org examples`).
- **Chunking (>20 KB):** big files are split into ~8 KB overlapping chunks so a keyword
  buried deep in a 165 KB recipe is still findable. Both the whole file *and* its chunks
  are indexed; `read-reference` on the base path returns the full file, on a `#chunk-N`
  path returns just that slice.
- **Scoring** = length-normalized term frequency, **+2.5 if the term appears in the
  path, +1.5 if in the label** (first meaningful line). So filename and the first line
  are the strongest signals — this is why §5 says to name files well.
- **Index is cached** in memory on first use. Adding a file needs a **process restart**
  to appear (except `write-reference`, which invalidates the cache live).
- **Robustness:** if the folder is missing, tools return `available:false` with a note
  and the agent falls back to its built-in knowledge — it never crashes.

As of this writing the index holds **124 whole-docs (36 of them chunked)** across
sections: Dashabord (40), Org examples (24), (root) (18), EChart (18), SAQL (10),
CRMA REST API OVERVIEW (8), Nodes in recipes (3), Success log (3).

---

## 4. The one real gap: keyword search, not semantic

Verified live:

| Query | Finds `CLVRecipe.json`? | Why |
|---|---|---|
| `"CLV recipe"` | ✅ yes | "CLV" is a token in the **filename** (+2.5 path bonus) |
| `"customer lifetime value recipe"` | ⚠️ ranks below generic docs | file contains `Predicted_Customer_Revenue`, not "lifetime value" |
| `"lifetime value"` | ❌ no | those exact words appear nowhere in the file |

**Takeaway:** a technically-perfect doc is invisible to a query that doesn't share its
words. The agent can only retrieve what it can *match*. This is the failure mode your
question is about — and it is prevented entirely by the checklist below, no code change.

---

## 5. ✅ ADD-A-DOC CHECKLIST — do this every time you add a reference file

Follow this and the agent will find + correctly use the doc. Skip it and a good doc
may sit unread.

1. **Put it anywhere under `reference/`** — subfolders are fine. Use an existing section
   folder when it fits (`SAQL/`, `Dashabord/`, `EChart/`, `Org examples/…`, `Nodes in recipes/`).
2. **Name the file with the concept, not a code name.** `Customer_Lifetime_Value_CLV_recipe.json`
   beats `CLVRecipe.json`. The filename is the single strongest search signal.
3. **Front-load concept keywords in the first line** (for `.md`) or add a sibling
   `.md` note (for `.json` that you can't edit). Include **synonyms the agent might
   search**: e.g. "Customer Lifetime Value (CLV / LTV) prediction recipe — Opportunity,
   PricebookEntry, smartDataDiscoveryPredict." The first meaningful line becomes the
   doc's label (+1.5 search bonus).
4. **Only add CORRECT, verified content.** RAG is "highest-trust ground truth" in the
   agent's precedence chain (see `CRMA_BUILD_KNOWLEDGE.md` PART 4). A wrong sample teaches
   the agent a wrong shape. Validate recipes (connected graph, no dangling sources, valid
   actions, terminal save) and dashboards (viz↔binding↔step wiring) before dropping them in.
5. **Flag template/non-deployable content explicitly.** If a JSON carries `${App.Datasets…}`,
   `${Variables…}`, or `${App.PredictiveScoring…}` tokens (i.e. it was extracted from a
   WaveTemplate bundle), say so in a one-line header/sibling note: *"TEMPLATE — mirror the
   node shapes; tokens must be substituted before deploy."* Otherwise the agent may copy a
   token verbatim into a real build.
6. **No secrets / no org IDs / no customer names.** Scan for `sk-…`, `ghp_…`, `00D…` org
   ids, emails, and real customer names before committing. Repo rule: no real customer
   names in any doc — use a neutral placeholder like "Hero" instead.
7. **Avoid duplicates.** Don't keep the same file at two paths — the walker indexes both,
   doubling the entry and skewing search. Move, don't copy.
8. **Restart the agent process** so the new file is indexed (the index is cached on first use).
9. **Verify it's found** (30-second smoke test, §6). If your realistic query doesn't surface
   it, improve the filename/first-line keywords (step 2–3) and re-check.

> **What you do NOT need to do:** edit `reference.mjs`, register the file in a manifest,
> or add a `read-reference "…"` line to the agent instructions. Those citations are
> optional hints; discovery is automatic.

---

## 6. 30-second smoke test (prove a new doc is discoverable)

From the project root, after adding a file and restarting:

```bash
node --input-type=module -e '
import { searchReference, readReference, listReference } from "./src/mastra/reference.mjs";
console.log("indexed:", listReference().count, "docs");
// 1) is it in the catalog?
console.log(listReference().docs.some(d => d.path.includes("YOUR_FILE")) ? "✅ indexed" : "❌ MISSING");
// 2) does a REALISTIC query surface it?
console.log(searchReference("the concept a user would ask about", 5).results.map(r => r.score+"  "+r.path));
// 3) can the agent read it back by path?
console.log(readReference("relative/path/to/YOUR_FILE").found ? "✅ readable" : "❌ unreadable");
'
```

Pass criteria: appears in the catalog **and** ranks in the top ~5 for a query phrased
the way a user (or the agent) would naturally ask. If it only appears for its exact
filename, add concept synonyms per §5 step 3.

---

## 7. Moving / renaming / deleting docs — what stays safe

- **Moving a file** (e.g. root `Sample recipes/` → `Org examples/Sample recipes/`) is safe.
  `read-reference` matches by exact path, then case-insensitive, then **suffix**, then
  **basename** — so an old citation like `read-reference "Sample recipes/Sample 2.json"`
  still resolves to the new location. Verified.
- **Deleting a duplicate** (the same file left at the old path after a copy) is not just
  safe but *desirable* — it removes double-indexing.
- **Renaming for keywords** (§5 step 2) may break an *exact*-path citation in the agent
  instructions; suffix/basename matching usually still catches it, but if you rename,
  grep the instructions/docs for the old name and update any hard citation.

---

## 8. Related files (the RAG machinery)

- `src/mastra/reference.mjs` — the indexer + `searchReference` / `readReference` /
  `listReference` / `writeReferenceNote`. **This is the source of truth for behavior.**
- `src/mastra/tools/referenceTools.mjs` — wraps those four functions as the agent tools
  `search-reference`, `read-reference`, `list-reference`, `write-reference`.
- `reference/CRMA_BUILD_KNOWLEDGE.md` — the master node/shape doc; PART 4 defines the
  trust precedence (deployed examples > live get-* > this doc > REST schema).
- `reference/DASHBOARD_PATTERNS.md` — dashboard deploy shapes + the strict validator gotchas.
- `reference/SAQL_PATTERNS.md` — org-verified SAQL patterns.

**Self-healing note:** the agent's `write-reference` tool appends *verified* patterns to
the cheat-sheets after a confirmed deploy and invalidates the cache so they're searchable
immediately. That's the only path that adds to RAG without a restart.

---

## 9. Change log (RAG corpus + citations)

Record every add/move/delete of a reference doc here, plus any citation edits it
forced. This is the single place to see how the corpus evolved.

### 2026-09-07 — added 5 sample assets, consolidated `Sample recipes/`
- **Added** (all scanned clean: no secrets, no `00D…` org IDs, no customer names;
  all valid JSON; all >20 KB so they index as overlapping chunks):
  - `Org examples/dashboards/sample.json` — dashboard "Executive Pipeline Review",
    15 widgets, 13 steps. Note: its two charts carry the **fixed** wiring (field
    arrays, no columnMap, step-viz == widget-viz) — a good positive example.
  - `Org examples/dashboards/sample 2.json` — dashboard "Win/Loss and Account
    Health", 18 widgets, 15 steps.
  - `Org examples/Sample recipes/SalesAnalyticsDataflow.json` — **legacy dataflow**
    (`workflowDefinition`, 201 nodes). ⚠️ Legacy format, NOT R3 — reference for
    SAQL/computeExpression patterns only; do not copy its node shapes into an R3 recipe.
  - `Org examples/Sample recipes/OpptyRecipe.json` — R3 recipe, 54 nodes.
  - `Org examples/Sample recipes/CLVRecipe.json` — R3 recipe, 33 nodes.
- **Moved/consolidated:** `reference/Sample recipes/` (root) → `reference/Org
  examples/Sample recipes/`. The root copy was a byte-identical duplicate (verified
  with `cmp`), so it was **deleted** to stop double-indexing. There is now exactly
  one copy of each file.
- **Citations updated** to the stale `86-node/41-node` / "two Sample recipes"
  descriptions (the paths were already pointing at `Org examples/Sample recipes/`):
  - `src/mastra/agents/copilot.mjs` (Primary sources list, item 4)
  - `reference/CRMA_BUILD_KNOWLEDGE.md` (line 3 header)
  - `docs/AGENT_RULES.md` (reference-files list)
- **Index stats** refreshed in §3 (116→124 whole-docs, 34→36 chunked).
- **Reminder:** these changes require an **agent server restart** to take effect
  (the index is cached per-process — see §4/§7).
