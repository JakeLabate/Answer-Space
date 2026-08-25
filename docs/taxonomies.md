[← Answer Space](../README.md)

# The controlled vocabularies

Every categorical field the extractor produces is constrained to a fixed list. Nothing here
is free text.

That is a deliberate trade. Free-text tags are richer for about a week, after which you have
forty spellings of "buried in a list", the filter chips become meaningless, and month three
is no longer comparable with month one. Fixed enums lose nuance the list didn't anticipate,
and keep everything else countable.

**The lists live in two places** — `pipeline/src/taxonomy.js` and the top of `app.js` —
because there are two engines and neither imports the other. Change them in both or not at
all. If they drift, the browser and Actions engines disagree about what a citation is, and
the two halves of your history stop being comparable.

---

## Source types

Assigned by rule from the cited host, not by the model. Each carries a default authority
score, which is a **proxy** — swap in a real DR/DA feed in `pipeline/src/sources.js` if you
have one.

| `stype` | Name | Typical hosts | Default authority |
|---|---|---|---|
| `community` | Community & forum | reddit, quora, trustpilot, HN, stackexchange, x | .55 |
| `editorial` | Editorial & news | reuters, wsj, bloomberg, verge, techcrunch, forbes | .84 |
| `review` | Review & compare | g2, capterra, trustradius, nerdwallet, pcmag, cnet | .75 |
| `owned` | Owned / brand | anything on your domains or a competitor's | .88 |
| `reference` | Reference & docs | wikipedia, investopedia, `.gov`, `.edu`, `docs.*` | .80 |
| `video` | Video & social | youtube, tiktok, medium, substack, linkedin | .42 |

Anything unmatched falls through to `editorial` at .45 — a deliberately low score, so an
unknown host never outranks a known one by accident.

## Influence — derived from source type

The field that turns a finding into a work item, because it answers "can anyone do anything
about this before Friday?"

| `influence` | From | Means |
|---|---|---|
| `owned` | owned | Edit it today. |
| `rented` | review | Petition the platform. You can ask; you cannot edit. |
| `earned` | editorial, reference | Pitch a correction. |
| `ugc` | community, video | Participate. You cannot control it. |

A finding on an owned source is a task. The same finding on a community source is a
communications problem. Grouping them under one "negative mentions" number hides which is
which.

## Query intents

| `intent` | Name |
|---|---|
| `compare` | Comparison |
| `recommend` | Recommendation |
| `howto` | How-to / setup |
| `info` | Informational |
| `problem` | Problem / complaint |

Assigned when the query set is written, not at extraction time, so intent is a property of
the question rather than of the answer. That is what lets you say "we do fine on how-to and
vanish on recommendation".

## Tones — 12 values

`Endorsing` · `Enthusiastic` · `Recommending` · `Reassuring` · `Neutral-factual` ·
`Descriptive` · `Hedged` · `Comparative` · `Cautionary` · `Skeptical` · `Dismissive` ·
`Warning`

Tone is the *register* of the sentence. It sits alongside the numeric `sentiment` (−1…+1)
rather than replacing it, because "Hedged at +0.1" and "Neutral-factual at +0.1" are
different problems.

## Verdicts — 4 values

`client wins` · `client loses` · `tie` · `not compared`

Kept separate from sentiment on purpose. An answer can be warm about you in every sentence
and still pick a rival at the end. Wins and losses are their own axis, and `not compared` —
the answer never adjudicated — is a real state rather than a missing value.

## Risks — 6 values

`overstated guarantee` · `misstated price` · `misstated availability` · `misstated policy` ·
`regulatory or safety claim` · `unverifiable claim about us`

Claims that create legal or trust exposure **regardless of tone**. An assistant enthusing
about a guarantee you do not offer is maximally positive and maximally dangerous, and a
sentiment score cannot represent that.

## Nuance — 16 values

The tags that carry *why* a citation helps or hurts, beyond the number:

| | |
|---|---|
| `first citation` | Cited first — the position that gets read. |
| `buried citation` | Present, late, effectively invisible. |
| `listed as alternative only` | Named as an also-ran, not a candidate. |
| `recommendation list` | Part of an explicit shortlist. |
| `comparison table` | Rendered in a table, where a bad row is very legible. |
| `direct quote` | Your words reproduced verbatim. |
| `paraphrased` | Your words reinterpreted. |
| `anecdote as evidence` | One person's story, presented as the state of things. |
| `unsourced claim` | Asserted with no citation behind it. |
| `stale data` | Out of date at the time of the answer. |
| `own-domain echo` | Your own site cited back at you — reach without independence. |
| `negative from authority` | A bad claim from a high-authority source. The expensive kind. |
| `competitor favoured` | A rival preferred in the same breath. |
| `brand confusion` | You mistaken for a sibling, a parent, or someone else entirely. |
| `conditional endorsement` | "Good, *if* you…" |
| `damning with faint praise` | Positive on the surface, negative in effect. |

Capped at three per citation, so the tag list stays a signal rather than a shrug.

## Sentiment bands

Sentiment is a number in −1…+1; the band is a derived bucket used for filtering and colour.

| `bandId` | Range |
|---|---|
| `neg` | ≤ −0.22 |
| `neu` | between |
| `pos` | ≥ +0.22 |

## Support — 4 values

`verified` · `unsupported` · `unreachable` · `unchecked`

Produced by the verification stage, not by the extractor. `unreachable` and `unsupported`
must never be read as the same thing: the first means a paywall or a JS-only page defeated
the fetch, the second means the page was read and does not say it.

## Brand ids

| Id | Is |
|---|---|
| `client` | you |
| `comp0`, `comp1`, … | competitors, in the order on the Check step |
| `sib0`, `sib1`, … | brands you own — tracked, never scored as rivals |
| `none` | the citation supports no tracked brand |

The extractor is given this roster as an enum and cannot invent a brand outside it. A rival
missing from step 3 is therefore not merely untracked — it is unrepresentable, and every
answer that recommends them reads as an answer about nobody.

---

## Adding a value

1. Add it to `pipeline/src/taxonomy.js`.
2. Add it to the mirrored constant at the top of `app.js`.
3. If it needs a filter chip, add it to the corresponding list in `viz.js` (`BANDS`,
   `VERDICTS_L`, `INFLUENCES`, `FLAGS`) — chips are built from these, not from the data.
4. Accept that snapshots collected before the change cannot contain it. Old rows are not
   wrong; they were scored against a smaller vocabulary, which is its own reason to change
   these lists rarely.

---

[Creating a run](user-flow.md) · [The six views](visualisations.md) · [Angles](angles.md) · [The data model](data-model.md) · [Architecture](architecture.md) · The vocabularies
