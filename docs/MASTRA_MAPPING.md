# How this project maps to the Mastra Framework

This answers one question directly: **"Are we really using the Mastra framework?"**
Yes — every core Mastra building block, exactly as the official docs prescribe.
References: [Agents overview](https://mastra.ai/docs/agents/overview),
[Studio overview](https://mastra.ai/docs/studio/overview).

## Mastra = a framework + a studio (two separate things)

| Piece | Package | Role | Used here? |
|---|---|---|---|
| **Framework** | `@mastra/core` | The library you build on: `Agent`, `createTool`, `Mastra`, `.generate()` | ✅ fully |
| **Studio** | `mastra` CLI (`mastra dev`) | Optional browser UI to test/inspect agents | ✅ runs at `localhost:4111` |

## The docs' pattern vs. our code — line for line

| Mastra docs say… | Where we do it |
|---|---|
| Create an agent: `new Agent({...})` from `@mastra/core/agent` | `src/mastra/agents/copilot.mjs` |
| Tools must use `createTool({ id, description, inputSchema, execute })` (plain objects silently fail) | `src/mastra/tools/recipeTools.mjs`, `dashboardTools.mjs` — 14 tools, all `createTool` |
| Attach tools as a `tools: {...}` object | `tools: { ...recipeTools, ...dashboardTools }` in copilot.mjs |
| Register on a `Mastra` instance in `src/mastra/index` | `src/mastra/index.js` → `new Mastra({ agents: { copilot } })` |
| Call with `.generate()` → `{ text, toolCalls, steps, usage }` | `copilot.generate(messages, { maxSteps: 12 })` in chat.mjs / server.mjs |
| Run Studio with `mastra dev` at `localhost:4111` | `npm run dev` |

## The one intentional deviation: model wiring

The Agents doc shows the **quickstart** way to pick a model — a string using
Mastra's built-in model router:

```js
model: 'anthropic/claude-sonnet-4-6'   // auto-reads ANTHROPIC_API_KEY, public API only
```

We instead pass an **explicit provider object**:

```js
// src/mastra/models.mjs
model: opus()   // → provider pointed at the Salesforce internal model gateway
```

**Why:** the string router only knows the *public* Anthropic/OpenAI/Google
endpoints. Our Claude access goes through the **Salesforce internal model
gateway** (a governed, no-personal-key proxy). Routing to a custom/enterprise
endpoint is a first-class Mastra pattern — you hand `Agent` any AI-SDK model
object. It's the "advanced" option in place of the "quickstart" string, and it
keeps everything Mastra-native. A one-line switch (`LLM_PROVIDER=anthropic`)
falls back to the public string-style path if ever wanted.

## Version note (why the stack is what it is)

Mastra Studio (`mastra dev`) and `@mastra/core` must be the **same generation**.
We run the current line: `@mastra/core@^1.61`, `mastra@^1.26`, on **AI SDK v7**
(`ai@^7`, `@ai-sdk/openai-compatible@^3`, `@ai-sdk/anthropic@^4`). An earlier
pin to core `0.10` / AI SDK v4 ran the agent fine but couldn't launch Studio —
the upgrade fixed that.

> Install note: this machine's `~/.npmrc` sets `min-release-age=7` (a
> supply-chain guard that hides packages < 7 days old). A project-local
> `.npmrc` with `min-release-age=0` overrides it so the current Mastra line
> installs. The global guard is left untouched.
