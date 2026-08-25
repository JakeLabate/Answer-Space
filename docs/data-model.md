[← Answer Space](../README.md)

# The data model

How a sentence an assistant said becomes a row you can filter on.

The central design decision is that there are **two tables, not one**. Almost every tool in
this space keeps only the citation table, and the citation table cannot represent a question
you lost — a citation only exists once you were already in the answer. So every answer gets
a row whether or not you appear in it, and citations hang off those rows.

```
                one model call
query × platform × repeat ─────► raw answer  { text, citations[] }
                                     │
                       extraction (1 call per answer)
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
        answers[]  one row per answer           records[]  one row per citation
        can be empty of you                     only exists when you appear
                 │                                       │
                 └──────► volatility[]  ◄────────────────┘
                          same query, same model, repeats compared
```

---

## Stage by stage

### 1 · Profile

Domain (+ optional product hint) → `{ brand, product, aliases[], category, competitors[],
themes[] }`. Competitors get ids `comp0…`, or `sib0…` when you mark one as a brand you own.
Everything downstream keys off this: the brand roster the extractor may choose from, the
topics questions are grouped under, and `ownDomains`, which is how a source gets classified
as *owned*.

### 2 · Query set

60 queries, each `{ id, text, intent, theme, brandLed }`. Roughly 60% do not name the brand.
The set carries a `version` and is **frozen** after the first run — week-over-week
comparability is the only reason any of the numbers mean anything, and regenerating the set
destroys it. Old snapshots keep the queries they were collected with.

### 3 · Collect

One raw record per (channel × query × repeat), appended as it arrives:

```jsonc
{ "aid": "2026-08-25-claude-q17-r2",
  "date", "channel", "channelName", "promptId", "query", "theme", "intent", "repeat",
  "absent": false,          // AI Overviews: the SERP had no overview at all — recorded, not dropped
  "text": "…the full answer…",
  "citations": [ { "rank": 1, "url", "host", "title", "snippet" } ] }
```

`aid` is deterministic, which is what makes a re-run of the same date resume rather than
duplicate.

### 4 · Extract

One structured model call per answer, constrained to fixed enums (see
[taxonomies.md](taxonomies.md)). It returns two readings of the same answer:

**Answer-level** — `refused`, `clientMentioned`, `clientRecommended`, `answerSummary`, and
`brandsMentioned[]` with each brand's `order` (1 = named first), whether it was
`recommended`, and a rough `sharePct` of the answer's words.

**Citation-level** — for each numbered citation: which `brand` it was used to support,
`sentiment` about *that* brand, `tone`, `verdict`, the `claim` it supported (≤20 words), the
`evidence` sentence verbatim (≤45 words), `nuance[]`, `risks[]`, and `factConflict` when the
answer contradicts one of your ground-truth lines.

Sentiment is scored about the brand the citation was used to support — not the mood of the
answer overall. Those come apart constantly.

### 5 · Verify

Distinct `(source, claim)` pairs are re-opened through a search-capable assistant, which is
asked whether the page actually supports that claim. Deduplicated, because the same claim
recurs across runs and one check settles every instance; capped, because it is the most
expensive stage per unit of insight.

Result is one of four values, and the difference between the middle two matters:

| `support` | Means |
|---|---|
| `verified` | The page says it. |
| `unsupported` | The page was read and does not say it. **The most actionable finding here.** |
| `unreachable` | Paywall, JS-only, dead link. Not evidence of anything. |
| `unchecked` | Verification was off, or the cap was hit. |

### 6 · Build

Joins every snapshot on disk into the bundle. Classifies each cited host into a source type
and an authority score, derives `influence` from the type, computes week numbers from the
first snapshot as epoch, and calculates volatility per (query × platform).

---

## The bundle (`records.json`, schema 2)

```jsonc
{
  "meta": { "schema": 2, "brand", "product", "site", "generated", "weeks",
            "promptSetVersion", "snapshots": ["2026-08-25", …],
            "hasFacts", "verified", "demo" },

  "platforms": [{ "id", "name" }],
  "themes":    [{ "id", "name" }],
  "brands":    [{ "id", "name", "client"?, "sibling"? }],
  "prompts":   [{ "id", "text", "intent", "theme" }],
  "sources":   [{ "id", "dom", "type", "auth", "influence" }],

  "answers": [{                          // ← the half that can see absence
    "aid", "platform", "prompt", "theme", "intent", "week", "repeat",
    "refused": false,
    "mentioned": false,                  // named at all
    "recommended": false,                // actually recommended, not merely named
    "first": "comp0",                    // whoever was named first, or null
    "brands": [{ "brand", "order", "recommended", "share" }],
    "cites": 4,
    "sources": ["reddit-com", "g2-com"]  // deduped hosts, for the overlap metric
  }],

  "records": [{                          // ← one per citation
    "id", "aid",                         // aid joins back to the answer above
    "platform", "prompt", "theme", "intent", "week",
    "source", "stype", "influence", "auth", "rank",
    "brand", "sent", "bandId", "tone", "verdict",
    "claim", "text",                     // text = the evidence sentence, verbatim
    "nuance": [], "risks": [],
    "factConflict": null,
    "support": "unsupported", "supportNote", "url"
  }],

  "volatility": [{ "prompt", "platform", "runs",
                   "appearRate", "flipped", "firstBrandChurn", "sourceOverlap" }]
}
```

### Volatility, computed not asked

For every (query × platform) group with 2+ runs:

| Field | Definition |
|---|---|
| `appearRate` | fraction of repeats you were named in |
| `flipped` | `0 < appearRate < 1` — the result is not stable |
| `firstBrandChurn` | more than one distinct brand came first across repeats |
| `sourceOverlap` | mean pairwise Jaccard of the source sets — how much the models' reading changed between identical questions |

`flipped` is what draws the amber ring in Coverage.

### Why these fields are separate from sentiment

| Field | Kept separate because |
|---|---|
| `verdict` | An answer can be warm about you and still pick a rival. Wins and losses are their own axis. |
| `risks` | A guarantee that doesn't exist is a problem however cheerfully it is phrased. |
| `influence` | Owned / rented / earned / UGC — turns a finding into a work item with an owner. |
| `support` | Whether the cited page backs the claim is a fact about the page, not about tone. |
| `factConflict` | Contradicting your own price list is not a sentiment score. |
| `nuance` | 16 fixed tags for *how* a citation helps or hurts — buried, stale, own-domain echo, competitor favoured… |

### Derived at read time, never stored

Authority, prominence, spread, client share and brand-top are computed in `enrich()` in
`viz.js` from the records in scope. Nothing pre-aggregates, which is why every filter
combination produces a correct number rather than an approximate one.

### Schema 1

Older bundles still load. They have no `answers[]`, so Coverage says it has no answer-level
data and the explorer opens on Constellation instead. Everything else works.

### The vocabularies are shared, and must stay that way

`pipeline/src/taxonomy.js` and the top of `app.js` define the same enums twice, once for
each engine. **Change them in both places or not at all** — otherwise the browser and the
Actions engine disagree about what a citation is, and the two halves of your history stop
being comparable. Details in [taxonomies.md](taxonomies.md).

---

[Creating a run](user-flow.md) · [The six views](visualisations.md) · [Angles](angles.md) · The data model · [Architecture](architecture.md) · [The vocabularies](taxonomies.md)
