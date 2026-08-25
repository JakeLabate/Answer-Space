import { structured } from "./llm.js";
import { TONES, NUANCE, VERDICTS, RISKS } from "./taxonomy.js";

/* Two readings of one answer.

   The answer-level half records whether the brand appeared at all, where, and
   whether it was actually recommended. That is the half a citation table can
   never give you: a citation only exists when you were already in the answer,
   so a pure citation model is blind to every question you lost outright.

   The citation-level half records what each source was made to say. */

export function brandRoster(profile) {
  const rows = [`client = ${profile.brand}${profile.product ? ` (${profile.product})` : ""}`
    + (profile.aliases?.length ? ` — also called ${profile.aliases.join(", ")}` : "")];
  profile.competitors.forEach((c, i) =>
    rows.push(`${c.sibling ? "sib" : "comp"}${i} = ${c.name}`
      + (c.sibling ? "  ← OWNED BY the client; not a rival" : "")));
  rows.push("none = supports no tracked brand");
  return rows.join("\n");
}
export function brandIds(profile) {
  return ["client", ...profile.competitors.map((c, i) => (c.sibling ? "sib" : "comp") + i), "none"];
}

export async function extractAnswer({ profile, channelName, query, answer, citations, facts }) {
  const ids = brandIds(profile);
  const named = ids.filter((b) => b !== "none");
  const numbered = citations.map((c, i) =>
    `[${i + 1}] ${c.host || c.url} — ${c.title || "(untitled)"}`
    + (c.snippet ? `\n    quoted: "${String(c.snippet).slice(0, 240)}"` : "")).join("\n");
  const hasFacts = !!(facts || "").trim();

  const schema = {
    type: "object",
    properties: {
      refused: { type: "boolean", description: "the assistant declined or said nothing substantive" },
      clientMentioned: { type: "boolean" },
      clientRecommended: { type: "boolean", description: "actually recommended, not merely named" },
      answerSummary: { type: "string" },
      brandsMentioned: {
        type: "array",
        items: { type: "object", properties: {
          brand: { type: "string", enum: named },
          order: { type: "integer", description: "1 = named first" },
          recommended: { type: "boolean" },
          sharePct: { type: "integer", description: "rough share of the answer's words, 0-100" },
        }, required: ["brand", "order", "recommended", "sharePct"] },
      },
      citations: {
        type: "array",
        items: { type: "object", properties: {
          index: { type: "integer" },
          brand: { type: "string", enum: ids },
          sentiment: { type: "number", description: "-1 hostile … +1 glowing, about the brand in `brand`" },
          tone: { type: "string", enum: TONES },
          verdict: { type: "string", enum: VERDICTS },
          claim: { type: "string", description: "the assertion this source supported, <=20 words" },
          evidence: { type: "string", description: "the sentence carrying this citation, verbatim, <=45 words" },
          nuance: { type: "array", items: { type: "string", enum: NUANCE } },
          risks: { type: "array", items: { type: "string", enum: RISKS } },
          ...(hasFacts ? { factConflict: { type: "string",
            description: "the ground-truth line this contradicts, quoted briefly; empty when nothing conflicts" } } : {}),
        }, required: ["index", "brand", "sentiment", "tone", "verdict", "claim", "evidence", "nuance", "risks"] },
      },
    },
    required: ["refused", "clientMentioned", "clientRecommended", "answerSummary", "brandsMentioned", "citations"],
  };

  const factBlock = hasFacts
    ? `\n\nGROUND TRUTH — verified facts supplied by the client. If the answer states something that `
      + `contradicts a line here, set factConflict to the contradicted line, quoted briefly. Do not flag `
      + `things this list is simply silent about.\n${facts.slice(0, 6000)}\n`
    : "";

  return structured({
    name: "extraction", schema, maxTokens: 8000,
    system:
      "You are auditing one AI assistant answer for a brand-visibility study. Work only from the text given.\n" +
      "Score sentiment about the brand the citation was used to support — not the overall mood of the answer, " +
      "and not your own view of the brand. General or definitional points get brand = none, sentiment = 0.\n" +
      "`verdict` is separate from sentiment: an answer can speak warmly about the client and still conclude a " +
      "rival is the better choice. Use 'not compared' unless the text really adjudicates.\n" +
      "`risks` is for claims creating legal or trust exposure regardless of tone. Leave it empty far more often than not.\n" +
      "Return exactly one entry per numbered citation, in order. Never invent citations.",
    user: `Assistant: ${channelName}\nQuery: "${query}"\n\nBrand roster:\n${brandRoster(profile)}\n`
      + factBlock + `\nCited sources:\n${numbered || "(the answer cited nothing)"}\n\n---\nANSWER TEXT:\n${answer}`,
  });
}

/* Re-open the cited page and ask whether it says what the answer claimed.
   Uses whichever channel has a search tool, because a plain fetch cannot read
   a JS-rendered page and half the web is one. */
export async function verifyClaim({ ask, url, claim }) {
  const res = await ask(
    `Open this page and read it: ${url}\n\nQuestion: does that page actually support this claim?\n"${claim}"\n\n`
    + `Reply with exactly one word on the first line — SUPPORTED, UNSUPPORTED, or UNREACHABLE — then one short `
    + `sentence of justification. UNSUPPORTED means the page loads but does not say this.`);
  const t = (res.text || "").trim();
  const w = (t.match(/\b(SUPPORTED|UNSUPPORTED|UNREACHABLE)\b/i) || [])[1];
  return { support: w ? w.toLowerCase() : "unreachable",
           note: t.split("\n").slice(1).join(" ").slice(0, 220) || t.slice(0, 220) };
}
