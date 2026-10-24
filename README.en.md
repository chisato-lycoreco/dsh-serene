[中文](./README.md) | English

# dsh-serene

[![npm](https://img.shields.io/npm/v/dsh-serene.svg)](https://www.npmjs.com/package/dsh-serene)
[![CI](https://github.com/chisato-lycoreco/dsh-serene/actions/workflows/ci.yml/badge.svg)](https://github.com/chisato-lycoreco/dsh-serene/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![DSH](https://img.shields.io/badge/dsh-0.2.1--rc.2-4d6bfe.svg)](https://deepseek-harness.github.io/deepseek-harness/)

> A character that remembers you, wired into [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) — personality as data, mood as state, memory as a file, all three readable, editable, and reproducible.

Most character cards are a paragraph pasted into a system prompt: the model starts from zero every turn, and the longer the conversation runs, the less it sounds like anyone. This plugin takes a different route: **it breaks the character down into computable state**, so that "how she feels right now" follows from time, events, and history instead of being improvised again on each turn.

- **Mood**: PAD+, six dimensions across three layers (background / primary / social). It decays, follows a circadian rhythm, and leaves scars.
- **Memory**: written to jsonl files on disk; recall samples by activation (retention × cue × importance) and **may return nothing at all**, with a formula you can recompute.
- **Proactive**: a daily budget plus a 20-minute, self-expiring hold — and a substitute action whenever she decides not to speak.
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
| Budget and hold for proactive openers, plus a substitute action | Send messages on its own, or pretend you replied |
| Read and assemble persona profiles | Read `.env`, credentials, or raw chat logs |
| Persist state (atomic writes); hand-editable and git-friendly | Use the network, send telemetry, or capture the screen |

---

## Installation

Requires DSH `>= 0.2.1-rc.2` and Node `>= 22.19`.

```bash
# from npm (recommended)
dsh plugin --profile web add dsh-serene

# from GitHub (pins a tag, no npm involved)
dsh plugin --profile web add "github:chisato-lycoreco/dsh-serene#v0.2.0"

# from a local directory (development)
dsh plugin --profile web add "/absolute/path/to/dsh-serene"

# from a tgz (grab dsh-serene-0.2.0.tgz from the Releases page)
dsh plugin --profile web add ./dsh-serene-0.2.0.tgz
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
| `recallLimit` | `5` | Default number of memories per recall (v2 caps at 6) |
| `halfLifeDays` | `45` | Half-life of memory time decay; applies to the v1 curve only |
| `memoryCurve` | `v2` | Recall curve: `v2` allows an empty result; `v1` restores the old "any score > 0, take top k" |
| `memoryCapacity` | `500` | Memory cap; eviction prefers expired entries, then lowest importance × retention |
| `proactivePerDay` | `3` | How many times she may reach out per day; `0` disables it |
| `proactiveGapMinutes` | `60` | Minimum gap between two proactive openers |

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
| `serene_event` | Record one event into the affect layer (31 event types, below) |
| `serene_remember` | Write one long-term memory (one of six kinds, ≤ 80 characters) |
| `serene_recall` | Recall memories by topic, with timestamp, kind, activation and id; **may return nothing** |
| `serene_reinforce` | Call only when a recalled memory actually made it into the reply: being recalled makes it easier to recall later |
| `serene_state` | Debug view: three-layer numbers, residue, recent events, wounds, today's proactive budget |
| `serene_proactive` | Ask "should she speak up right now": the reason, today's remaining budget, and a substitute action when the answer is no |
| `serene_proactive_done` | Record an opener; pass `rejected` when it was rebuffed (spends budget and starts a cooldown) |
| `serene_status` | Health check: is the plugin actually mounted; returns the reason and the fix when loading failed |

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
  "version": 2,
  "updatedAt": 1761288000000,
  "lastInteractionAt": 1761287900000,
  "layers": {
    "background": { "pleasure": 63.1, "arousal": 43.8, "dominance": 59.9, "curiosity": 57.4, "confidence": 61.6, "connection": 60.4 },
    "primary":    { "pleasure": 68.2, "arousal": 47.1, "dominance": 60.3, "curiosity": 58.0, "confidence": 62.1, "connection": 61.9 },
    "social":     { "pleasure": 61.4, "arousal": 43.0, "dominance": 59.5, "curiosity": 57.8, "confidence": 61.2, "connection": 61.1 }
  },
  "wounds": [],
  "residue": [{ "startedAt": 1761280000000, "kind": "conflict", "halfLifeHours": 38, "delta": { "pleasure": -22.4 } }],
  "history": [{ "kind": "affection", "at": 1761287900000, "intensity": 1 }]
}
```

`residue` is the aftershock: anything with |Δpleasure| ≥ 8 leaves a 24–48 hour tail on the background layer.
Unlike a scar it always fades — but tonight and tomorrow morning are not the same, and not because she is acting.

`memories.jsonl`: one record per line, plain `grep` is enough to find things. Three kinds of line share the file:

```jsonl
{"id":"m_lq3k2_ab12","kind":"preference","text":"she is afraid of thunder","tags":["fear"],"importance":0.9,"createdAt":1761280000000,"stability":6.9,"lastRecall":0,"recallCount":0}
{"type":"reinforce","id":"m_lq3k2_ab12","stability":9.7,"lastRecall":1761500000000,"recallCount":1,"gain":1.4,"at":1761500000000}
{"type":"forget","id":"m_old_9x","text":"an argument last year","reason":"capacity","at":1761600000000}
```

Append-only: being recalled appends a `reinforce` line, eviction appends a `forget` line (what she forgot must be checkable), and both are folded back in on load. Old files need no migration — a memory without `stability` gets the initial formula.

`motivation.json`: today's budget, the last opener, and any hold that has not expired yet.

All three files are yours: back them up, edit them by hand, delete them. Delete them and none of it ever happened.

---

## What changed in 0.2.0

**Memory changed its curve: she is allowed to remember nothing.**

The old formula (v1) was `cue × decay × importance`, taking the top k as long as any score was positive — so it always returned something. The readings: 5.97 memories per turn on average, 0.05 relevance to the actual sentence, one memory injected 134 times. That is not recall; that is a backdrop.

v2 scores an activation and samples deterministically:

```
activation = 1.1·ln(retention + 0.02) + 0.9·cue + 0.5·importance + mood tint (±0.45) + 0.4·Gumbel(seed)
retention  = (1 + age / stability) ^ −0.6     stability₀ = 1.5 + 6 × importance (moments/promises ×1.3)
```

If nothing clears the floor, the result is empty — "I don't remember" beats two unrelated memories.
Cues below `minCue` are dropped before sampling; at most 6 items, no backfill.
Being recalled strengthens a memory by the spacing effect (`S' = S × (1 + 1.2 × (1 − r))`):
recalling twice in the same instant barely moves it, recalling after a gap moves it a lot.
Nothing counts as recalled until you actually use it and call `serene_reinforce`.

The sampling noise comes from `hash(id, query, timestamp)`, not `Math.random`: same input, same output.
Memories longer than 80 characters are rejected; at 500 entries eviction starts, and every eviction is logged.
To go back to the old behaviour: `memoryCurve: v1`.

**Proactive now has a budget, not just a gap.**

`serene_proactive` answers three things: whether to speak, why, and how much budget is left today.
Besides the two hard limits (3 per day, 60 minutes apart) there is a 20-minute hold that expires on its own —
"I want to say it, but not this time" must never turn into "I say less and less".
When the answer is no, it must hand back a substitute action.

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
2. **Mood changes tone and what surfaces; it never rewrites facts.** What the state contributes to the prompt is a plain-language note ("a little low right now — don't push yourself"), not "you are angry". Mood makes some memories easier to surface (facts and knowledge are never tinted), but it never changes a memory's content, its truth, or the recall formula itself.
3. **Everything is reproducible.** The same initial state + the same events + the same timestamps always yield the same result; no `Math.random` (sampling noise is hashed), no model calls. The test suite asserts exactly this.

For the fuller structural description, see [`FRAMEWORK.md`](./FRAMEWORK.md).

---

## Development

```bash
npm install          # installs devDependencies only (schemastery / dsh-tools)
npm test             # node --test, 55 cases
```

```
core/emotion.js                 pure functions: decay, rhythm, events, wounds, residue, description
core/recall.js                  pure functions: tokenizing, retention, activation, deterministic sampling, reinforcement
core/motivation.js              pure functions: intent, budget, hold, substitute action
src/stores/emotion-store.js     the only code that touches disk (atomic writes)
src/stores/memory-store.js      jsonl append, capacity, recall
src/stores/motivation-store.js  today's budget and holds
src/persona.js                  persona profile → prompt section
src/tools.js                    the ten tools (incl. the serene_status health check)
src/index.js                    name / inject / Config / apply
```

There is no `fs`, no `Date.now()`, no network, and no randomness in `core/`. To check:

```bash
grep -n "node:fs\|process.env\|fetch(" core/*.js   # should print nothing
```

`Math.random` is absent from `core/` too (comments aside): sampling noise comes from a hash,
so the same input always produces the same output — `test/recall-v2.test.js` pins that down.

---

## Relationship to other plugins

- **`@furongjun1999/dsh-memory` (Lingshu)** — that one is working memory: tasks and facts. This plugin records relationships, and the two should stay separate: working memory has to be exact, while relational memory is supposed to fade.
- **dsh-dafeiyu** — a desktop-pet frontend. This plugin is backend only and ships no UI; to drive a pet, read what `serene_state` returns and draw it yourself.

---

## License

Code is MIT. The persona profiles in `personas/` are yours to change however you like — once changed, they are your persona, not mine.
