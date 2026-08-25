#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { loadEnv, read, write, appendJsonl, readJsonl, pool, slug, clamp, weekOf, DATA } from "./util.js";
import { CHANNELS, SOURCE_TYPES, INTENTS, INFLUENCE, VERDICTS } from "./taxonomy.js";
import { buildProfile, buildPrompts } from "./profile.js";
import { extractAnswer, verifyClaim, brandIds } from "./extract.js";
import { makeClassifier } from "./sources.js";

loadEnv();

const argv = process.argv.slice(2);
const cmd = argv[0] || "all";
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1]?.startsWith("--") ? true : argv[i + 1]) : d; };
const has = (n) => argv.includes(`--${n}`);

const SITE      = flag("site");
const HINT      = flag("about", "");
const N_PROMPTS = +flag("prompts", 60);
const REPEATS   = +flag("repeats", 3);
const CONC      = +flag("concurrency", 4);
const TODAY     = flag("date", new Date().toISOString().slice(0, 10));
const LIMIT     = +flag("limit", 0);

const P_PROFILE = path.join(DATA, "profile.json");
const P_PROMPTS = path.join(DATA, "prompts.json");
const P_STATE   = path.join(DATA, "state.json");
const P_RAW     = (d) => path.join(DATA, "raw", `answers-${d}.jsonl`);
const P_EXT     = (d) => path.join(DATA, "raw", `extract-${d}.jsonl`);
const P_VER     = (d) => path.join(DATA, "raw", `verify-${d}.json`);
const P_FACTS   = path.join(DATA, "facts.txt");
const P_OUT     = path.join(DATA, "records.json");

const activeChannels = () => CHANNELS.filter((c) => process.env[c.env]);

/* ── 1. profile ─────────────────────────────────────────────────────── */
async function cmdProfile() {
  if (!SITE) die("need --site example.com");
  console.log(`▸ profiling ${SITE}`);
  const profile = await buildProfile(SITE, HINT);
  profile.site = SITE.replace(/^https?:\/\//, "").replace(/\/$/, "");
  profile.ownDomains = [profile.site, ...(profile.competitors || []).map((c) => c.domain).filter(Boolean)];
  write(P_PROFILE, profile);
  console.log(`  brand      ${profile.brand} — ${profile.product}`);
  console.log(`  competitors ${profile.competitors.map((c) => c.name).join(", ")}`);
  console.log(`  themes     ${profile.themes.map((t) => t.name).join(", ")}`);
  console.log(`✓ ${P_PROFILE}`);
  return profile;
}

/* ── 2. prompt set (frozen after first run) ─────────────────────────── */
async function cmdPrompts() {
  const profile = read(P_PROFILE) || await cmdProfile();
  const existing = read(P_PROMPTS);
  if (existing && !has("regenerate")) {
    console.log(`▸ reusing frozen prompt set (${existing.prompts.length}). --regenerate to rewrite.`);
    return existing;
  }
  if (existing) console.warn("⚠ regenerating prompts BREAKS week-over-week comparability. Old weeks stay in raw/.");
  console.log(`▸ writing ${N_PROMPTS} queries`);
  const { prompts } = await buildPrompts(profile, N_PROMPTS);
  const set = {
    version: (existing?.version || 0) + 1,
    created: TODAY,
    prompts: prompts.map((p, i) => ({ id: `q${i}`, ...p })),
  };
  write(P_PROMPTS, set);
  console.log(`✓ ${set.prompts.length} queries → ${P_PROMPTS}`);
  return set;
}

/* ── 3. collect one weekly snapshot ─────────────────────────────────── */
async function cmdCollect() {
  const profile = read(P_PROFILE) || die("run `profile` first");
  const set = read(P_PROMPTS) || die("run `prompts` first");
  const chans = activeChannels();
  if (!chans.length) die("no channel API keys set — see .env.example");

  const queries = LIMIT > 0 ? set.prompts.slice(0, LIMIT) : set.prompts;
  const jobs = [];
  for (const ch of chans)
    for (const p of queries)
      for (let r = 0; r < REPEATS; r++) jobs.push({ ch, p, r });

  console.log(`▸ ${jobs.length} calls  (${chans.length} channels × ${queries.length} queries × ${REPEATS} repeats)`);
  if (has("dry-run")) { console.log("  dry run — nothing sent."); return; }

  const mods = Object.fromEntries(await Promise.all(
    chans.map(async (c) => [c.id, await import(`./channels/${c.module}.js`)])
  ));
  let done = 0, failed = 0, absent = 0;
  await pool(jobs, CONC, async ({ ch, p, r }) => {
    try {
      const res = await mods[ch.id].ask(p.text);
      if (res.absent) absent++;
      appendJsonl(P_RAW(TODAY), {
        aid: `${TODAY}-${ch.id}-${p.id}-r${r}`,
        date: TODAY, channel: ch.id, channelName: ch.name,
        promptId: p.id, query: p.text, theme: p.theme, intent: p.intent,
        repeat: r, absent: !!res.absent,
        text: res.text,
        citations: res.citations.map((c, i) => ({ rank: i + 1, ...c })),
      });
    } catch (e) { failed++; console.warn(`  ✗ ${ch.id}/${p.id}: ${e.message.slice(0, 120)}`); }
    if (++done % 25 === 0) console.log(`  ${done}/${jobs.length}`);
  });
  console.log(`✓ ${done - failed} answers → ${P_RAW(TODAY)}  (${failed} failed, ${absent} with no AI Overview)`);
}

/* ── 4. read what was said ──────────────────────────────────────────── */
async function cmdExtract() {
  const profile = read(P_PROFILE) || die("run `profile` first");
  const answers = readJsonl(P_RAW(TODAY));
  if (!answers.length) die(`no answers for ${TODAY} — run collect`);
  const already = new Set(readJsonl(P_EXT(TODAY)).map((e) => e.aid));
  const todo = answers.filter((a) => !already.has(a.aid) && a.citations?.length);
  console.log(`▸ extracting ${todo.length} answers (${already.size} already done)`);
  if (has("dry-run")) return;

  let n = 0;
  await pool(todo, CONC, async (a) => {
    try {
      const out = await extractAnswer({
        profile, channelName: a.channelName, query: a.query, answer: a.text, citations: a.citations,
        facts: fs.existsSync(P_FACTS) ? fs.readFileSync(P_FACTS, "utf8") : "",
      });
      appendJsonl(P_EXT(TODAY), { aid: a.aid, ...out });
    } catch (e) { console.warn(`  ✗ ${a.aid}: ${e.message.slice(0, 120)}`); }
    if (++n % 25 === 0) console.log(`  ${n}/${todo.length}`);
  });
  console.log(`✓ ${P_EXT(TODAY)}`);
}

/* ── 4b. verify: does the cited page actually say it? ───────────────── */
async function cmdVerify() {
  const chans = activeChannels().filter((c) => ["claude", "gemini", "perplexity", "chatgpt"].includes(c.id));
  if (!chans.length) die("verification needs a search-capable channel key");
  const mod = await import(`./channels/${chans[0].module}.js`);
  const answers = new Map(readJsonl(P_RAW(TODAY)).map((a) => [a.aid, a]));
  const ext = readJsonl(P_EXT(TODAY));
  if (!ext.length) die(`nothing extracted for ${TODAY}`);

  const store = read(P_VER(TODAY), {}) || {};
  const pairs = new Map();
  for (const e of ext) {
    const a = answers.get(e.aid); if (!a) continue;
    for (const c of e.citations || []) {
      const cit = a.citations[c.index - 1]; if (!cit?.url) continue;
      const host = cit.host || cit.url;
      const key = `${host}|${(c.claim || "").slice(0, 120)}`;
      if (store[key] || pairs.has(key)) continue;
      pairs.set(key, { url: cit.url, claim: c.claim || "" });
    }
  }
  const list = [...pairs.entries()].slice(0, LIMIT > 0 ? LIMIT : 60);
  console.log(`▸ verifying ${list.length} distinct claims (${Object.keys(store).length} already done)`);
  if (has("dry-run")) return;

  let bad = 0;
  await pool(list, 2, async ([key, v]) => {
    try {
      const out = await verifyClaim({ ask: mod.ask, url: v.url, claim: v.claim });
      store[key] = out;
      if (out.support === "unsupported") { bad++; console.log(`  ✗ ${key.split("|")[0]} — ${v.claim}`); }
    } catch (e) { console.warn(`  ↯ ${e.message.slice(0, 100)}`); }
  });
  write(P_VER(TODAY), store);
  console.log(`✓ ${bad} claim(s) the cited page does not support → ${P_VER(TODAY)}`);
}

/* ── 5. join into the bundle the visualisation eats ─────────────────── */
function cmdBuild() {
  const profile = read(P_PROFILE) || die("run `profile` first");
  const set = read(P_PROMPTS) || die("run `prompts` first");
  const state = read(P_STATE, {}) || {};

  const dates = fs.readdirSync(path.join(DATA, "raw"))
    .filter((f) => f.startsWith("answers-")).map((f) => f.slice(8, 18)).sort();
  if (!dates.length) die("no snapshots in data/raw");
  const epoch = state.epoch || dates[0];
  write(P_STATE, { ...state, epoch });

  const classify = makeClassifier({
    ownDomains: profile.ownDomains || [profile.site],
    overrides: read(path.join(DATA, "source-overrides.json"), {}) || {},
  });

  const brandName = (bid) => bid === "client" ? profile.brand
    : bid?.startsWith("comp") ? (profile.competitors[+bid.slice(4)]?.name || bid) : null;

  const roster = new Set(brandIds(profile));
  const sources = new Map();
  const records = [];
  const answerRows = [];
  let rid = 0;

  for (const date of dates) {
    const answers = new Map(readJsonl(P_RAW(date)).map((a) => [a.aid, a]));
    const ver = read(P_VER(date), {}) || {};
    const week = weekOf(date, epoch);
    for (const ex of readJsonl(P_EXT(date))) {
      const a = answers.get(ex.aid); if (!a) continue;

      const brands = (ex.brandsMentioned || []).filter((b) => roster.has(b.brand));
      answerRows.push({
        aid: a.aid, platform: a.channel, prompt: a.promptId, theme: a.theme, intent: a.intent,
        week, repeat: a.repeat, refused: !!ex.refused,
        mentioned: !!ex.clientMentioned, recommended: !!ex.clientRecommended,
        first: brands.length ? brands.slice().sort((x, y) => x.order - y.order)[0].brand : null,
        brands: brands.map((b) => ({ brand: b.brand, order: b.order, recommended: !!b.recommended,
          share: clamp(Number(b.sharePct) || 0, 0, 100) })),
        cites: (a.citations || []).length,
        sources: [...new Set((a.citations || [])
          .map((c) => { const k = classify(c.host ? { host: c.host } : c.url); return k ? slug(k.host) : null; })
          .filter(Boolean))],
      });

      for (const c of ex.citations || []) {
        const cit = a.citations[c.index - 1]; if (!cit) continue;
        const cls = classify(cit.host ? { host: cit.host } : cit.url); if (!cls) continue;
        if (!sources.has(cls.host)) sources.set(cls.host,
          { id: slug(cls.host), dom: cls.host, type: cls.type, auth: cls.auth, influence: INFLUENCE[cls.type] || "earned" });
        const sent = clamp(Number(c.sentiment) || 0, -1, 1);
        const v = ver[`${cit.host || cit.url}|${(c.claim || "").slice(0, 120)}`];
        records.push({
          id: `r${rid++}`, aid: a.aid,
          platform: a.channel, prompt: a.promptId, theme: a.theme, intent: a.intent,
          source: slug(cls.host), stype: cls.type, influence: INFLUENCE[cls.type] || "earned",
          brand: roster.has(c.brand) ? c.brand : "none",
          sent: Math.round(sent * 100) / 100,
          bandId: sent >= 0.22 ? "pos" : sent <= -0.22 ? "neg" : "neu",
          verdict: VERDICTS.includes(c.verdict) ? c.verdict : "not compared",
          rank: cit.rank, week, auth: cls.auth,
          tone: c.tone, text: c.evidence || c.claim, claim: c.claim,
          nuance: (c.nuance || []).slice(0, 3),
          risks: (c.risks || []).slice(0, 2),
          factConflict: (c.factConflict || "").trim() || null,
          support: v ? v.support : "unchecked", supportNote: v ? v.note : null,
          url: cit.url || null,
        });
      }
    }
  }

  /* volatility: same question, same model, different day-to-day answer */
  const volatility = [];
  const grp = new Map();
  for (const a of answerRows) {
    const k = `${a.prompt}|${a.platform}`;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k).push(a);
  }
  for (const [k, list] of grp) {
    if (list.length < 2) continue;
    const [prompt, platform] = k.split("|");
    const appear = list.filter((a) => a.mentioned).length / list.length;
    const jac = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = new Set(list[i].sources), B = new Set(list[j].sources);
      const uni = new Set([...A, ...B]).size;
      if (uni) jac.push([...A].filter((x) => B.has(x)).length / uni);
    }
    volatility.push({ prompt, platform, runs: list.length,
      appearRate: Math.round(appear * 100) / 100,
      flipped: appear > 0 && appear < 1,
      firstBrandChurn: new Set(list.map((a) => a.first)).size > 1,
      sourceOverlap: jac.length ? Math.round(jac.reduce((x, y) => x + y, 0) / jac.length * 100) / 100 : 1 });
  }

  const usedBrands = new Set([...records.map((r) => r.brand),
    ...answerRows.flatMap((a) => a.brands.map((b) => b.brand)), "client"]);
  const brands = [
    { id: "client", name: profile.brand, client: true },
    ...profile.competitors.map((c, i) => ({ id: `comp${i}`, name: c.name })),
    { id: "none", name: "No brand (general)" },
  ].filter((b) => usedBrands.has(b.id));

  const bundle = {
    meta: {
      schema: 2,
      brand: profile.brand, product: profile.product, site: profile.site,
      generated: new Date().toISOString().slice(0, 10),
      weeks: Math.max(1, ...records.map((r) => r.week), ...answerRows.map((a) => a.week)),
      promptSetVersion: set.version, snapshots: dates,
      hasFacts: fs.existsSync(P_FACTS),
      verified: records.filter((r) => r.support !== "unchecked").length,
    },
    platforms: CHANNELS.filter((c) => records.some((r) => r.platform === c.id) || answerRows.some((a) => a.platform === c.id))
      .map((c) => ({ id: c.id, name: c.name })),
    sourceTypes: SOURCE_TYPES,
    intents: INTENTS,
    themes: profile.themes,
    brands,
    prompts: set.prompts.map((p) => ({ id: p.id, text: p.text, intent: p.intent, theme: p.theme })),
    sources: [...sources.values()],
    records, answers: answerRows, volatility,
  };
  write(P_OUT, bundle);
  const seen = answerRows.filter((a) => a.mentioned).length;
  console.log(`✓ ${records.length} citations · ${answerRows.length} answers · seen in `
    + `${answerRows.length ? Math.round(seen / answerRows.length * 100) : 0}% · ${bundle.sources.length} sources → ${P_OUT}`);
  console.log(`  copy it next to the html, then: npm run serve`);
}

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const table = { profile: cmdProfile, prompts: cmdPrompts, collect: cmdCollect, extract: cmdExtract, verify: cmdVerify, build: cmdBuild };
if (cmd === "all") {
  if (!read(P_PROFILE)) await cmdProfile();
  await cmdPrompts(); await cmdCollect(); await cmdExtract();
  if (!has("no-verify")) { try { await cmdVerify(); } catch (e) { console.warn("verify skipped: " + e.message); } }
  cmdBuild();
} else if (table[cmd]) { await table[cmd](); }
else die(`unknown command "${cmd}". Use: profile | prompts | collect | extract | verify | build | all`);
