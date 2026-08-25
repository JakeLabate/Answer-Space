/* Vendor API key custody.

   The browser needs the plaintext keys — it is the engine that calls Anthropic,
   OpenAI and the rest — so this cannot be a write-only vault. What it can do is
   keep the keys out of the database in readable form: ciphertext lives in
   public.api_keys, and the AES-256-GCM master key lives only in this function's
   environment. A database dump alone yields nothing usable.

   Be honest about the boundary: whoever controls this function's environment
   can decrypt. That is the operator (you). It is strictly better than plaintext
   at rest and strictly worse than a client-side passphrase the server never
   sees — the trade-off buys cross-device sync, which a passphrase would cost.

   Env:
     KEY_ENCRYPTION_SECRET   base64 of 32 random bytes  (openssl rand -base64 32)
   Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically. */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

/* ── crypto ───────────────────────────────────────────────────────── */
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

let MASTER: CryptoKey | null = null;
async function master(): Promise<CryptoKey> {
  if (MASTER) return MASTER;
  const raw = Deno.env.get("KEY_ENCRYPTION_SECRET");
  if (!raw) throw new Error("KEY_ENCRYPTION_SECRET is not set on this function");
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error("KEY_ENCRYPTION_SECRET must decode to 32 bytes");
  MASTER = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  return MASTER;
}
async function seal(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await master(), new TextEncoder().encode(plain));
  return { ciphertext: b64(ct), iv: b64(iv.buffer) };
}
async function open(ciphertext: string, iv: string) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) }, await master(), unb64(ciphertext));
  return new TextDecoder().decode(pt);
}

/* ── handler ──────────────────────────────────────────────────────── */
const PROVIDERS = new Set(["anthropic", "openai", "gemini", "perplexity", "serpapi"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not signed in" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });

  const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "not signed in" }, 401);

  let body: { action?: string; provider?: string; value?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { action, provider, value } = body;

  try {
    /* which keys are set — hints only, never the secret */
    if (action === "list") {
      const { data, error } = await admin.from("api_keys")
        .select("provider, hint, updated_at").eq("user_id", user.id);
      if (error) throw error;
      return json({ keys: data ?? [] });
    }

    /* the engine asking for what it needs to make calls */
    if (action === "get") {
      const { data, error } = await admin.from("api_keys")
        .select("provider, ciphertext, iv").eq("user_id", user.id);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const row of data ?? []) {
        try { out[row.provider] = await open(row.ciphertext, row.iv); }
        catch { /* key rotated out from under this row — skip it */ }
      }
      return json({ keys: out });
    }

    if (action === "put") {
      if (!provider || !PROVIDERS.has(provider)) return json({ error: "unknown provider" }, 400);
      if (typeof value !== "string" || !value.trim()) return json({ error: "empty key" }, 400);
      if (value.length > 512) return json({ error: "that does not look like an API key" }, 400);
      const { ciphertext, iv } = await seal(value.trim());
      const { error } = await admin.from("api_keys").upsert({
        user_id: user.id, provider, ciphertext, iv,
        hint: value.trim().slice(-4),
      });
      if (error) throw error;
      return json({ ok: true, provider, hint: value.trim().slice(-4) });
    }

    if (action === "del") {
      if (!provider) return json({ error: "no provider" }, 400);
      const { error } = await admin.from("api_keys")
        .delete().eq("user_id", user.id).eq("provider", provider);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
