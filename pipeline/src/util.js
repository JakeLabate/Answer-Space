import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
export const DATA = path.join(ROOT, "data");

export function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
export const read  = (p, d = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
export const write = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); return p; };
export const appendJsonl = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
export const readJsonl = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map(JSON.parse) : []);
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** ISO week index relative to the first collection, so the viz's 1..N axis is stable. */
export function weekOf(dateISO, epochISO) {
  const d = new Date(dateISO), e = new Date(epochISO);
  return Math.max(1, Math.floor((d - e) / (7 * 864e5)) + 1);
}

/** Retry with exponential backoff. Retries 429/5xx and network errors, never 4xx logic errors. */
export async function withRetry(fn, { tries = 4, base = 1200, label = "call" } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const status = e.status || 0;
      if (status && status !== 429 && status < 500) throw e;
      const wait = base * 2 ** i + Math.floor(Math.random() * 400);
      console.warn(`  ↻ ${label} failed (${e.message}); retry ${i + 1}/${tries - 1} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

/** Bounded-concurrency map that never rejects: failures come back as {error}. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); }
      catch (e) { out[k] = { error: e.message }; }
    }
  }));
  return out;
}

export async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`${res.status} ${res.statusText} ${body.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Strip a URL down to a registrable-ish host. Handles Google's grounding redirects. */
export function hostOf(url) {
  try {
    const u = new URL(url);
    let h = u.hostname.replace(/^www\./, "");
    if (/vertexaisearch\.cloud\.google\.com$/.test(h)) return null; // caller must resolve
    if (h === "news.google.com" || h === "r.jina.ai") return null;
    return h;
  } catch { return null; }
}

/** Google grounding URIs are redirects; one HEAD reveals the real publisher. */
export async function resolveRedirect(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return hostOf(res.url);
  } catch { return null; }
}
