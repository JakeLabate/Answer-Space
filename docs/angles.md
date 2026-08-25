[← Answer Space](../README.md)

# Angles

The buttons at the top of the explorer's left rail. They are the fastest way into a
dataset, and the most misread part of the UI — they look like saved searches or something
a model suggested, and they are neither.

**Angles are deterministic.** No model call, no stored state, no learning from what you
click. One plain function, `presets()` in `viz.js`, returns an array of button definitions;
`paintPresets()` renders them. The combinations they set were chosen by hand and written
into the source. The data decides only two things: **which angles appear**, and **three of
the labels**.

---

## What an angle does

Every angle is the same three moves, in the same order:

```js
out.push({
  n: "Head-to-heads we lose",                    // label
  s: "where the answer picks someone else",      // subtitle
  a: () => {
    resetF();                                    // 1 · clear every filter
    STATE.flags = new Set(["lost"]);             // 2 · set one specific combination
    STATE.matrix = {rows:"platform", cols:"theme", h:"citations"};
    setView("landscape");                        // 3 · switch to the view it reads in
  }
});
```

Three consequences worth knowing before you click one:

- **Angles are not additive.** Every `a()` starts with `resetF()`. Clicking two in a row
  leaves you in the second, not the intersection. To combine them, click one and then adjust
  the filter chips by hand.
- **The view switch is half the point.** A filter without the right geometry is a bad chart.
  `verdict = client loses` in Constellation is a hairball; in a platform × topic Landscape it
  is a map of where you are being beaten. The angle carries both.
- **What `resetF()` does not clear:** `sizeby`, and the grid/axis choices
  (`STATE.coverage`, `STATE.matrix`, `STATE.axes`) except where the angle sets them
  explicitly. Angles landing in Orbits or Constellation don't need a grid, so whatever you
  last set persists harmlessly.

## When the list is built

`paintPresets()` runs exactly twice: once at boot in `initUI()`, and once in `applyBundle()`
each time a dataset is adopted. So the list is computed **once per dataset**, then static.

It also scans **`RECORDS` and `ANSWERS` whole, not `SCOPE`** — the current filters do not
affect which angles are offered. An angle disappearing means your run genuinely contains no
such rows, not that you filtered them out.

---

## The eleven angles

### Where we never appear

| | |
|---|---|
| **Needs** | `ANSWERS.length` — a schema-2 bundle with answer-level rows |
| **Sets** | no filters; Coverage grid to platform × topic |
| **View** | Coverage |
| **Reads** | the **answer** table: `mentioned`, plus `volatility.flipped` for the amber rings |

**Why it's first.** It is the only angle that reads the answer table, so the only one that
can show a question you lost outright. Every other angle reads citations, and a citation only
exists once you were already in the answer. Schema-1 bundles have no `answers[]`, so this
angle is absent and the explorer opens on Constellation instead.

### Claims the page doesn't back

| | |
|---|---|
| **Needs** | any record with `support === "unsupported"` |
| **Sets** | `flags = {unsupported}` |
| **View** | Constellation |
| **Reads** | `records[].support`, written by the verification stage |

**Why.** This is the most actionable finding the tool produces: a named model, citing a named
page, for a claim that page does not make. Constellation because the useful shape is the
*thread* — which model, reading which source, on which question. Note this is `unsupported`
only; `unreachable` (paywall, JS-only, dead) is deliberately excluded, because a failed fetch
is not evidence of anything.

### Contradicts our own facts

| | |
|---|---|
| **Needs** | any record with a non-null `factConflict` |
| **Sets** | `flags = {conflict}` |
| **View** | Constellation |
| **Reads** | `records[].factConflict`, set by the extractor against your step-4 list |

**Why.** Absent entirely unless you filled in ground truth, which is the honest behaviour —
with no facts supplied there is nothing to contradict. Same threads-not-blobs reasoning as
above: you want the source and the model, because those are the two things you can act on.

### Head-to-heads we lose

| | |
|---|---|
| **Needs** | any record with `verdict === "client loses"` |
| **Sets** | `flags = {lost}`; Landscape grid to platform × theme, height = citations |
| **View** | Landscape |
| **Reads** | `records[].verdict` |

**Why a crosstab.** Losses are only meaningful in aggregate — one lost comparison is noise,
a tall bar at *Perplexity × pricing* is a pattern. And `verdict` is scored separately from
sentiment precisely so this angle can exist: an answer can be warm about you in every
sentence and still pick a rival at the end.

### Fixable today

| | |
|---|---|
| **Needs** | nothing — always offered |
| **Sets** | `influence = {owned, rented}` |
| **View** | Orbits |
| **Reads** | `records[].influence`, derived from source type at build time |

**Why.** The triage angle. `owned` you can edit this afternoon; `rented` (review platforms)
you can petition. Everything else — earned coverage, UGC — is a slower conversation. Orbits
because once the set is small, the question becomes "which of these does each model actually
lean on, and how early", and ring distance answers it.

### What the forums feed them

| | |
|---|---|
| **Needs** | nothing |
| **Sets** | `influence = {ugc}`; `brand = {client}` |
| **View** | Constellation |
| **Reads** | `records[].influence`, `records[].brand` |

**Why both filters.** UGC alone shows every forum thread the models read; adding the brand
filter narrows it to what is being said **about you**, which is the part you might respond
to. This is the angle that usually explains a bad Coverage cell — you are not absent because
nobody writes about you, you are absent because what they write is being read.

### Where the tone turns

| | |
|---|---|
| **Needs** | nothing |
| **Sets** | `band = {neg}`; Landscape grid to platform × theme, height = citations |
| **View** | Landscape |
| **Reads** | `records[].bandId` (derived: `sent ≤ −0.22`) |

**Why volume, not average.** Height is citation count, so the bars rank by *how much*
negative material exists, not by how negative it is. A single hostile citation and forty of
them average identically; only one of them is a problem.

### *Top platform*, close up

| | |
|---|---|
| **Needs** | at least one record (falls back to `PLATFORMS[0]`) |
| **Sets** | `platform = {topPlat}` |
| **View** | Orbits |
| **Label from** | `topOf("platform")` — the platform with the **most citation rows** |

**The caveat.** "Most citations" is not "most important". Platforms differ in how many
sources they cite per answer — Perplexity typically cites 3–7, Google AI Overviews 1–3 — so a
chatty citer wins this contest on style, not reach. Treat the label as "the one with the most
material to look at", and use Coverage if you want to know where you actually stand.

### Head-to-head with *rival*

| | |
|---|---|
| **Needs** | a brand that is not you, not a sibling, not `none` |
| **Sets** | `brand = {client, rival}`; Landscape grid to brand × theme, height = citations |
| **View** | Landscape |
| **Label from** | the **first** qualifying entry in `BRANDS` |

**The caveat, and it's a real one.** The rival is chosen **positionally, not by threat**. It
is whoever you typed first on the Check step — not the competitor who beats you most, appears
most, or outranks you most often. It is a shortcut into a two-brand comparison, not a verdict
about who your biggest problem is. Swap the brand chips by hand to compare against anyone
else.

### Authority vs affection

| | |
|---|---|
| **Needs** | nothing |
| **Sets** | Sentiment-space axes to `x = sentiment`, `y = citation volume`, `z = source authority`, one point per source |
| **View** | Sentiment space |
| **Reads** | `records[].sent`, counts, and `sources[].auth` |

**Why this particular triple.** It is the one question the other five views cannot pose: *do
the sources that like us carry any weight?* The shape you are hoping for is high-authority
sources on the positive side. The shape that hurts is your positive mass sitting at low
authority while a well-trusted domain sits alone on the negative side — that single point
moves more answers than a dozen friendly ones.

### *Worst topic*, the sore spot

| | |
|---|---|
| **Needs** | at least one record |
| **Sets** | `theme = {worstTheme}` |
| **View** | Constellation |
| **Label from** | `topOf("theme", …)` sorted by **mean sentiment ascending** |

**What "worst" means here.** Lowest average citation sentiment — the topic where what is
*said* about you is most negative. That is a different question from the topic you are least
*visible* on, which only Coverage can answer. A topic can be your sore spot and your best
coverage simultaneously: they show up, and it goes badly.

### Last *n* weeks

| | |
|---|---|
| **Needs** | `MAXWEEK > 2` — at least three weeks of snapshots |
| **Sets** | week window to `[MAXWEEK−5, MAXWEEK]`, then syncs the sliders |
| **View** | Timeline helix |
| **Reads** | `records[].week`, computed at build time from the first snapshot as epoch |

**Why gated at three.** Two points is not a trend, it is a line between two points. The label
counts itself (*"Last 4 weeks"* when you only have four), so it never promises more history
than you collected.

---

## The three data-derived labels, together

Only these three read your data to decide what they say. All three use `topOf(dim, fn)`,
which aggregates **all** records by a dimension and takes the first after sorting:

| Label | Sorted by | Reads | Fails gracefully by |
|---|---|---|---|
| `topPlat` | citation count, descending | `records[].platform` | falling back to `PLATFORMS[0]` |
| `worstTheme` | mean sentiment, ascending | `records[].theme`, `.sent` | omitting the angle |
| `rival` | **nothing — array position** | `brands[]` order | omitting the angle |

Everything else in the list — the label text, the subtitle, the filters, the grid, the view —
is a string literal in `viz.js`.

## Availability at a glance

| Angle | Offered when |
|---|---|
| Where we never appear | the bundle has `answers[]` (schema 2) |
| Claims the page doesn't back | ≥1 record `support === "unsupported"` |
| Contradicts our own facts | ≥1 record with a `factConflict` |
| Head-to-heads we lose | ≥1 record `verdict === "client loses"` |
| *Top platform*, close up | ≥1 record |
| Head-to-head with *rival* | ≥1 non-sibling competitor |
| *Worst topic*, the sore spot | ≥1 record |
| Last *n* weeks | `MAXWEEK > 2` |
| Fixable today · What the forums feed them · Where the tone turns · Authority vs affection | always |

A fresh single-snapshot run with verification off and no ground truth shows six angles. A
mature run with facts, verification and three months of history shows all eleven. The list
growing as your dataset matures is intended: an angle that renders an empty scene teaches
nothing.

## Reset

The **Reset** button in the Angles header is not an angle. It calls the same `resetF()` every
angle opens with, then returns to Coverage (or Constellation on schema-1 data) — the neutral
state, everything in scope.

---

## Writing your own

`presets()` is the whole surface. Push an object with `n`, `s`, and an `a()` that resets,
sets, and switches:

```js
out.push({n:"Stale data on review sites", s:"where they are reading last year's page",
  a:()=>{ resetF();
          STATE.f.stype = new Set(["review"]);
          STATE.f.influence = new Set(["rented"]);
          setView("orbits"); }});
```

Three conventions worth keeping:

1. **Start with `resetF()`.** An angle that inherits filters is not reproducible — the same
   button gives different results depending on what you clicked before it.
2. **Gate it on data.** Wrap it in a `has(...)` or a length check so it does not render an
   empty scene. The existing helper `has(flag)` scans `RECORDS` with `hasFlag`.
3. **Set the geometry too.** If it lands in Landscape or Coverage, set `STATE.matrix` or
   `STATE.coverage`; if it lands in Sentiment space, set `STATE.axes` and call
   `syncSelects()`. Otherwise the angle inherits a grid that may make nonsense of it.

Filter keys are the nine facets in `STATE.f` — `platform`, `stype`, `source`, `band`, `theme`,
`brand`, `intent`, `verdict`, `influence` — each a `Set` of ids from
[the vocabularies](taxonomies.md). Flags are the four in `STATE.flags`, evaluated by
`hasFlag()`: `unsupported`, `conflict`, `risk`, `lost`.

Note that `risk` has no angle of its own — records carrying a `risks[]` tag are reachable
only through the filter rail. It is a reasonable twelfth to add.

---

[Creating a run](user-flow.md) · [The six views](visualisations.md) · Angles · [The data model](data-model.md) · [Architecture](architecture.md) · [The vocabularies](taxonomies.md)
