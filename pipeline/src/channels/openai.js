import { api, withRetry } from "../util.js";
/* ChatGPT-family answers via the Responses API + hosted web_search tool.
   Citations arrive as `url_citation` annotations on the output_text content. */
export const id = "chatgpt";
export async function ask(query) {
  const j = await withRetry(() => api("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.CHANNEL_MODEL_OPENAI || "gpt-5",
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      input: query,
    }),
  }), { label: "chatgpt" });

  const parts = (j.output || []).flatMap((o) => o.content || []);
  const text = parts.filter((c) => c.type === "output_text").map((c) => c.text).join("\n");
  const anns = parts.flatMap((c) => c.annotations || []).filter((a) => a.type === "url_citation");
  return { text, citations: dedupe(anns.map((a) => ({ url: a.url, title: a.title }))), raw: j };
}
export function dedupe(list) {
  const seen = new Set(), out = [];
  for (const c of list) { if (!c.url || seen.has(c.url)) continue; seen.add(c.url); out.push(c); }
  return out;
}
