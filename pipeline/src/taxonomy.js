/* The controlled vocabularies. The visualisation's filters are built from these,
   so the extractor is forced to choose from them — free-text tags would make the
   chips meaningless within a week. Edit here, edit the viz, never one alone. */

export const SOURCE_TYPES = [
  { id: "community", name: "Community & forum" },
  { id: "editorial", name: "Editorial & news" },
  { id: "review",    name: "Review & compare" },
  { id: "owned",     name: "Owned / brand" },
  { id: "reference", name: "Reference & docs" },
  { id: "video",     name: "Video & social" },
];

export const INTENTS = [
  { id: "compare",   name: "Comparison" },
  { id: "recommend", name: "Recommendation" },
  { id: "howto",     name: "How-to / setup" },
  { id: "info",      name: "Informational" },
  { id: "problem",   name: "Problem / complaint" },
];

export const TONES = [
  "Endorsing", "Enthusiastic", "Recommending", "Reassuring",
  "Neutral-factual", "Descriptive", "Hedged", "Comparative",
  "Cautionary", "Skeptical", "Dismissive", "Warning",
];

/* Nuance is the whole point of the tool: WHY a citation helps or hurts,
   beyond the sentiment number. Keep this list short enough to filter on. */
export const NUANCE = [
  "first citation", "buried citation", "listed as alternative only", "recommendation list",
  "comparison table", "direct quote", "paraphrased", "anecdote as evidence", "unsourced claim",
  "stale data", "own-domain echo", "negative from authority", "competitor favoured",
  "brand confusion", "conditional endorsement", "damning with faint praise",
];

/* Who came out ahead, when the answer actually adjudicates. Kept separate from
   sentiment on purpose: an answer can be warm about you and still pick a rival. */
export const VERDICTS = ["client wins", "client loses", "tie", "not compared"];

/* Claims that are a trust or legal problem regardless of how warmly they are put. */
export const RISKS = [
  "overstated guarantee", "misstated price", "misstated availability", "misstated policy",
  "regulatory or safety claim", "unverifiable claim about us",
];

/* Can you do anything about this source before Friday? */
export const INFLUENCE = { owned:"owned", review:"rented", editorial:"earned",
                           reference:"earned", community:"ugc", video:"ugc" };

export const CHANNELS = [
  { id: "chatgpt",    name: "ChatGPT",             env: "OPENAI_API_KEY",     module: "openai" },
  { id: "claude",     name: "Claude",              env: "ANTHROPIC_API_KEY",  module: "anthropic" },
  { id: "perplexity", name: "Perplexity",          env: "PERPLEXITY_API_KEY", module: "perplexity" },
  { id: "gemini",     name: "Gemini",              env: "GEMINI_API_KEY",     module: "gemini" },
  { id: "aio",        name: "Google AI Overviews", env: "SERPAPI_KEY",        module: "aioverview" },
];
