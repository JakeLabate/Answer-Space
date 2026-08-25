import { structured } from "./llm.js";
import { INTENTS } from "./taxonomy.js";

/* Step 1 — the only thing you type is a domain. Everything else is derived. */

async function grab(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "AnswerSpaceBot/1.0 (+research)" }, redirect: "follow" });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 12000);
  } catch { return ""; }
}

export async function buildProfile(site, hint = "") {
  const origin = site.startsWith("http") ? site : `https://${site}`;
  const pages = await Promise.all([
    grab(origin),
    grab(`${origin}/about`),
    grab(`${origin}/products`),
    grab(`${origin}/pricing`),
  ]);
  const corpus = pages.filter(Boolean).join("\n\n---\n\n").slice(0, 24000);

  const schema = {
    type: "object",
    properties: {
      brand:      { type: "string" },
      aliases:    { type: "array", items: { type: "string" } },
      product:    { type: "string", description: "The specific product being measured" },
      category:   { type: "string" },
      audience:   { type: "string" },
      competitors: {
        type: "array",
        items: { type: "object", properties: {
          name: { type: "string" }, domain: { type: "string" },
        }, required: ["name"] },
      },
      themes: {
        type: "array",
        description: "6-9 buying-decision topics real people ask about in this category",
        items: { type: "object", properties: {
          id: { type: "string", description: "short lowercase slug" },
          name: { type: "string" },
        }, required: ["id", "name"] },
      },
    },
    required: ["brand", "product", "category", "competitors", "themes"],
  };

  return structured({
    name: "profile",
    schema,
    system:
      "You profile a company for an AI-search-visibility study. Be concrete and current. " +
      "Competitors must be real, named rivals a buyer would actually shortlist — 3 to 6 of them. " +
      "Themes are the decision topics people argue about in this category, not marketing pillars.",
    user:
      `Domain: ${site}\n` +
      (hint ? `Operator hint about what to measure: ${hint}\n` : "") +
      `\nSite text:\n${corpus || "(site unreachable — use your own knowledge of this domain)"}`,
  });
}

export async function buildPrompts(profile, count = 60) {
  const schema = {
    type: "object",
    properties: {
      prompts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text:   { type: "string" },
            intent: { type: "string", enum: INTENTS.map((i) => i.id) },
            theme:  { type: "string", enum: profile.themes.map((t) => t.id) },
            brandLed: { type: "boolean", description: "true if the query names the brand" },
          },
          required: ["text", "intent", "theme", "brandLed"],
        },
      },
    },
    required: ["prompts"],
  };

  return structured({
    name: "promptset",
    schema,
    maxTokens: 12000,
    system:
      "You write the query set for an AI-search-visibility study. These queries get sent verbatim to " +
      "ChatGPT, Claude, Perplexity, Gemini and Google AI Overviews every week, so they must be stable, " +
      "natural and answerable. Write how people actually type into an assistant — lowercase, no punctuation " +
      "games, no SEO keyword stuffing. Roughly 60% must NOT name the brand (that is where you discover " +
      "whether you get surfaced at all); the rest may name it. Spread evenly across themes and intents.",
    user:
      `Brand: ${profile.brand} (${profile.product})\n` +
      `Category: ${profile.category}\n` +
      `Competitors: ${profile.competitors.map((c) => c.name).join(", ")}\n` +
      `Themes: ${profile.themes.map((t) => `${t.id}=${t.name}`).join(", ")}\n` +
      `Intents: ${INTENTS.map((i) => i.id).join(", ")}\n\n` +
      `Write exactly ${count} queries.`,
  });
}
