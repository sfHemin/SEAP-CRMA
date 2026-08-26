# CRMA Copilot — Recipe Feature: Functional Guide

> **Audience:** Product, leads, demo users, anyone evaluating or extending the recipe capability.
> **Status:** Phase 1 — complete and verified live against storm-org.

---

## What It Does (Plain English)

The CRMA Copilot can have a natural-language conversation with you about your CRM Analytics recipes. You never open Analytics Studio or write a line of JSON. Everything happens in chat.

**You can ask it to:**

- "List my recipes"
- "What does the Segmentation recipe actually do — walk me through every step"
- "Fix the filter — the operator is wrong"
- "Build me a new recipe from scratch on the Apartment object that filters for vacant units"
- "Check if the Integration User can read those fields before I run it"
- "Run the recipe and tell me when it's done"
- "The run just failed — what happened and how do I fix it"

---

## Full Capability Map

### 1 · Explore

| What you say | What the agent does |
|---|---|
| "List my recipes" | Returns every recipe in the org with name, label, and id |
| "What custom objects do I have?" | Lists every `__c` object — starting point before building a new recipe |
| "Describe the Apartment object" | Returns all field API names, labels, types, and whether they're required — the agent uses this itself before authoring |

### 2 · Read & Understand

| What you say | What the agent does |
|---|---|
| "Show me the full Vacant_Units_Analysis recipe" | Retrieves the complete R3 definition: every node, its parameters, the load source, filters, transforms, and output |
| "Explain what each step does" | Narrates the pipeline in plain English — what object is loaded, what filter removes records, what the output dataset is |
| "What fields does it load?" | Parses the load node's field list |

### 3 · Edit (Surgical)

The agent never rewrites the whole recipe. It makes the smallest possible change:

| What you say | What the agent does |
|---|---|
| "Change the filter so it only keeps vacant units" | Locates the filter node, changes the operand value |
| "Add a Days_Vacant field to the load" | Adds the field name to the load node's fields array |
| "Remove the transform node — we don't need it" | Deletes only that node; rewires sources if needed |
| "Rename the output dataset to Units_Q4" | Sets the dataset name and label on the save node |

### 4 · Validate

Before any deploy, the agent runs a dry-run validation against the org:

- Surfaces the org's own compile/deploy errors
- Explains the cause in plain English
- Proposes a specific fix
- Does NOT write anything to the org

### 5 · Create New

| What you say | What the agent does |
|---|---|
| "Build a recipe on Account that keeps only US customers and exports to a dataset called US_Accounts" | Calls `describe-object` to get real field names, authors a valid R3 graph (load → filter → save), validates it, shows you the plan, then waits for your approval before deploying |

The agent always:
1. Gets real field names from the org (never guesses)
2. Shows you the plan before doing it
3. Validates (dry-run) before asking you to confirm the deploy
4. Only deploys after you say yes

### 6 · Deploy

- New recipes are created via Wave REST API
- Existing recipes are updated via Wave REST PATCH
- The agent detects which path to take automatically
- Always gated: `DEPLOY_DRY_RUN=false` in `.env` **and** your explicit approval in chat

### 7 · Run

| What you say | What the agent does |
|---|---|
| "Run it" | Pre-checks replication + FLS, then starts the dataflow job |
| (after starting) | Polls the job status until Success or Failed |
| "How many rows came out?" | Runs a SAQL count against the output dataset |

**Pre-run checks (automatic, before every run on a custom object):**

1. **Replication check** — verifies Apartment__c (or whichever object) has replication enabled on the SFDC_LOCAL connector. If not, tells you exactly how to enable it in Data Manager. The agent cannot do this for you — it's a Salesforce UI-only action.
2. **FLS check** — verifies the Analytics Cloud Integration User can read every field the recipe loads. If blocked, proposes `grant-field-access`.

### 8 · Error Handling

If a run fails, the agent diagnoses the error automatically and tells you:
- What went wrong (plain English root cause)
- Whether it can fix it itself (auto-fixable) or whether you need to do something (steps)
- What to do next

| Error | Root cause | What the agent does |
|---|---|---|
| "Object X has not setup replication" | Data not connected in CRMA | Tells you the exact Data Manager steps |
| "Field X isn't accessible to the Integration User" | FLS blocked | Calls `check-field-access`, proposes `grant-field-access` |
| "Output dataset label can not be empty" | Save node missing label | Edits the recipe, re-deploys, re-runs |
| "UNKNOWN_EXCEPTION" | Usually replication not set up | Checks replication first, advises retry |

### 9 · Field-Level Security (FLS) Grant

When FLS is blocked, the agent can fix it:
1. Deploys a permission set (`CRMA_Integration_FLS`) granting READ on the blocked fields
2. Assigns the permission set to the Integration User
3. Explains what it's doing and waits for your approval before writing

This is a security-config change — the agent never does it silently.

---

## Safety Model

Every write operation is double-gated:

| Gate | What it is |
|---|---|
| `DEPLOY_DRY_RUN=true` in `.env` | Server-side kill switch. When `true`, all deploy/run calls are dry-run only regardless of what you say in chat. Default is `true`. |
| `confirm=true` in the tool call | The agent only passes this after you explicitly approve in conversation. |

To enable live writes: set `DEPLOY_DRY_RUN=false` in `.env` and restart.

---

## How to Have a Good Conversation

**The agent never asks the same question twice.** Once you've told it the object name or approved an action, it acts — it won't re-ask.

**Short affirmatives work.** After the agent proposes deploying a recipe, saying "yes", "go ahead", "do it", or "deploy" is enough. It knows what it just proposed.

**"Why did that fail?"** Always works. The agent will re-read the last error and explain it.

---

## Known Constraints

| Constraint | Detail |
|---|---|
| Replication cannot be enabled via API | Must be done in Analytics Studio → Data Manager → Connect → SFDC Local |
| Recipe run = live data write | Always gated behind your explicit confirmation |
| Recipe validation does NOT catch run-time FLS errors | A recipe can validate cleanly but fail at run time if FLS is missing. Use check-field-access proactively. |
| maxSteps limit | Complex multi-step tasks use up to 100 agent steps (patched from the Studio default of 15). Very long sessions may hit this limit — restart the chat thread if you do. |
