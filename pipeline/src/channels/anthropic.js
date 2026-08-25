import { api, withRetry } from "../util.js";
import { dedupe } from "./openai.js";
/* Claude answers via Messages API + server-side web_search tool.
   Citations hang off text blocks as `web_search_result_location`, and they carry
   `cited_text` — the only channel that hands you the exact sentence it leaned on. */
export const id = "claude";
export async function ask(query) {
  const j = await withRetry(() => api("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CHANNEL_MODEL_ANTHROPIC || "claude-sonnet-4-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: query }],
    }),
  }), { label: "claude" });

  const blocks = j.content || [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const cites = blocks
    .filter((b) => b.type === "text")
    .flatMap((b) => b.citations || [])
    .filter((c) => c.type === "web_search_result_location")
    .map((c) => ({ url: c.url, title: c.title, snippet: c.cited_text }));
  return { text, citations: dedupe(cites), raw: j };
}
