[← Answer Space](../README.md)

# Creating a run

Seven steps, in order, in one page. Nothing is hidden behind a menu and nothing is
skippable except step 4. The wizard state lives in `CFG.step` and survives a reload, so
you can close the tab in the middle of setup and come back to the same screen.

Every step has the same Back/Next bar in the same place. Next is either enabled, or
replaced by the reason it isn't — the gates are listed below, and they are all in `FLOW`
in `app.js`.

```
Connect → Website → Check → Facts → Questions → Run → Results
  key      profile   edit    truth    frozen     collect  explore
                                       set        extract
                                                  verify
                                                  build
```

---

## 1 · Connect — add an AI key

Pick a channel and paste its key. Only two can be driven from a web page:

| Channel | In the browser | Why |
|---|---|---|
| Claude | yes | Anthropic sends CORS headers. Returns the exact sentence it cited. |
| Gemini | yes | Google Search grounding; citations are redirect links, resolved automatically. |
| ChatGPT | no | OpenAI sends no CORS headers. |
| Perplexity | no | Same. Richest citation payload once it does run. |
| Google AI Overviews | no | No first-party API; SerpApi refuses browser calls outright. |

The three that cannot run here are not dead ends — they run on GitHub Actions, set up from
step 6. **One Anthropic key is enough to use the whole tool**, because Claude is also the
default *worker*: the model that profiles your site, writes the query set, reads each
answer back, and checks claims. `workerKind()` prefers Anthropic, falls back to Gemini.

**Demo mode** replaces both the channels and the worker with a local fabricator. It
invents a company, a query set, answers, citations, verifications and conflicts. Nothing
is sent anywhere and nothing is charged. It exists so you can walk all seven steps before
deciding whether to pay for anything. `Reset` in the header wipes it.

> **Gate on Next:** a worker must exist — a key for Anthropic or Gemini, or demo mode on.

## 2 · Website — who we're checking

A domain, plus an optional "which product, exactly?" hint. The worker fetches the site,
reads it, and returns a profile: brand, product, aliases, category, 3–6 named competitors,
and the decision topics buyers argue about in this category.

The hint matters for multi-product companies. A bank that sells cards, loans and savings
will otherwise be measured on whichever one the homepage shouts loudest about.

> **Gate on Next:** a profile exists — press **Analyse site** first.

## 3 · Check — brand & rivals

The one screen worth slowing down on, because everything downstream is built from it.

- **Brand, product, aliases.** Aliases are the other names people type. They feed the
  extractor's brand roster, so a missing alias reads as an absence.
- **Competitors.** Anyone a buyer might shortlist instead of you. Tick **sibling** for a
  brand you own — it becomes `sib{n}` rather than `comp{n}`, so it is tracked without being
  scored as a rival. Assistants confuse parent companies with their brands constantly, and
  this is how you see it happening.
- **Topics.** Two or three words each; longer labels get clipped in the charts. Questions
  are grouped under these, which is what makes "invisible on pricing, fine on security" a
  statement you can make.

A rival you leave off this list is a rival you will never catch being recommended over you.

> **Gate on Next:** a profile exists.

## 4 · Facts — ground truth (optional)

One plain statement per line: real prices, real limits, real inclusions, with dates where
they matter. Every answer is checked against the list, and contradictions come back as
`factConflict` on the citation that carried them.

The extractor is instructed to flag **direct contradictions only** and to stay silent about
anything the list does not cover. A short accurate list therefore beats a long speculative
one. Leave it empty and the whole mechanism is simply off — the schema drops the field.

> **Gate on Next:** profile + worker. **Next also does work here:** leaving this step is
> what writes the query set, so the button says *Writing your questions…* while it runs.

## 5 · Questions — what we'll ask

Sixty queries, written by the worker from your profile, each tagged with an intent and a
topic. About 60% deliberately **do not name your brand** — those are the ones that discover
whether you surface at all when someone asks about the category rather than about you.

Edit the text, intent or topic of any row; add rows; delete rows. Then leave them alone.
The set carries a `version`, and comparing one month to the next only means something if
the questions stayed the same — **Regenerate all** bumps the version and breaks that
comparison on purpose, so it is a deliberate act rather than a stray click.

> **Gate on Next:** at least one query exists.

## 6 · Run — collect answers

Three numbers and a toggle:

| Control | What it does |
|---|---|
| How many questions | Takes the first *n* of the frozen set. |
| How many times each | Repeats, 1–5. **This is the measurement, not a setting.** |
| Date to file this under | The snapshot key. Same date twice resumes rather than duplicates. |
| Check cited pages | Verification on/off, plus a cap on how many claims to check. |

Then four phases run in order, each writing to IndexedDB as it goes:

1. **Collect** — every (channel × query × repeat) is one search-enabled model call, three
   at a time. Answers are flushed every 10 records, so closing the tab loses the call in
   flight and nothing else. Re-running the same date skips answers already stored.
2. **Extract** — one plain model call per answer, reading it back into structured rows.
3. **Verify** — cited pages are re-opened through a search-capable assistant and asked
   whether they support the claim they were used for. Deduplicated by `(source, claim)`
   and capped by you, two at a time.
4. **Build** — joins everything on disk into the bundle the explorer reads.

**Why repeats.** Ask the same model the same question three times and you get three
answers. Being named in 3 of 3 is a different competitive position from 2 of 3, and one
repeat cannot tell them apart — it reports whichever roll it got. Three is the floor.

**Start small:** 5 questions × 1 repeat, verification off, is a few cents and proves the
whole chain works.

### The Actions panel, further down the same step

For the three channels a browser cannot reach. Enter `owner/repo` and a fine-grained PAT
with `contents:write` + `actions:write`, then **Trigger workflow**. It pushes
`pipeline/data/profile.json`, `prompts.json` and `facts.txt` into the repo *first*, so the
Action measures what you configured rather than whatever was committed last. **Pull latest
records.json** adopts the result when the run finishes. The workflow also runs Mondays at
06:00 UTC until you delete its `schedule:` block.

> **Gate on Next:** a built bundle exists.

## 7 · Results — see how you did

Headline metrics, then **Open the explorer** — six views over the same run, documented in
[visualisations.md](visualisations.md). `records.json` can be downloaded here and imported
on another machine, which is the no-account way to move a run between browsers.

Signed in, this step also grows a **run history**: every snapshot as a dated row plus a
trend of how often you were named and how often you were actually recommended. One snapshot
is a position; only the line between snapshots is a direction.

---

## What each step writes

| Step | Writes | Where |
|---|---|---|
| Connect | `CFG.keys` | `localStorage` — or, signed in, encrypted into `api_keys` and *not* here |
| Website | `CFG.profile` | `localStorage` (+ `workspaces`) |
| Check | `CFG.profile` | same |
| Facts | `CFG.facts` | same |
| Questions | `CFG.prompts` | same |
| Run | `ans:`, `ext:`, `ver:` per date | IndexedDB (+ `snapshots.raw`) |
| Run (build) | `bundle` | IndexedDB |
| Results | `records.json` | your download folder, or the repo via Actions |

Local is always written before the cloud, so a failed sync can never cost you a run.
See [architecture.md](architecture.md) for the storage layers in full.

---

Creating a run · [The six views](visualisations.md) · [The data model](data-model.md) · [Architecture](architecture.md) · [The vocabularies](taxonomies.md)

---

Creating a run · [The six views](visualisations.md) · [Angles](angles.md) · [The data model](data-model.md) · [Architecture](architecture.md) · [The vocabularies](taxonomies.md)
