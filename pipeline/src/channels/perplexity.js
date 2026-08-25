import { api, withRetry } from "../util.js";
import { dedupe } from "./openai.js";
/* Perplexity Sonar. Richest citation payload of the lot: search_results carries
   title, url, date and snippet.
   NOTE (Aug 2026): Perplexity has moved this to the Agent API; the chat/completions
   shape below is supported until 2026-09-27. Check the docs before your next run. */
export const id = "perplexity";
export async function ask(query) {
  const j = await withRetry(() => api("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    body: JSON.stringify({
      model: process.env.CHANNEL_MODEL_PERPLEXITY || "sonar-pro",
      messages: [{ role: "user", content: query }],
      web_search_options: { search_context_size: "medium" },
    }),
  }), { label: "perplexity" });

  const text = j.choices?.[0]?.message?.content || "";
  const results = j.search_results || (j.citations || []).map((u) => ({ url: u }));
  return {
    text,
    citations: dedupe(results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }))),
    raw: j,
  };
}
