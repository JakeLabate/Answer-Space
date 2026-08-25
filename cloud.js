/* ══════════════════════════════════════════════════════════════════════
   Accounts and sync.

   The dashboard works with none of this. Signed out, it is the same
   zero-backend tool it always was — localStorage for config, IndexedDB for
   snapshots, nothing leaves the browser but the model calls themselves.
   Signing in adds a second destination for the same writes, so a run made on
   a laptop is readable on a phone and history survives a cleared cache.

   Everything here is best-effort. A failed sync logs and returns; it never
   blocks a run, and it never loses the local copy — local is always written
   first, cloud second. That ordering is the whole reliability story.
   ══════════════════════════════════════════════════════════════════════ */
const CFGX = window.ANSWER_SPACE_CONFIG || {};
const ENABLED = !!(CFGX.SUPABASE_URL && CFGX.SUPABASE_ANON_KEY);

let sb = null, user = null, hydrating = false;
const listeners = new Set();
const emit = () => listeners.forEach(f => { try { f(user); } catch {} });

/* ── boot ──────────────────────────────────────────────────────────── */
async function init() {
  if (!ENABLED) return null;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  sb = createClient(CFGX.SUPABASE_URL, CFGX.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const { data } = await sb.auth.getSession();
  user = data?.session?.user || null;
  sb.auth.onAuthStateChange((_e, session) => {
    const next = session?.user || null;
    const changed = (next?.id || null) !== (user?.id || null);
    user = next;
    if (changed) emit();
  });
  return user;
}

/* ── auth ──────────────────────────────────────────────────────────── */
const need = () => { if (!sb) throw new Error("Accounts are not configured for this deployment."); };

async function signUp(email, password) {
  need();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  /* Projects with email confirmation on return a user but no session. Say so
     rather than leaving someone staring at a dashboard that did not change. */
  if (!data.session) return { confirm: true };
  user = data.user; emit();
  return { confirm: false };
}
async function signIn(email, password) {
  need();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  user = data.user; emit();
  return user;
}
async function signOut() {
  if (!sb) return;
  await sb.auth.signOut();
  user = null; emit();
}
async function resetPassword(email) {
  need();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href });
  if (error) throw new Error(error.message);
}

/* ── workspace: profile, query set, ground truth, scan settings ─────── */
const REMOTE_FIELDS = ["site", "hint", "profile", "prompts", "facts", "scan", "models", "step"];

async function pullWorkspace() {
  if (!user) return null;
  const { data, error } = await sb.from("workspaces").select("*").eq("user_id", user.id).maybeSingle();
  if (error) { console.warn("[cloud] workspace pull:", error.message); return null; }
  return data || null;
}

let pushTimer = null, pushPending = null;
function pushWorkspace(cfg) {
  if (!user || hydrating) return;
  pushPending = cfg;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const c = pushPending; pushPending = null;
    if (!c || !user) return;
    const row = { user_id: user.id };
    for (const f of REMOTE_FIELDS) if (c[f] !== undefined) row[f] = c[f];
    const { error } = await sb.from("workspaces").upsert(row);
    if (error) console.warn("[cloud] workspace push:", error.message);
  }, 1200);   /* the wizard writes on every keystroke; do not follow it there */
}
/* Flush before the tab closes so the last edit is not lost to the debounce. */
function flushWorkspace() {
  if (!user || !pushPending) return;
  clearTimeout(pushTimer);
  const c = pushPending; pushPending = null;
  const row = { user_id: user.id };
  for (const f of REMOTE_FIELDS) if (c[f] !== undefined) row[f] = c[f];
  sb.from("workspaces").upsert(row).then(() => {}, () => {});
}

/* ── vendor keys, via the Edge Function that holds the master key ───── */
async function fn(action, body = {}) {
  need();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("not signed in");
  const res = await fetch(`${CFGX.SUPABASE_URL}/functions/v1/keys`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
      apikey: CFGX.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `key store returned ${res.status}`);
  return out;
}
const getKeys  = async () => user ? (await fn("get")).keys || {} : {};
const listKeys = async () => user ? (await fn("list")).keys || [] : [];
const putKey   = (provider, value) => fn("put", { provider, value });
const delKey   = (provider) => fn("del", { provider });

/* ── snapshots ─────────────────────────────────────────────────────── */
async function snapshotDates() {
  if (!user) return [];
  const { data, error } = await sb.from("snapshots")
    .select("taken_on").eq("user_id", user.id).order("taken_on");
  if (error) { console.warn("[cloud] dates:", error.message); return []; }
  return (data || []).map(r => r.taken_on);
}
async function pullSnapshot(date) {
  if (!user) return null;
  const { data, error } = await sb.from("snapshots")
    .select("raw").eq("user_id", user.id).eq("taken_on", date).maybeSingle();
  if (error) { console.warn("[cloud] snapshot pull:", error.message); return null; }
  return data?.raw || null;
}
/* History for the trend chart — summary columns only, so this stays small
   however many answers the raw payloads hold. */
async function history() {
  if (!user) return [];
  const { data, error } = await sb.from("snapshots")
    .select("id, taken_on, answers, citations, mentioned, recommended, refused, avg_tone, \
unsupported, fact_conflicts, risk_flags, wins, losses, flipped, verified, has_facts, demo")
    .eq("user_id", user.id).order("taken_on");
  if (error) { console.warn("[cloud] history:", error.message); return []; }
  return data || [];
}
async function pushSnapshot(date, raw, summary, metrics) {
  if (!user) return;
  const { data, error } = await sb.from("snapshots")
    .upsert({ user_id: user.id, taken_on: date, raw, ...summary }, { onConflict: "user_id,taken_on" })
    .select("id").single();
  if (error) { console.warn("[cloud] snapshot push:", error.message); return; }
  if (!metrics?.length) return;
  await sb.from("snapshot_metrics").delete().eq("snapshot_id", data.id);
  const rows = metrics.map(m => ({ ...m, snapshot_id: data.id, user_id: user.id }));
  const { error: mErr } = await sb.from("snapshot_metrics").insert(rows);
  if (mErr) console.warn("[cloud] metrics push:", mErr.message);
}
async function deleteSnapshot(date) {
  if (!user) return;
  const { error } = await sb.from("snapshots").delete().eq("user_id", user.id).eq("taken_on", date);
  if (error) throw new Error(error.message);
}
async function deleteEverything() {
  if (!user) return;
  await sb.from("snapshots").delete().eq("user_id", user.id);
  await sb.from("api_keys").delete().eq("user_id", user.id);
  await sb.from("workspaces").update({
    site: "", hint: "", profile: null, prompts: null, facts: "", step: "keys",
  }).eq("user_id", user.id);
}

/* ── exposed ───────────────────────────────────────────────────────── */
window.CLOUD = {
  get enabled() { return ENABLED; },
  get user() { return user; },
  signedIn: () => !!user,
  setHydrating: v => { hydrating = v; },
  onChange: f => { listeners.add(f); return () => listeners.delete(f); },
  signUp, signIn, signOut, resetPassword,
  pullWorkspace, pushWorkspace, flushWorkspace,
  getKeys, listKeys, putKey, delKey,
  snapshotDates, pullSnapshot, pushSnapshot, history, deleteSnapshot, deleteEverything,
};

/* app.js awaits this before deciding local-only vs signed-in. If the CDN is
   unreachable it resolves null and the dashboard carries on offline. */
try { await init(); } catch (e) { console.warn("[cloud] init failed, staying local:", e.message); }
window.__cloudResolve?.(window.CLOUD);
