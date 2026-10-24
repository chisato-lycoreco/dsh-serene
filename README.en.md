[中文](./README.md) | English

# dsh-serene

[![npm](https://img.shields.io/npm/v/dsh-serene.svg)](https://www.npmjs.com/package/dsh-serene)
[![CI](https://github.com/chisato-lycoreco/dsh-serene/actions/workflows/ci.yml/badge.svg)](https://github.com/chisato-lycoreco/dsh-serene/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![DSH](https://img.shields.io/badge/dsh-0.2.1--rc.2-4d6bfe.svg)](https://deepseek-harness.github.io/deepseek-harness/)

> A character that remembers you, wired into [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) — personality as data, mood as state, memory as a file, all three readable, editable, and reproducible.

Most character cards are a paragraph pasted into a system prompt: the model starts from zero every turn, and the longer the conversation runs, the less it sounds like anyone. This plugin takes a different route: **it breaks the character down into computable state**, so that "how she feels right now" follows from time, events, and history instead of being improvised again on each turn.

- **Mood**: PAD+, six dimensions across three layers (background / primary / social). It decays, follows a circadian rhythm, and leaves scars.
- **Memory**: written to jsonl files on disk; recall combines relevance, time decay, and importance, with a formula you can recompute.
- **Personality**: a single JSON file; swapping personas requires no code change.

It is the minimal reference implementation of the seven-layer structure in [`FRAMEWORK.md`](./FRAMEWORK.md) — **the weave, not the cloth**: it ships no private character, no private memories, no screen capture, and no image generation.

![Ten days in one character's mood: background, present reaction, and relationship, plus the scar left on day 3](https://raw.githubusercontent.com/chisato-lycoreco/dsh-serene/main/docs/preview.gif)

That chart is not drawn by hand: `node demo/timeline.mjs` runs ten days through the pure functions in [`core/emotion.js`](./core/emotion.js), and `node demo/render.mjs` renders the frames. Change one event and the curve — and the scar — change with it. That is what "recomputable" means here.

---

## What it does / what it doesn't

| Does | Doesn't |
| --- | --- |
| Record events, advance mood, render state in plain language | Write replies for the model, or rewrite conversation content |
| Write and recall long-term memories | Call the model itself, or summarize on its own |
| Read and assemble persona profiles | Read `.env`, credentials, or raw chat logs |
| Persist state (atomic writes); hand-editable and git-friendly | Use the network, send telemetry, or capture the screen |

---

## Installation

Requires DSH `>= 0.2.1-rc.2` and Node `>= 22.19`.

```bash
# from npm (recommended)
dsh plugin --profile web add dsh-serene

# from GitHub (pins a tag, no npm involved)
dsh plugin --profile web add "github:chisato-lycoreco/dsh-serene#v0.1.0"

# from a local directory (development)
dsh plugin --profile web add "/absolute/path/to/dsh-serene"

# from a tgz (grab dsh-serene-0.1.0.tgz from the Releases page)
dsh plugin --profile web add ./dsh-serene-0.1.0.tgz
```

**Quit DSH completely before installing** — installation modifies the profile's `package.json` and `cordis.patch.yml`. Afterwards, confirm the plugin is in the config tree:

```bash
dsh --profile web --dump-config | grep -A3 "dsh-serene"
```

To try it without installing, mount the local plugin with a patch overlay:

```bash
dsh --profile web --patch "/absolute/path/to/dsh-serene/cordis.patch.yml"
```

> `config` in `cordis.patch.yml` is **replaced as a whole**, not deep-merged. When you override it in your own profile, repeat every key you intend to keep.

### First run: credentials and self-check

Model credentials come from exactly two places: the GUI's **Models** page (written into the credentials service), or `DEEPSEEK_API_KEY` in the launching environment. **A new profile does not inherit them** — on a freshly created profile the very first message fails with `MISSING_CREDENTIAL` (that's credentials, not the plugin):

```bash
export DEEPSEEK_API_KEY=sk-...      # or set it once on the GUI Models page
```

Don't stop at the config file. Two checks — the second one is "it actually works":

| Check | How | Healthy looks like |
| --- | --- | --- |
| entry in the config tree | `dsh --profile web --dump-config \| grep -A3 dsh-serene` | `- id: serene` is there |
| the plugin is really mounted | in the profile that has the plugin, say "call serene_status" | persona, data dir, memory count |

That second check is the only way to tell "working" from "installed but not running": when the persona file can't be read the plugin degrades instead of breaking the host, but it keeps `serene_status` and one stderr line explaining why.

---

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `persona` | `demo` | File name under `personas/`, or an absolute path |
| `personaRoot` | the bundled `personas/` | Directory holding persona profiles |
| `dataDir` | `$DSH_HOME/plugins/dsh-serene` | Where state and memories are persisted |
| `recallLimit` | `5` | Default number of memories per recall |
| `halfLifeDays` | `45` | Half-life of memory time decay |

Override example (`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- insert:
    - id: serene
      name: dsh-serene
      config:
        enabled: true
        persona: xiaoman
        personaRoot: /Users/me/serene-personas
        dataDir: /Users/me/serene-data
```

---

## Tools

| Tool | Purpose |
| --- | --- |
| `serene_context` | Persona card plus current state. Call once at the start of a new session |
| `serene_mood` | Read-only current state (natural language, no numbers) |
| `serene_event` | Record one event into the affect layer (30 event types, below) |
| `serene_remember` | Write one long-term memory |
| `serene_recall` | Recall memories by topic, with timestamps and scores |
| `serene_state` | Debug view: three-layer numbers, recent events, wounds |
| `serene_status` | Health check: is the plugin actually mounted (persona / data dir / memory count); returns the reason and the fix when loading failed |

Event types: `chat / affection / address / intimacy / kiss / tease / care / humor / share /
question / goodnight / rejection / neglect / conflict / repair / scold / coax / jealousy /
ignored / selfie / reflection / heavy_reflection / sleep / wake / leisure / reply /
cold_read / warm_read / moved / disclose / suppress`.

When the model calls these tools is something you agree on in `AGENTS.md` or in the persona card; the plugin does not hijack the conversation.

---

## What the data looks like

`$DSH_HOME/plugins/dsh-serene/emotion.json`:

```json
{
  "version": 1,
  "updatedAt": 1761288000000,
  "lastInteractionAt": 1761287900000,
  "layers": {
    "background": { "pleasure": 63.1, "arousal": 43.8, "dominance": 59.9, "curiosity": 57.4, "confidence": 61.6, "connection": 60.4 },
    "primary":    { "pleasure": 68.2, "arousal": 47.1, "dominance": 60.3, "curiosity": 58.0, "confidence": 62.1, "connection": 61.9 },
    "social":     { "pleasure": 61.4, "arousal": 43.0, "dominance": 59.5, "curiosity": 57.8, "confidence": 61.2, "connection": 61.1 }
  },
  "wounds": [],
  "history": [{ "kind": "affection", "at": 1761287900000, "intensity": 1 }]
}
```

`memories.jsonl`: one record per line, plain `grep` is enough to find things.

Both files are yours: back them up, edit them by hand, delete them. Delete them and none of it ever happened.

---

## Swapping personas

The demo persona is Xiaoman, a sample persona. Copy `personas/demo.json`, change a few fields, and pass the file name as `persona`:

```json
{
  "name": "Xiaoman",
  "role": "a companion who lives in the terminal",
  "summary": "You don't rush to give advice.",
  "traits": ["quiet", "curious"],
  "speech": ["short sentences", "asks when unsure"],
  "boundaries": ["never pretends to remember what was never recorded"],
  "lexicon": { "address": ["Xiaoman"] },
  "baseline": { "background": { "pleasure": 62 } }
}
```

If `baseline` is omitted, the default baseline applies; `lexicon.address` decides which names count as addressing her.

---

## Three design rules

1. **State moves on its own.** Time passes, mood decays, and it drifts with the day/night cycle — it does not wait for someone to speak.
2. **Mood changes tone; it never rewrites facts.** What the state contributes to the prompt is a plain-language note ("a little low right now — don't push yourself"), not "you are angry", and it never alters recalled memories.
3. **Everything is reproducible.** The same initial state + the same events + the same timestamps always yield the same result; no random numbers, no model calls. The test suite asserts exactly this.

For the fuller structural description, see [`FRAMEWORK.md`](./FRAMEWORK.md).

---

## Development

```bash
npm install          # installs devDependencies only (schemastery / dsh-tools)
npm test             # node --test, 28 cases
```

```
core/emotion.js               pure functions: decay, rhythm, events, wounds, description
core/recall.js                pure functions: tokenizing, decay, recall scoring
src/stores/emotion-store.js   the only code that touches disk (atomic writes)
src/stores/memory-store.js    jsonl append and recall
src/persona.js                persona profile → prompt section
src/tools.js                  the seven tools (incl. the serene_status health check)
src/index.js                  name / inject / Config / apply
```

There is no `fs`, no `Date.now()`, and no network in `core/`. To check:

```bash
grep -n "node:fs\|process.env\|fetch(" core/*.js   # should print nothing
```

---

## Relationship to other plugins

- **`@furongjun1999/dsh-memory` (Lingshu)** — that one is working memory: tasks and facts. This plugin records relationships, and the two should stay separate: working memory has to be exact, while relational memory is supposed to fade.
- **dsh-dafeiyu** — a desktop-pet frontend. This plugin is backend only and ships no UI; to drive a pet, read what `serene_state` returns and draw it yourself.

---

## License

Code is MIT. The persona profiles in `personas/` are yours to change however you like — once changed, they are your persona, not mine.
