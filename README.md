# Answer Space

Measure how AI assistants answer questions in your category:

- **whether you appear at all** — the question most tools can't answer
- **which sources they lean on** when they do
- **what those answers actually claim** about you
- **whether the claims are true**, checked against the cited page and against facts you supply

Static site. Runs on GitHub Pages. Bring your own API keys. There is no backend, no
account, and nothing of yours reaches anyone but the model vendors you key.

---

## Deploy (no terminal)

1. GitHub → **New repository** → **Create**.
2. **Add file → Upload files** → drag in everything from this folder → commit.

   > macOS hides dotfiles, so `.github` sometimes fails to drag. If the Actions tab is
   > empty afterwards, use **Add file → Create new file**, type
   > `.github/workflows/collect.yml` as the name, and paste that file's contents in. You
   > only need it for the five-channel path; the browser engine works without it.
3. **Settings → Pages** → Deploy from a branch → `main` → `/ (root)` → **Save**.
4. Open `https://<you>.github.io/<repo>/`.

Everything after this happens in the dashboard.

**Try it first:** hit **Enable demo mode** on step 1 and walk all seven steps. It
fabricates a company, a query set, answers, verifications and conflicts locally. Nothing is
called and nothing is charged. **Reset** in the header wipes it.

---

## What it measures

### Coverage — did you appear?

One row per *answer*, not per citation. A citation only exists when you were already in the
answer, so a citation-only tool is structurally blind to every question you lost outright.
Answer rows record: were you named, in what position, were you actually *recommended*, how
much of the answer was about you, and did the assistant refuse.

The Coverage view draws this directly. Every cell is a wireframe cage sized to all the
answers in that platform × topic; the solid block inside is how often you were in them. An
empty cage is a topic you are invisible on.

### Volatility — is that number stable?

Ask the same model the same question three times and you get three different answers.
Appearing in 3 of 3 runs is a different competitive position from 2 of 3, and an average
hides it. Per query × platform the tool records appearance rate, whether the result flipped
between runs, whether the first-named brand churned, and source overlap between runs.
Cells that flip get an amber ring in Coverage.

**Repeats are the measurement.** One repeat reports whichever roll it got. Three is the
floor for any of this to mean anything.

### Claim verification — does the cited page say it?

After extraction, the tool re-opens cited pages through an assistant's own web search and
asks whether the page actually supports the claim it was used to support. Deduplicated by
(source, claim), so a claim recurring across runs is checked once.

`unsupported` is the most actionable finding the tool produces: a specific model, citing a
specific page, for a claim that page does not make.

### Ground truth — does it contradict reality?

Paste your real prices, limits and guarantees on step 4. Every answer is checked against
them, and contradictions come back as flagged findings rather than as sentiment.

The extractor only flags direct contradictions and stays silent about anything the list
doesn't cover, so a short accurate list beats a long speculative one.

> "An assistant is negative about us" starts an argument.
> "An assistant told 40 people our free plan has 5 seats when it has 3, citing a 2024 page"
> ends one.

### Per citation, beyond sentiment

| Field | Why it is separate from sentiment |
|---|---|
| `verdict` | An answer can be warm about you and still pick a rival. Wins and losses are their own axis. |
| `risks` | Claims that create legal or trust exposure regardless of tone — a guarantee that doesn't exist, a wrong price, an implied regulatory protection. |
| `influence` | Owned (edit it today) / rented (petition the platform) / earned (pitch a correction) / UGC (participate, can't control). Turns findings into work items. |
| `support` | Verified, unsupported, unreachable, unchecked. |
| `factConflict` | Which of your ground-truth lines the answer contradicts. |
| `nuance` | 16 fixed tags — buried citation, own-domain echo, stale data, competitor favoured, conditional endorsement, and so on. |

---

## The engines

| Channel | How | Notes |
|---|---|---|
| **Claude** | in the browser | Anthropic permits direct browser calls. Returns the exact sentence it cited. |
| **Gemini** | in the browser | Google Search grounding. Citations are redirect links, resolved automatically. |
| ChatGPT | GitHub Actions | OpenAI sends no CORS headers. |
| Perplexity | GitHub Actions | Richest citation payload. Sonar's `chat/completions` shape is supported until 2026-09-27. |
| Google AI Overviews | GitHub Actions | No first-party API; SerpApi refuses browser calls outright. Absence of an overview is recorded, not dropped. |
| Microsoft Copilot | — | No API. Scraping the consumer UI breaks its terms. |

### Actions setup

1. **Settings → Secrets and variables → Actions.** Add any of `ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `SERPAPI_KEY`. Anthropic is
   required — it's the worker that does extraction. Unset keys are skipped.
2. Create a fine-grained PAT scoped to this repo with **Contents: read and write** and
   **Actions: read and write**.
3. In **Collect**, enter `owner/repo`, paste the token, press **Trigger workflow**. It
   pushes your profile, query set and ground truth into the repo first, so the Action
   measures what you configured. Press **Pull latest records.json** when it finishes.

Runs Mondays 06:00 UTC as well; delete the `schedule:` block to stop that.

---

## What it costs

```
answers   = channels × queries × repeats
extraction= 1 call per answer
verify    = 1 call per distinct (source, claim), capped by you
```

A standard weekly run of 5 channels × 60 queries × 3 repeats is 900 answers, 900 extraction
calls and up to a few hundred verifications. Anthropic's hosted search is $10 per 1,000
searches on top of tokens; the others are the same order — check current pricing. Cut
repeats last: they're the part that makes the numbers real.

Start at 1 channel × 20 queries × 3 repeats and read twenty extracted records before scaling.

---

## Storage

| Thing | Lives in |
|---|---|
| Keys, profile, query set, ground truth | your browser's `localStorage` |
| Raw answers, extractions, verifications | your browser's IndexedDB |
| `records.json` | the repo, if you run via Actions; otherwise download from step 7 |

Per-browser, so a run on your laptop isn't on your phone — use the Actions path if the
dataset needs to be shared. A public repo means a public `records.json`; Pages on a private
repo needs a paid GitHub plan.

---

## Bundle schema (v2)

```jsonc
{
  "meta": { "schema": 2, "brand", "site", "weeks", "snapshots", "hasFacts", "verified" },
  "platforms": [...], "themes": [...], "brands": [...], "prompts": [...],
  "sources": [{ "id", "dom", "type", "auth", "influence" }],

  "answers": [{                    // one per answer — this is what sees absence
    "aid", "platform", "prompt", "theme", "intent", "week", "repeat",
    "mentioned": false, "recommended": false, "refused": false,
    "first": "comp0", "brands": [{ "brand", "order", "recommended", "share" }],
    "cites": 4, "sources": ["reddit-com"]
  }],

  "records": [{                    // one per citation
    "id", "aid", "platform", "prompt", "theme", "intent",
    "source", "stype", "influence", "brand", "sent", "bandId",
    "verdict": "client loses", "rank", "week", "auth", "tone",
    "claim", "text", "nuance": [], "risks": [],
    "factConflict": null, "support": "unsupported", "supportNote", "url"
  }],

  "volatility": [{ "prompt", "platform", "runs", "appearRate", "flipped",
                   "firstBrandChurn", "sourceOverlap" }]
}
```

Vocabularies live in `pipeline/src/taxonomy.js` and at the top of `app.js`.
**Change them in both places or not at all**, or the browser and Actions engines will
disagree about what a citation is.

Schema-1 bundles still load; the Coverage view just says it has no answer-level data.

---

## Honest limits

**An API answer is not the consumer product.** Different retrieval, no memory, no
personalization, no A/B bucket. This is a *representative probe* — comparable week over
week, which is what a trend needs. It is not a recording of what any particular person saw,
and shouldn't be quoted as one.

**Sentiment and verdict are a model's judgement.** Constrained to fixed vocabularies, but
still one model reading another. Spot-check before anything reaches a deck.

**Verification is only as good as the fetch.** A paywalled or JS-heavy page comes back
`unreachable`, not `unsupported`. Don't read the two as the same thing.

**Source authority is a rule-based proxy.** Swap in your own DR/DA feed in `sources.js`.

**Absence has a floor.** "Seen in 0%" for a query means the assistant didn't name you in
those runs — not that it never would.

---

## Files

```
index.html                     the dashboard
app.js / app.css               wizard, browser engine, storage, Actions dispatch
viz.js / viz.css               the explorer
answer-space-explorer.html     one-file build of the explorer (npm run build:standalone)
build-standalone.mjs           makes it
records.json                   written by the Action; absent until the first run
.github/workflows/collect.yml  the Actions engine
pipeline/                      the Node CLI the Action runs, usable on its own
```
