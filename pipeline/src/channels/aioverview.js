import { api, withRetry, sleep } from "../util.js";
import { dedupe } from "./openai.js";
/* Google AI Overviews. No first-party API exists, so this goes through SerpApi.
   Two-step: the SERP call may return only a page_token, which must be redeemed
   within ~4 minutes against the google_ai_overview engine.
   An absent AI Overview is a real result, not an error — Google shows one for a
   minority of queries, and "we were not eligible" is worth recording. */
export const id = "aio";
export async function ask(query) {
  const key = process.env.SERPAPI_KEY;
  const serp = await withRetry(() => api(
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&hl=en&gl=us&api_key=${key}`
  ), { label: "aio:serp" });

  let ov = serp.ai_overview;
  if (ov?.page_token) {
    await sleep(400);
    const second = await withRetry(() => api(
      `https://serpapi.com/search.json?engine=google_ai_overview&page_token=${encodeURIComponent(ov.page_token)}&api_key=${key}`
    ), { label: "aio:token" });
    ov = second.ai_overview || ov;
  }
  if (!ov) return { text: "", citations: [], absent: true, raw: serp };

  const text = (ov.text_blocks || [])
    .map((b) => b.snippet || (b.list || []).map((l) => l.snippet).join(" "))
    .filter(Boolean).join("\n");
  const refs = (ov.references || []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }));
  return { text, citations: dedupe(refs), raw: ov };
}
