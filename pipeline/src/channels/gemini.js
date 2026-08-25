import { api, withRetry, resolveRedirect, hostOf } from "../util.js";
import { dedupe } from "./openai.js";
/* Gemini with Google Search grounding.
   Two response shapes are in the wild — the classic `groundingMetadata.groundingChunks`
   and the newer `url_citation` annotations. Parse both.
   Gotcha: grounded URIs are vertexaisearch.cloud.google.com redirects. `web.domain`
   usually carries the real publisher; when it does not we HEAD the redirect once. */
export const id = "gemini";
export async function ask(query) {
  const model = process.env.CHANNEL_MODEL_GEMINI || "gemini-2.5-flash";
  const j = await withRetry(() => api(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: query }] }], tools: [{ google_search: {} }] }),
    }
  ), { label: "gemini" });

  const cand = j.candidates?.[0] || {};
  const parts = cand.content?.parts || [];
  const text = parts.map((p) => p.text).filter(Boolean).join("\n");

  let cites = [];
  const chunks = cand.groundingMetadata?.groundingChunks || [];
  if (chunks.length) {
    cites = chunks.filter((c) => c.web).map((c) => ({
      url: c.web.uri, title: c.web.title, domainHint: c.web.domain || null,
    }));
  } else {
    const anns = parts.flatMap((p) => p.annotations || []).filter((a) => a.type === "url_citation");
    cites = anns.map((a) => ({ url: a.url, title: a.title }));
  }

  // Resolve the redirect wrapper so the source is the publisher, not Google.
  for (const c of cites) {
    if (c.domainHint) { c.host = c.domainHint.replace(/^www\./, ""); continue; }
    c.host = hostOf(c.url) || (await resolveRedirect(c.url));
  }
  return { text, citations: dedupe(cites), raw: j };
}
