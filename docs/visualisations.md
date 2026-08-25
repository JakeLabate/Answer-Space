[← Answer Space](../README.md)

# The six views

One dataset, six projections of it, in `viz.js`. They are not six charts of six metrics —
they are six answers to six different questions, and picking the wrong one is how you end
up looking at a beautiful picture of nothing.

All six share the same filter rail, the same colour rules, the same selection model and the
same `Table` button. Switching view never changes what is in scope; it changes the geometry
scope is drawn in.

| View | Answers | Reads from |
|---|---|---|
| **Coverage** | Did we appear at all? | the **answer** table |
| **Constellation** | Which sources feed which model, on which question? | citations |
| **Orbits** | What does one platform lean on, and how early? | citations |
| **Sentiment space** | Which sources are outliers on the axes I care about? | citations |
| **Landscape** | Where in the platform × topic crosstab are we losing? | citations |
| **Timeline helix** | Which way is each platform drifting? | citations, by week |

---

## Coverage — the only view that can see absence

**Start here.** It is the only view built on the answer table rather than the citation
table, and therefore the only one that can show a question you lost outright.

Every cell of the platform × topic grid is a **wireframe cage** sized to *all* the answers
in that cell. The **solid block inside** is the share you were actually named in. Block
colour is the average tone of what was said about you there; a cell you never appear in
draws as an empty cage with a red `0%`.

An **amber ring** on top of the block means at least 40% of that cell's (query × platform)
pairs *flipped* between repeats — named in one run, missing in the next. Averages hide
that; the ring is there so a 67% cell doesn't get read as a stable 67%.

Rows and columns are both switchable between platform, topic, intent and query.

> Why it exists: a citation only exists when you were already in the answer. Any tool built
> on citations alone is structurally blind to every question where you never came up, which
> is the set you most need to see.

## Constellation — the supply chain of an answer

Three shells: **platforms** in the middle, the **queries** they answered around them, the
**sources** they leaned on outside. Each thread is drawn for a platform→query or
query→source pair, thread weight is how many citations it carries, and thread colour is the
average tone of *what was said*, not merely that a link was made.

That colour rule is the point. A bright red bundle running into `reddit.com` is not "Reddit
gets cited a lot" — it is a source feeding a model a bad story about you, on named
questions, and both ends of the thread are clickable.

Best paired with a flag filter: `Page doesn't back it` or `Contradicts our facts` turns the
whole scene into a shortlist.

## Orbits — one platform, close up

One solar system per AI platform. The hexagon at the centre is the model; the planets are
its top 12 sources.

- **Ring distance** = how early in the answer that source is cited. Inner rings are cited
  first, and first is what gets read.
- **Planet size** = citation volume (or whatever `Size marks by` is set to).
- **Planet colour** = sentiment, by default.

Use it when the question is "what is *this* assistant actually reading", and pair it with
the `Fixable today` angle to see only sources you own or can petition.

## Sentiment space — free axes, for outliers

A 3D scatter with all three axes under your control. Any of: average sentiment, citation
volume, answers appeared in, source authority, answer prominence, client share of mentions,
sentiment spread. Points can be sources, platforms, queries, topics or brands.

This is the exploratory view — the one for questions you haven't phrased yet. The stock
angle **Authority vs affection** (sentiment × volume × authority) asks whether the sources
that like you carry any weight, which is a question the other five views cannot pose.

Drop-lines to the floor plane keep depth readable, and a zero plane is drawn whenever an
axis is a diverging metric.

## Landscape — a 3D crosstab

Bars on a grid you define: rows and columns from platform, topic, source, brand, intent or
query; height from citations, answers appeared in, or share of citations; colour from tone.

The shape you are looking for is **tall and red** — high volume, bad tone — because that is
where a lot of people are being told something you would rather they weren't. Tall and blue
is working; short and anything is a topic you barely register on, which Coverage will
explain better.

## Timeline helix — drift, not level

Weeks wound into a spiral, one strand per platform, week 1 at the base. Node size is
citation volume that week, node colour is that week's average tone, and each strand is
labelled with its change across the visible window.

**Watch colour drift, not height.** Volume moves with how many queries you ran; tone moves
because something changed in what the models read. Selecting a source, topic, brand or
query cuts every strand to that slice, which is how you ask "did our tone on pricing move
after the March change, on every platform at once".

Needs more than one snapshot to say anything at all.

---

## The controls all six share

### Angles (presets)

The buttons at the top of the left rail are not bookmarks. Each one resets every filter, sets
one hand-authored combination, and switches to the view that combination is legible in:

| Angle | Sets | Lands in |
|---|---|---|
| Where we never appear | nothing — platform × topic grid | Coverage |
| Claims the page doesn't back | `support = unsupported` | Constellation |
| Contradicts our own facts | `factConflict` present | Constellation |
| Head-to-heads we lose | `verdict = client loses` | Landscape |
| Fixable today | influence ∈ {owned, rented} | Orbits |
| What the forums feed them | influence = ugc, our brand only | Constellation |
| Where the tone turns | negative band only | Landscape |
| *Top platform*, close up | that platform only | Orbits |
| Head-to-head with *rival* | us vs them, brand × topic | Landscape |
| Authority vs affection | axes: sentiment × volume × authority | Sentiment space |
| *Worst topic*, the sore spot | that topic only | Constellation |
| Last *n* weeks | recent week window | Timeline helix |

The combinations are fixed in the source — no model chose them and nothing learns from what
you click. Your data decides only which angles are offered and three of the labels, and the
positional way the *rival* is picked is worth knowing before you read anything into it.
**[Angles, in full →](angles.md)**

### Filters

Nine independent facets — platform, source type, individual source, sentiment band,
head-to-head verdict, influence, topic, brand mentioned, query intent — plus four flags
(`unsupported`, `conflict`, `risk`, `lost`) and a week window. Chips carry live counts
computed against every *other* facet, so a zero tells you the combination is empty before
you click it. Click toggles, shift-click isolates.

Answers carry no source, so on Coverage only the facets that exist on an answer apply:
platform, topic, intent and week.

### Encoding

- **Colour** has exactly one job by default: sentiment, on a diverging red→grey→blue ramp.
  The categorical modes cap at three validated hues plus a neutral "other", and always ship
  a text label, so colour is never the only channel carrying meaning.
- **Size** is citation volume by default; also authority, answer prominence, or uniform.

### Selection

Click any node, bar or cell. The right rail fills with the records behind it — claims,
evidence sentences, verdicts, nuance tags, risks, support status and the live URL.
Everything not connected to the selection dims rather than disappearing, so you keep the
context you drilled in from. `Table` renders the same scope as sorted rows, without colour
as a channel, for the cases where you need to read exact numbers or paste them somewhere.

---

[Creating a run](user-flow.md) · The six views · [Angles](angles.md) · [The data model](data-model.md) · [Architecture](architecture.md) · [The vocabularies](taxonomies.md)
