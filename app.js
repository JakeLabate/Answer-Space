"use strict";
(function(){
/* ══════════════════════════════════════════════════════════════════════
   Answer Space — dashboard
   A static page that runs the whole measurement itself. Keys live in this
   browser; the two assistants that permit cross-origin calls are driven
   directly, and the three that do not are handed to GitHub Actions.
   ══════════════════════════════════════════════════════════════════════ */

/* ── channels ──────────────────────────────────────────────────────── */
const CHANNELS = [
  { id:"claude", name:"Claude", key:"anthropic", cors:true,
    why:"Anthropic permits direct browser calls. Returns the exact sentence it cited." },
  { id:"gemini", name:"Gemini", key:"gemini", cors:true,
    why:"Google Search grounding. Citations arrive as redirect links that get resolved." },
  { id:"chatgpt", name:"ChatGPT", key:"openai", cors:false,
    why:"OpenAI does not send CORS headers. Runs on Actions." },
  { id:"perplexity", name:"Perplexity", key:"perplexity", cors:false,
    why:"Richest citation payload of any channel. Runs on Actions." },
  { id:"aio", name:"Google AI Overviews", key:"serpapi", cors:false,
    why:"No first-party API; SerpApi refuses browser calls outright. Runs on Actions." },
];
const DEFAULT_MODELS = {
  claude:"claude-sonnet-4-5", gemini:"gemini-2.5-flash",
  chatgpt:"gpt-5", perplexity:"sonar-pro",
};
const model = id => (CFG.models && CFG.models[id]) || DEFAULT_MODELS[id];
const KEYMETA = {
  anthropic:{ label:"Anthropic", ph:"sk-ant-…" }, gemini:{ label:"Google AI Studio", ph:"AIza…" },
  openai:{ label:"OpenAI", ph:"sk-…" }, perplexity:{ label:"Perplexity", ph:"pplx-…" },
  serpapi:{ label:"SerpApi", ph:"…" },
};
const INTENTS = [
  {id:"compare",name:"Comparison"},{id:"recommend",name:"Recommendation"},
  {id:"howto",name:"How-to / setup"},{id:"info",name:"Informational"},{id:"problem",name:"Problem / complaint"},
];
const TONES = ["Endorsing","Enthusiastic","Recommending","Reassuring","Neutral-factual","Descriptive",
  "Hedged","Comparative","Cautionary","Skeptical","Dismissive","Warning"];
const NUANCE = [
  "first citation","buried citation","listed as alternative only","recommendation list",
  "comparison table","direct quote","paraphrased","anecdote as evidence","unsourced claim",
  "stale data","own-domain echo","negative from authority","competitor favoured",
  "brand confusion","conditional endorsement","damning with faint praise",
];
/* Who wins the comparison, when there is one. Sentiment says "warm about us";
   this says "beat them". They come apart constantly. */
const VERDICTS = ["client wins","client loses","tie","not compared"];
/* Claims that are a legal or trust problem regardless of how positively they are phrased. */
const RISKS = [
  "overstated guarantee","misstated price","misstated availability","misstated policy",
  "regulatory or safety claim","unverifiable claim about us",
];
/* Can you do anything about this source before Friday? */
const INFLUENCE = { owned:"owned", review:"rented", editorial:"earned", reference:"earned",
                    community:"ugc", video:"ugc" };
const INFLUENCE_LABEL = { owned:"Owned — edit it today", rented:"Rented — petition the platform",
  earned:"Earned — pitch a correction", ugc:"UGC — participate, cannot control" };
const SRC_RULES = [
  [/(^|\.)reddit\.com$|quora\.com$|trustpilot\.com$|news\.ycombinator\.com$|stackexchange\.com$|stackoverflow\.com$|(^|\.)x\.com$|twitter\.com$/,"community",.55],
  [/youtube\.com$|tiktok\.com$|instagram\.com$|vimeo\.com$|medium\.com$|substack\.com$|linkedin\.com$/,"video",.42],
  [/wikipedia\.org$|investopedia\.com$|britannica\.com$|statista\.com$|\.gov$|\.edu$|^docs\./,"reference",.80],
  [/nerdwallet\.com$|bankrate\.com$|cnet\.com$|pcmag\.com$|tomsguide\.com$|techradar\.com$|g2\.com$|capterra\.com$|trustradius\.com$|consumerreports\.org$/,"review",.75],
  [/reuters\.com$|wsj\.com$|ft\.com$|bloomberg\.com$|cnbc\.com$|nytimes\.com$|theverge\.com$|techcrunch\.com$|wired\.com$|arstechnica\.com$|businessinsider\.com$|forbes\.com$|guardian|bbc\.co/,"editorial",.84],
];

/* ── tiny helpers ──────────────────────────────────────────────────── */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const n=document.createElement(tag); if(cls)n.className=cls; if(html!=null)n.innerHTML=html; return n; };
const esc = s => String(s??"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48);
const clamp = (v,a,b) => v<a?a:v>b?b:v;
const today = () => new Date().toISOString().slice(0,10);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function hostOf(u){ try{ let h=new URL(u).hostname.replace(/^www\./,"");
  return /vertexaisearch\.cloud\.google\.com$/.test(h)?null:h; }catch{ return null } }
function classify(host, own){
  if(!host) return null;
  if(own.some(d => host===d || host.endsWith("."+d))) return {host,type:"owned",auth:.88};
  for(const [re,type,auth] of SRC_RULES) if(re.test(host)) return {host,type,auth};
  return {host,type:"editorial",auth:.45};
}
async function pool(items, limit, fn, onTick){
  let i=0, done=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, async () => {
    while(i<items.length){
      const k=i++;
      try{ await fn(items[k],k); }catch(e){ log("✗ "+(e.message||e).slice(0,140),"e"); }
      onTick && onTick(++done, items.length);
      if(STATE.abort) return;
    }
  }));
}

/* ── storage ───────────────────────────────────────────────────────── */
const LS = "answerspace.cfg";
let CFG = { keys:{}, models:{}, demo:false, site:"", hint:"", profile:null, prompts:null, facts:"",
            scan:{q:20,r:3,verify:true,verifyMax:40}, gh:{repo:"",pat:""}, step:"keys" };
function saveCfg(){ try{ localStorage.setItem(LS, JSON.stringify(CFG)); }catch{} }
function loadCfg(){ try{ const j=JSON.parse(localStorage.getItem(LS)||"null"); if(j) CFG={...CFG,...j}; }catch{} }

let DB=null;
function db(){
  if(DB) return DB;
  DB = new Promise((res,rej)=>{
    const q=indexedDB.open("answerspace",1);
    q.onupgradeneeded=()=>q.result.createObjectStore("kv");
    q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error);
  });
  return DB;
}
async function kvGet(k){ const d=await db(); return new Promise((res,rej)=>{
  const t=d.transaction("kv").objectStore("kv").get(k); t.onsuccess=()=>res(t.result); t.onerror=()=>rej(t.error); }); }
async function kvPut(k,v){ const d=await db(); return new Promise((res,rej)=>{
  const t=d.transaction("kv","readwrite").objectStore("kv").put(v,k); t.onsuccess=()=>res(); t.onerror=()=>rej(t.error); }); }
async function kvKeys(){ const d=await db(); return new Promise((res,rej)=>{
  const t=d.transaction("kv").objectStore("kv").getAllKeys(); t.onsuccess=()=>res(t.result); t.onerror=()=>rej(t.error); }); }
async function kvDel(k){ const d=await db(); return new Promise((res,rej)=>{
  const t=d.transaction("kv","readwrite").objectStore("kv").delete(k); t.onsuccess=()=>res(); t.onerror=()=>rej(t.error); }); }

const STATE = { abort:false, running:false, bundle:null };

/* ══════════════════════════════════════════════════════════════════════
   Worker model — profiling, query writing, citation extraction.
   Prefers Claude; falls back to Gemini; demo mode short-circuits both.
   ══════════════════════════════════════════════════════════════════════ */
function workerKind(){
  if(CFG.demo) return "demo";
  if(CFG.keys.anthropic) return "claude";
  if(CFG.keys.gemini) return "gemini";
  return null;
}
async function api(url, opts){
  const res = await fetch(url, opts);
  if(!res.ok){
    const body = await res.text().catch(()=> "");
    const e = new Error(`${res.status} ${body.slice(0,300)}`); e.status=res.status; throw e;
  }
  return res.json();
}
async function retry(fn, label, tries=3){
  let last;
  for(let i=0;i<tries;i++){
    if(STATE.abort) throw new Error("aborted");
    try{ return await fn(); }
    catch(e){ last=e; if(e.status && e.status!==429 && e.status<500) throw e;
      await sleep(900*2**i); }
  }
  throw last;
}
function geminiSchema(s){
  if(!s || typeof s!=="object") return s;
  const T={object:"OBJECT",string:"STRING",array:"ARRAY",number:"NUMBER",integer:"INTEGER",boolean:"BOOLEAN"};
  const out={};
  if(s.type) out.type=T[s.type]||s.type;
  if(s.description) out.description=s.description;
  if(s.enum) out.enum=s.enum;
  if(s.items) out.items=geminiSchema(s.items);
  if(s.properties){ out.properties={}; for(const k in s.properties) out.properties[k]=geminiSchema(s.properties[k]); }
  if(s.required) out.required=s.required;
  return out;
}
async function structured({system,user,schema,name="result",maxTokens=8000}){
  const kind = workerKind();
  if(kind==="demo") return DEMO.structured(name,user);
  if(kind==="claude"){
    const j = await retry(()=>api("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{ "content-type":"application/json", "x-api-key":CFG.keys.anthropic,
        "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
      body:JSON.stringify({ model:model("claude"), max_tokens:maxTokens, system,
        messages:[{role:"user",content:user}],
        tools:[{name,description:"Return the result.",input_schema:schema}],
        tool_choice:{type:"tool",name} }),
    }),"worker");
    const b=(j.content||[]).find(x=>x.type==="tool_use");
    if(!b) throw new Error("worker returned no structured block");
    return b.input;
  }
  if(kind==="gemini"){
    const j = await retry(()=>api(
      `https://generativelanguage.googleapis.com/v1beta/models/${model("gemini")}:generateContent`,{
      method:"POST",
      headers:{ "content-type":"application/json", "x-goog-api-key":CFG.keys.gemini },
      body:JSON.stringify({
        systemInstruction:{parts:[{text:system}]},
        contents:[{parts:[{text:user}]}],
        generationConfig:{ responseMimeType:"application/json", responseSchema:geminiSchema(schema),
          maxOutputTokens:maxTokens },
      }),
    }),"worker");
    const t=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text).filter(Boolean).join("");
    return JSON.parse(t);
  }
  throw new Error("No worker key. Add Anthropic or Gemini, or switch on demo mode.");
}

/* ══════════════════════════════════════════════════════════════════════
   Answer channels that a browser can actually reach
   ══════════════════════════════════════════════════════════════════════ */
const dedupe = list => { const seen=new Set(), out=[];
  for(const c of list){ if(!c.url||seen.has(c.url))continue; seen.add(c.url); out.push(c); } return out; };

const ASK = {
  async claude(query){
    const j = await retry(()=>api("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{ "content-type":"application/json", "x-api-key":CFG.keys.anthropic,
        "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
      body:JSON.stringify({ model:model("claude"), max_tokens:1600,
        tools:[{type:"web_search_20250305",name:"web_search",max_uses:6}],
        messages:[{role:"user",content:query}] }),
    }),"claude");
    const blocks=j.content||[];
    const text=blocks.filter(b=>b.type==="text").map(b=>b.text).join("\n");
    const cites=blocks.filter(b=>b.type==="text").flatMap(b=>b.citations||[])
      .filter(c=>c.type==="web_search_result_location")
      .map(c=>({url:c.url,title:c.title,snippet:c.cited_text}));
    return { text, citations:dedupe(cites) };
  },
  async gemini(query){
    const j = await retry(()=>api(
      `https://generativelanguage.googleapis.com/v1beta/models/${model("gemini")}:generateContent`,{
      method:"POST",
      headers:{ "content-type":"application/json", "x-goog-api-key":CFG.keys.gemini },
      body:JSON.stringify({ contents:[{parts:[{text:query}]}], tools:[{google_search:{}}] }),
    }),"gemini");
    const cand=j.candidates?.[0]||{};
    const parts=cand.content?.parts||[];
    const text=parts.map(p=>p.text).filter(Boolean).join("\n");
    let cites=[];
    const chunks=cand.groundingMetadata?.groundingChunks||[];
    if(chunks.length) cites=chunks.filter(c=>c.web).map(c=>({
      url:c.web.uri, title:c.web.title, host:(c.web.domain||"").replace(/^www\./,"")||hostOf(c.web.uri) }));
    else cites=parts.flatMap(p=>p.annotations||[]).filter(a=>a.type==="url_citation")
      .map(a=>({url:a.url,title:a.title,host:hostOf(a.url)}));
    return { text, citations:dedupe(cites) };
  },
  async demo(query, chan){ return DEMO.answer(query, chan); },
};

/* ══════════════════════════════════════════════════════════════════════
   Demo engine — a full dry run with no keys and no spend
   ══════════════════════════════════════════════════════════════════════ */
const DEMO = (() => {
  let seed=99; const rnd=()=>((seed=seed*1103515245+12345&0x7fffffff)/0x7fffffff);
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const DOMAINS=["reddit.com","news.ycombinator.com","trustpilot.com","g2.com","capterra.com",
    "trustradius.com","pcmag.com","techcrunch.com","theverge.com","zdnet.com","forbes.com",
    "wikipedia.org","stackoverflow.com","youtube.com","medium.com","producthunt.com"];
  return {
    structured(name, user){
      if(name==="profile"){
        const host=(CFG.site||"example.com").replace(/^https?:\/\//,"").replace(/\/.*$/,"");
        const brand=host.split(".")[0].replace(/^./,c=>c.toUpperCase());
        return { brand, aliases:[brand+" Pay"], product:brand+" "+(CFG.hint||"core product"),
          category:"Demo category", audience:"Demo buyers",
          competitors:[{name:"Northwind",domain:"northwind.example"},{name:"Contoso",domain:"contoso.example"},
            {name:"Fabrikam",domain:"fabrikam.example"}],
          themes:[{id:"pricing",name:"Pricing & fees"},{id:"security",name:"Security & trust"},
            {id:"setup",name:"Setup & onboarding"},{id:"support",name:"Support & disputes"},
            {id:"reach",name:"Reach & acceptance"},{id:"rewards",name:"Rewards & offers"}] };
      }
      if(name==="promptset"){
        const th=CFG.profile.themes, b=CFG.profile.brand;
        const stems=["best {c} in 2026","is {b} worth it","{b} vs {r} which is better","how to set up {b}",
          "cheapest option for {t}","{b} {t} problems","who has the best {t}","{b} pricing explained"];
        const out=[];
        for(let i=0;i<60;i++){
          const t=th[i%th.length];
          const brandLed=rnd()<.4;
          let s=pick(stems).replace("{c}",CFG.profile.category.toLowerCase())
            .replace("{t}",t.name.toLowerCase()).replace("{r}",CFG.profile.competitors[0].name);
          s = brandLed ? s.replace(/\{b\}/g,b) : s.replace(/\{b\}[^ ]*\s*/g,"").replace(/\{b\}/g,"");
          out.push({ text:(s.trim()||("best "+t.name.toLowerCase()))+"", intent:INTENTS[i%5].id, theme:t.id, brandLed });
        }
        return { prompts:out };
      }
      if(name==="extraction"){
        const lines=[...user.matchAll(/^\[(\d+)\]\s+([^\s—]+)/gm)].map(m=>m[2]);
        const q=(user.match(/Query:\s+"([^"]+)"/)||[])[1]||"the question";
        const ids=brandIds(CFG.profile);
        const rivals=ids.filter(x=>x!=="none");
        const nameOf=id=>id==="client"?CFG.profile.brand
          :/^(comp|sib)(\d+)$/.test(id)?CFG.profile.competitors[+id.replace(/\D/g,"")]?.name||id:"no brand";
        const POS=["{s} is cited for {b}'s strength here, and the answer leads with it.",
          "The answer uses {s} to recommend {b} outright for this case.",
          "{s} is quoted approvingly and {b} ends up top of the shortlist."];
        const NEU=["{s} supplies the definition; {b} appears as one example among several.",
          "The answer reproduces a table from {s} with {b} in the middle of the pack.",
          "Cited only for a figure — {s} on {b}, no verdict attached."];
        const NEG=["A complaint thread on {s} is generalised into a warning about {b}.",
          "{s} is used to argue {b} is the expensive option, steering the reader elsewhere.",
          "The answer repeats a stale claim from {s} that overstates {b}'s downside."];
        // Absence is the point of the new model, so the demo has to produce it.
        const mentioned = rnd() < .68;
        const order = rivals.slice().sort(()=>rnd()-.5);
        const present = mentioned ? [ "client", ...order.filter(x=>x!=="client" && rnd()<.55) ]
                                  : order.filter(x=>x!=="client" && rnd()<.7).slice(0,3);
        let left=100;
        const brandsMentioned = present.map((b,i)=>{
          const sharePct = i===present.length-1 ? Math.max(5,left) : Math.max(5,Math.round(left*(.3+rnd()*.4)));
          left-=sharePct;
          return { brand:b, order:i+1, recommended: i===0 && rnd()<.6, sharePct:Math.max(0,sharePct) };
        });
        return {
          refused:false,
          clientMentioned:mentioned,
          clientRecommended: mentioned && brandsMentioned[0]?.brand==="client" && rnd()<.55,
          answerSummary:`The answer to "${q}" leaned on ${lines.length} sources.`,
          brandsMentioned,
          citations:lines.map((dom,i)=>{
            const brand=pick(mentioned?ids:ids.filter(x=>x!=="client"));
            const sentiment=+((rnd()*1.7-0.75)+(dom==="reddit.com"||dom==="trustpilot.com"?-0.2:0.1)).toFixed(2);
            const bank=sentiment>=.22?POS:sentiment<=-.22?NEG:NEU;
            const tone=sentiment>=.22?pick(["Endorsing","Recommending","Reassuring"])
              :sentiment<=-.22?pick(["Cautionary","Skeptical","Warning"]):pick(["Neutral-factual","Hedged","Comparative"]);
            const verdict = rnd()<.42 ? pick(VERDICTS.filter(v=>v!=="not compared")) : "not compared";
            return { index:i+1, brand, sentiment:clamp(sentiment,-1,1), tone, verdict,
              claim:`${dom} on ${nameOf(brand)}`,
              evidence:pick(bank).replace("{s}",dom).replace("{b}",nameOf(brand)),
              nuance:[i===0?"first citation":i>=4?"buried citation":pick(NUANCE)],
              risks: rnd()<.07 ? [pick(RISKS)] : [],
              factConflict: (CFG.facts||"").trim() && rnd()<.09 ? "contradicts a ground-truth line" : "" };
          }) };
      }
      throw new Error("demo: unknown schema "+name);
    },
    async answer(query, chan){
      await sleep(60+rnd()*120);
      const n=2+Math.floor(rnd()*3);
      const cites=[]; const used=new Set();
      while(cites.length<n){ const d=pick(DOMAINS); if(used.has(d))continue; used.add(d);
        cites.push({ url:"https://"+d+"/x", title:d+" page", host:d }); }
      return { text:`[demo ${chan}] An answer to "${query}" citing ${cites.length} sources.`, citations:cites };
    },
  };
})();

/* ══════════════════════════════════════════════════════════════════════
   Extraction
   ══════════════════════════════════════════════════════════════════════ */
function brandRoster(p){
  const rows=[`client = ${p.brand}${p.product?` (${p.product})`:""}${p.aliases?.length?` — also called ${p.aliases.join(", ")}`:""}`];
  p.competitors.forEach((c,i)=>rows.push(
    `${c.sibling?"sib":"comp"}${i} = ${c.name}${c.sibling?"  ← OWNED BY the client; not a rival":""}`));
  rows.push("none = supports no tracked brand");
  return rows.join("\n");
}
function brandIds(p){
  return ["client", ...p.competitors.map((c,i)=>(c.sibling?"sib":"comp")+i), "none"];
}
function factBlock(){
  const f=(CFG.facts||"").trim();
  if(!f) return "";
  return `\n\nGROUND TRUTH — verified facts about the client, supplied by the client. If an answer `+
    `states something that contradicts a line here, set factConflict to the contradicted line, `+
    `quoted briefly. Do not flag things this list is simply silent about.\n${f.slice(0,6000)}\n`;
}

/* ══════════════════════════════════════════════════════════════════════
   Extraction — reads one answer twice over: once for what happened to the
   brand at the level of the whole answer (did we appear at all, where, were
   we recommended), once per citation.
   The answer-level half is the important half. A citation table can only
   describe answers you were in; the absences are where the strategy is.
   ══════════════════════════════════════════════════════════════════════ */
async function extractOne(profile, a){
  const ids=brandIds(profile);
  const rivals=ids.filter(b=>b!=="none");
  const numbered=a.citations.map((c,i)=>
    `[${i+1}] ${c.host||hostOf(c.url)||c.url} — ${c.title||"(untitled)"}${c.snippet?`\n    quoted: "${String(c.snippet).slice(0,220)}"`:""}`).join("\n");
  const hasFacts=!!(CFG.facts||"").trim();

  const schema={ type:"object", properties:{
    refused:{type:"boolean",description:"true if the assistant declined or gave no substantive answer"},
    clientMentioned:{type:"boolean",description:"is the client brand named anywhere in the answer"},
    clientRecommended:{type:"boolean",description:"does the answer actually recommend the client, not merely mention it"},
    answerSummary:{type:"string",description:"one sentence: what the answer told the reader to do"},
    brandsMentioned:{type:"array",description:"every tracked brand named, in the order they appear",
      items:{type:"object",properties:{
        brand:{type:"string",enum:rivals},
        order:{type:"integer",description:"1 = named first"},
        recommended:{type:"boolean"},
        sharePct:{type:"integer",description:"rough share of the answer's words spent on this brand, 0-100"},
      },required:["brand","order","recommended","sharePct"]}},
    citations:{type:"array",items:{type:"object",properties:{
      index:{type:"integer"},
      brand:{type:"string",enum:ids},
      sentiment:{type:"number",description:"-1 hostile to +1 glowing, about the brand named in `brand`"},
      tone:{type:"string",enum:TONES},
      verdict:{type:"string",enum:VERDICTS,description:"if this citation carries a head-to-head comparison, who came out ahead"},
      claim:{type:"string",description:"the assertion this source was used to support, <=20 words"},
      evidence:{type:"string",description:"the sentence carrying this citation, verbatim, <=45 words"},
      nuance:{type:"array",items:{type:"string",enum:NUANCE},description:"0-3 tags"},
      risks:{type:"array",items:{type:"string",enum:RISKS},description:"0-2, only for claims that would worry a lawyer"},
      ...(hasFacts?{factConflict:{type:"string",description:"the ground-truth line this contradicts, quoted briefly; omit or empty when nothing conflicts"}}:{}),
    },required:["index","brand","sentiment","tone","verdict","claim","evidence","nuance","risks"]}},
  }, required:["refused","clientMentioned","clientRecommended","answerSummary","brandsMentioned","citations"]};

  return structured({ name:"extraction", schema, maxTokens:8000,
    system:
      "You are auditing one AI assistant answer for a brand-visibility study. Work only from the text given.\n"+
      "Score sentiment about the brand the citation was used to support — not the overall mood of the answer, "+
      "and not your own view of the brand. If a citation supports a general or definitional point, brand = none "+
      "and sentiment = 0.\n"+
      "`verdict` is separate from sentiment: an answer can speak warmly about the client and still conclude a "+
      "rival is the better choice. Use 'not compared' unless the text really does adjudicate between brands.\n"+
      "`risks` is for claims that create legal or trust exposure regardless of tone — a guarantee that does not "+
      "exist, a price that is wrong, an implied regulatory protection. Leave it empty far more often than not.\n"+
      "Return exactly one entry per numbered citation, in order. Never invent citations.",
    user:`Assistant: ${a.channelName}\nQuery: "${a.query}"\n\nBrand roster:\n${brandRoster(profile)}\n`+
      factBlock()+`\nCited sources:\n${numbered||"(the answer cited nothing)"}\n\n---\nANSWER TEXT:\n${a.text}` });
}

/* ══════════════════════════════════════════════════════════════════════
   Verification — the one check that turns an opinion into a finding.
   Re-opens the cited page through the assistant's own web search and asks
   whether it actually says what the answer claimed it said. Deduplicated by
   (source, claim), because the same claim recurs across runs and you only
   need to check it once.
   ══════════════════════════════════════════════════════════════════════ */
async function verifyClaim(host, url, claim){
  if(CFG.demo){
    await sleep(50);
    const r=Math.random();
    return { support: r<.62?"supported":r<.86?"unsupported":"unreachable",
             note:"Demo verification — no page was opened." };
  }
  const asker = CFG.keys.anthropic ? ASK.claude : ASK.gemini;
  const res = await asker(
    `Open this page and read it: ${url}\n\n`+
    `Question: does that page actually support this claim?\n"${claim}"\n\n`+
    `Reply with exactly one word on the first line — SUPPORTED, UNSUPPORTED, or UNREACHABLE — `+
    `then one short sentence of justification. UNSUPPORTED means the page loads but does not say this. `+
    `UNREACHABLE means you could not read the page.`);
  const t=(res.text||"").trim();
  const word=(t.match(/\b(SUPPORTED|UNSUPPORTED|UNREACHABLE)\b/i)||[])[1];
  return { support: word?word.toLowerCase():"unreachable",
           note: t.split("\n").slice(1).join(" ").slice(0,220) || t.slice(0,220) };
}

/* ══════════════════════════════════════════════════════════════════════
   UI
   ══════════════════════════════════════════════════════════════════════ */
const STEPS = [
  {id:"keys",    t:"Connect",  d:"api keys"},
  {id:"target",  t:"Target",   d:"the website"},
  {id:"refine",  t:"Refine",   d:"brand & topics"},
  {id:"facts",   t:"Ground truth", d:"what is really true"},
  {id:"queries", t:"Queries",  d:"the question set"},
  {id:"collect", t:"Collect",  d:"run a snapshot"},
  {id:"explore", t:"Explore",  d:"the 3d view"},
];
function ready(id){
  switch(id){
    case "keys": return true;
    case "target": return !!workerKind();
    case "refine": return !!CFG.profile;
    case "facts": return !!CFG.profile;
    case "queries": return !!(CFG.prompts?.prompts?.length);
    case "collect": return !!(CFG.prompts?.prompts?.length);
    case "explore": return !!STATE.bundle;
  }
}
function doneStep(id){
  switch(id){
    case "keys": return !!workerKind();
    case "target": return !!CFG.profile;
    case "refine": return !!CFG.profile;
    case "facts": return !!(CFG.facts||"").trim();
    case "queries": return !!(CFG.prompts?.prompts?.length);
    case "collect": return !!STATE.bundle;
    case "explore": return false;
  }
}
function go(id){
  if(!ready(id)) return;
  CFG.step=id; saveCfg();
  $$(".pane").forEach(p=>p.classList.toggle("on", p.id==="p-"+id));
  renderSteps();
  if(id==="refine") renderRefine();
  if(id==="facts") renderFacts();
  if(id==="queries") renderQueries();
  if(id==="collect") renderCollect();
  if(id==="explore") renderExplore();
  $("#dsub").textContent = (CFG.profile? CFG.profile.brand+" · " : "") + (STEPS.find(s=>s.id===id)?.t||"");
  window.scrollTo({top:0,behavior:"instant"});
}
function renderSteps(){
  const host=$("#steps"); host.innerHTML="";
  STEPS.forEach((s,i)=>{
    const b=el("button","step"+(doneStep(s.id)?" done":""));
    b.setAttribute("aria-current", CFG.step===s.id?"true":"false");
    b.disabled=!ready(s.id);
    b.innerHTML=`<span class="num">${doneStep(s.id)?"✓":i+1}</span><span><span class="t">${s.t}</span><span class="d">${s.d}</span></span>`;
    b.onclick=()=>go(s.id);
    host.appendChild(b);
  });
  const w=workerKind();
  const pill=$("#enginePill");
  pill.textContent = w==="demo" ? "demo mode" : w ? `engine · ${w}` : "no engine";
  pill.className = "pill" + (w==="demo" ? " demo" : w ? " live" : "");
  $$("[data-go]").forEach(b=>b.disabled=!ready(b.dataset.go));
  const dp=$("#dataPill");
  dp.textContent = STATE.bundle ? `${STATE.bundle.records.length.toLocaleString()} citations` : "no data";
  dp.className = "pill" + (STATE.bundle ? " live" : "");
}

/* ── step 1 · channels ─────────────────────────────────────────────── */
function renderChannels(){
  const host=$("#chanlist"); host.innerHTML="";
  for(const c of CHANNELS){
    const meta=KEYMETA[c.key];
    const row=el("div","chan");
    const has=!!CFG.keys[c.key];
    row.innerHTML=`<div><div class="nm">${c.name}
        <span class="tag ${c.cors?"browser":"server"}">${c.cors?"browser":"actions only"}</span>
        ${has?'<span class="tag ok">key set</span>':""}</div>
      <div class="why">${c.why}</div></div>`;
    const wrap=el("div","keyw");
    const inp=el("input"); inp.type="password"; inp.placeholder=meta.ph;
    inp.value=CFG.keys[c.key]||""; inp.autocomplete="off"; inp.spellcheck=false;
    inp.oninput=()=>{ const v=inp.value.trim(); if(v) CFG.keys[c.key]=v; else delete CFG.keys[c.key];
      saveCfg(); renderSteps(); renderKeysHint(); };
    wrap.appendChild(inp);
    if(c.cors){
      const m=el("input"); m.type="text"; m.placeholder=DEFAULT_MODELS[c.id];
      m.value=(CFG.models&&CFG.models[c.id])||""; m.style.width="180px";
      m.title="Model id. Leave blank for "+DEFAULT_MODELS[c.id]+". Change it here when a vendor retires a name.";
      m.oninput=()=>{ CFG.models=CFG.models||{}; const v=m.value.trim();
        if(v) CFG.models[c.id]=v; else delete CFG.models[c.id]; saveCfg(); };
      wrap.appendChild(m);
      const t=el("button","btn sm","Test"); t.onclick=()=>testKey(c,t);
      wrap.appendChild(t);
    }
    row.appendChild(wrap);
    host.appendChild(row);
  }
  $("#btnDemo").setAttribute("aria-pressed", CFG.demo?"true":"false");
  $("#btnDemo").textContent = CFG.demo ? "Demo mode is on" : "Enable demo mode";
  $("#btnDemo").classList.toggle("primary", CFG.demo);
  renderKeysHint();
}
function renderKeysHint(){
  const live=CHANNELS.filter(c=>c.cors&&CFG.keys[c.key]).map(c=>c.name);
  const srv=CHANNELS.filter(c=>!c.cors&&CFG.keys[c.key]).map(c=>c.name);
  $("#keysHint").innerHTML = CFG.demo ? "Demo mode — nothing will be called."
    : live.length ? `<b>${live.join(" + ")}</b> will run in this browser.${srv.length?` ${srv.join(", ")} keys are stored for the Actions run.`:""}`
    : "Add Anthropic or Gemini to run anything here, or switch on demo mode.";
}
async function testKey(c, btn){
  const old=btn.textContent; btn.textContent="…"; btn.disabled=true;
  try{
    if(c.id==="claude") await api("https://api.anthropic.com/v1/messages",{method:"POST",
      headers:{"content-type":"application/json","x-api-key":CFG.keys.anthropic,
        "anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({model:model("claude"),max_tokens:8,messages:[{role:"user",content:"hi"}]})});
    if(c.id==="gemini") await api(`https://generativelanguage.googleapis.com/v1beta/models/${model("gemini")}:generateContent`,
      {method:"POST",headers:{"content-type":"application/json","x-goog-api-key":CFG.keys.gemini},
       body:JSON.stringify({contents:[{parts:[{text:"hi"}]}]})});
    btn.textContent="✓ ok";
  }catch(e){ btn.textContent="✗ failed"; alert(`${c.name} rejected the key:\n\n${e.message.slice(0,400)}`); }
  setTimeout(()=>{btn.textContent=old;btn.disabled=false;},2200);
}

/* ── step 2 · analyse ──────────────────────────────────────────────── */
async function analyse(){
  const site=$("#site").value.trim().replace(/^https?:\/\//,"").replace(/\/.*$/,"");
  if(!site) return alert("Enter a domain first.");
  CFG.site=site; CFG.hint=$("#hint").value.trim(); saveCfg();
  const st=$("#targetStatus"); st.textContent="reading the site…";
  $("#btnAnalyze").disabled=true;
  try{
    let corpus="";
    if(!CFG.demo){
      // Use the assistant's own web search to research the domain. No third-party
      // scraping proxy, and it sees roughly what the assistants themselves see.
      const asker = CFG.keys.anthropic ? ASK.claude : ASK.gemini;
      const r = await asker(
        `Research the company at ${site}. ${CFG.hint?`Focus on: ${CFG.hint}. `:""}`+
        `Report: what they sell, the specific product line, the category, who their real named `+
        `competitors are, which brands they own or operate as subsidiaries, and the topics customers `+
        `argue about when choosing in this category.`);
      corpus = r.text.slice(0, 20000);
    }
    st.textContent="profiling…";
    const schema={type:"object",properties:{
      brand:{type:"string"}, aliases:{type:"array",items:{type:"string"}},
      product:{type:"string"}, category:{type:"string"}, audience:{type:"string"},
      competitors:{type:"array",items:{type:"object",properties:{
        name:{type:"string"},domain:{type:"string"}},required:["name"]}},
      themes:{type:"array",items:{type:"object",properties:{
        id:{type:"string"},name:{type:"string",description:"two or three words, no longer"}},required:["id","name"]}},
    },required:["brand","product","category","competitors","themes"]};
    const profile=await structured({name:"profile",schema,
      system:"You profile a company for an AI-search-visibility study. Be concrete and current. "+
        "Competitors must be real, named rivals a buyer would shortlist — 3 to 6. Do NOT list brands the "+
        "company itself owns as competitors. Themes are the 6-9 decision topics people argue about in this "+
        "category, named in two or three words each, not marketing pillars.",
      user:`Domain: ${site}\n${CFG.hint?`Measuring specifically: ${CFG.hint}\n`:""}\nSite text:\n${corpus||"(unavailable — use your own knowledge of this domain)"}`});
    profile.site=site;
    profile.competitors=(profile.competitors||[]).map(c=>({...c,sibling:false}));
    profile.ownDomains=[site];
    CFG.profile=profile; CFG.prompts=null; saveCfg();
    st.textContent="";
    go("refine");
  }catch(e){ st.innerHTML=`<span style="color:#ffb3b3">${esc(e.message.slice(0,220))}</span>`; }
  finally{ $("#btnAnalyze").disabled=false; }
}

/* ── step 3 · refine ───────────────────────────────────────────────── */
function renderRefine(){
  const p=CFG.profile; if(!p) return;
  $("#brandName").value=p.brand||""; $("#prodName").value=p.product||"";
  $("#aliases").value=(p.aliases||[]).join(", ");
  const cl=$("#complist"); cl.innerHTML="";
  p.competitors.forEach((c,i)=>{
    const row=el("div","item");
    const inp=el("input"); inp.type="text"; inp.value=c.name;
    inp.oninput=()=>{c.name=inp.value;saveCfg()};
    const tg=el("button","toggle",c.sibling?"◆ we own this":"◇ rival");
    tg.setAttribute("aria-pressed",c.sibling?"true":"false");
    tg.title="Mark brands you own as siblings so they are not scored as competitors";
    tg.onclick=()=>{c.sibling=!c.sibling;saveCfg();renderRefine()};
    const x=el("button","x","✕"); x.title="Remove";
    x.onclick=()=>{p.competitors.splice(i,1);saveCfg();renderRefine()};
    row.append(inp,tg,x); cl.appendChild(row);
  });
  const tl=$("#themelist"); tl.innerHTML="";
  p.themes.forEach((t,i)=>{
    const row=el("div","item");
    const inp=el("input"); inp.type="text"; inp.value=t.name;
    inp.oninput=()=>{t.name=inp.value;saveCfg()};
    const sub=el("span","sub",esc(t.id));
    const x=el("button","x","✕");
    x.onclick=()=>{p.themes.splice(i,1);saveCfg();renderRefine()};
    row.append(inp,sub,x); tl.appendChild(row);
  });
  const sib=p.competitors.filter(c=>c.sibling).length;
  $("#refineStatus").innerHTML=`${p.competitors.length-sib} rivals · ${sib} sibling${sib===1?"":"s"} · ${p.themes.length} topics`
    + (CFG.prompts?` · <b>regenerating queries will reset your frozen set</b>`:"");
}

/* ── step 4 · ground truth ─────────────────────────────────────────── */
function renderFacts(){
  $("#facts").value=CFG.facts||"";
  const n=(CFG.facts||"").split("\n").map(x=>x.trim()).filter(Boolean).length;
  $("#factsStatus").innerHTML = n
    ? `<b>${n}</b> fact${n===1?"":"s"} — answers will be checked against them`
    : "No ground truth yet. Fact-conflict flags stay switched off.";
}

/* ── step 5 · queries ──────────────────────────────────────────────── */
async function genPrompts(force){
  const p=CFG.profile;
  if(CFG.prompts && !force) return;
  const st=$("#qStatus"); st.textContent="writing queries…";
  const schema={type:"object",properties:{prompts:{type:"array",items:{type:"object",properties:{
    text:{type:"string"}, intent:{type:"string",enum:INTENTS.map(i=>i.id)},
    theme:{type:"string",enum:p.themes.map(t=>t.id)}, brandLed:{type:"boolean"},
  },required:["text","intent","theme","brandLed"]}}},required:["prompts"]};
  const out=await structured({name:"promptset",schema,maxTokens:12000,
    system:"You write the query set for an AI-search-visibility study. These go verbatim to ChatGPT, Claude, "+
      "Perplexity, Gemini and Google AI Overviews every week, so they must be stable, natural and answerable. "+
      "Write how people actually type into an assistant — lowercase, plain. About 60% must NOT name the brand. "+
      "Spread evenly across themes and intents.",
    user:`Brand: ${p.brand} (${p.product})\nCategory: ${p.category}\n`+
      `Competitors: ${p.competitors.filter(c=>!c.sibling).map(c=>c.name).join(", ")}\n`+
      `Themes: ${p.themes.map(t=>`${t.id}=${t.name}`).join(", ")}\nWrite exactly 60 queries.`});
  CFG.prompts={ version:(CFG.prompts?.version||0)+1, created:today(),
    prompts:out.prompts.map((q,i)=>({id:"q"+i,...q})) };
  saveCfg(); st.textContent="";
}
function renderQueries(){
  const set=CFG.prompts; const t=$("#qtable");
  if(!set){ t.innerHTML=""; $("#qmetrics").innerHTML=""; return; }
  const led=set.prompts.filter(q=>q.brandLed).length;
  $("#qmetrics").innerHTML=[
    ["Queries",set.prompts.length],["Name the brand",Math.round(led/set.prompts.length*100)+"%"],
    ["Topics",new Set(set.prompts.map(q=>q.theme)).size],["Set version","v"+set.version],
  ].map(([k,v])=>`<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  t.innerHTML=`<thead><tr><th style="width:52%">Query</th><th>Intent</th><th>Topic</th><th></th></tr></thead>`;
  const tb=el("tbody");
  set.prompts.forEach((q,i)=>{
    const tr=el("tr");
    const td1=el("td"); const inp=el("input"); inp.type="text"; inp.value=q.text;
    inp.oninput=()=>{q.text=inp.value;saveCfg()}; td1.appendChild(inp);
    const td2=el("td"); td2.appendChild(sel(INTENTS,q.intent,v=>{q.intent=v;saveCfg()}));
    const td3=el("td"); td3.appendChild(sel(CFG.profile.themes,q.theme,v=>{q.theme=v;saveCfg()}));
    const td4=el("td"); const x=el("button","x","✕");
    x.onclick=()=>{set.prompts.splice(i,1);saveCfg();renderQueries()}; td4.appendChild(x);
    tr.append(td1,td2,td3,td4); tb.appendChild(tr);
  });
  t.appendChild(tb);
}
function sel(list,val,on){
  const s=el("select");
  s.innerHTML=list.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join("");
  s.value=val; s.onchange=()=>on(s.value); return s;
}

/* ── step 5 · collect ──────────────────────────────────────────────── */
function browserChannels(){
  if(CFG.demo) return CHANNELS.filter(c=>c.cors);
  return CHANNELS.filter(c=>c.cors && CFG.keys[c.key]);
}
function renderCollect(){
  const q=clamp(+$("#scanQ").value||20,1,CFG.prompts?.prompts?.length||200);
  const r=clamp(+$("#scanR").value||1,1,5);
  if(!$("#scanDate").value) $("#scanDate").value=today();
  const chans=browserChannels();
  const answers=chans.length*q*r;
  const vmax=CFG.scan.verify?clamp(+$("#verifyMax").value||40,1,400):0;
  $("#scanEstimate").innerHTML = chans.length
    ? `<b>${chans.map(c=>c.name).join(" + ")}</b> · ${answers} answers, ${answers} extraction calls`+
      (vmax?`, up to ${vmax} verification calls`:"")+`. Every answer and every verification is one `+
      `search-enabled model call; extraction is a plain one.`
    : `<span style="color:#ffb3b3">No browser-capable channel is keyed. Add Anthropic or Gemini, or use demo mode.</span>`;
  $("#ghRepo").value=CFG.gh.repo||""; $("#ghPat").value=CFG.gh.pat||"";
  $("#verifyToggle").setAttribute("aria-pressed",CFG.scan.verify?"true":"false");
  $("#verifyMax").value=CFG.scan.verifyMax||40;
  $("#verifyMax").disabled=!CFG.scan.verify;
  renderRunMetrics();
}
let RUN={done:0,total:0,cites:0,fails:0,unsupported:0};
function renderRunMetrics(){
  $("#runmetrics").innerHTML=[
    ["Progress",`${RUN.done}/${RUN.total||"–"}`],["Citations",RUN.cites],
    ["Unsupported",RUN.unsupported],["Failed",RUN.fails],["Snapshots",(STATE.dates||[]).length],
  ].map(([k,v])=>`<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
}
function log(msg,cls){
  const box=$("#log");
  if(box.children.length===1 && box.firstChild.textContent==="idle") box.innerHTML="";
  const d=el("div",cls||"",esc(msg)); box.appendChild(d); box.scrollTop=box.scrollHeight;
  while(box.children.length>400) box.removeChild(box.firstChild);
}
async function runCollection(){
  if(STATE.running) return;
  const chans=browserChannels();
  if(!chans.length) return alert("No browser-capable channel is keyed.");
  const date=$("#scanDate").value.trim()||today();
  const nQ=clamp(+$("#scanQ").value||20,1,CFG.prompts.prompts.length);
  const nR=clamp(+$("#scanR").value||1,1,5);
  CFG.scan={...CFG.scan,q:nQ,r:nR}; saveCfg();

  STATE.running=true; STATE.abort=false;
  $("#btnRun").disabled=true; $("#btnStop").disabled=false;
  const set=CFG.prompts.prompts.slice(0,nQ);
  const jobs=[];
  for(const c of chans) for(const q of set) for(let i=0;i<nR;i++) jobs.push({c,q,i});
  RUN={done:0,total:jobs.length,cites:0,fails:0,unsupported:0}; renderRunMetrics();
  log(`▸ ${jobs.length} answers · ${chans.map(c=>c.name).join(", ")} · snapshot ${date}`,"g");

  const answers=(await kvGet("ans:"+date))||[];
  const seen=new Set(answers.map(a=>a.aid));
  await pool(jobs,3,async ({c,q,i})=>{
    const aid=`${date}-${c.id}-${q.id}-r${i}`;
    if(seen.has(aid)) return;
    try{
      const res = CFG.demo ? await ASK.demo(q.text,c.id) : await ASK[c.id](q.text);
      const rec={ aid, date, channel:c.id, channelName:c.name, promptId:q.id, query:q.text,
        theme:q.theme, intent:q.intent, repeat:i, text:res.text,
        citations:res.citations.map((x,k)=>({rank:k+1,...x})) };
      answers.push(rec); seen.add(aid);
      RUN.cites+=rec.citations.length;
      if(answers.length%10===0) await kvPut("ans:"+date,answers);
      log(`  ${c.name} · ${q.text.slice(0,54)} · ${rec.citations.length} cites`,"d");
    }catch(e){ RUN.fails++; log(`✗ ${c.name}: ${(e.message||e).slice(0,110)}`,"e"); }
  },(done,total)=>{ RUN.done=done; $("#bar").style.width=(done/total*100).toFixed(1)+"%"; renderRunMetrics(); });
  await kvPut("ans:"+date,answers);
  if(STATE.abort){ log("■ stopped","e"); return finishRun(); }

  log(`▸ extracting what ${answers.length} answers actually said`,"g");
  const ext=(await kvGet("ext:"+date))||[];
  const have=new Set(ext.map(e=>e.aid));
  const todo=answers.filter(a=>!have.has(a.aid)&&a.citations.length);
  RUN.done=0; RUN.total=todo.length; renderRunMetrics();
  await pool(todo,3,async a=>{
    const out=await extractOne(CFG.profile,a);
    ext.push({aid:a.aid,...out});
    if(ext.length%10===0) await kvPut("ext:"+date,ext);
  },(done,total)=>{ RUN.done=done; $("#bar").style.width=(done/total*100).toFixed(1)+"%"; renderRunMetrics(); });
  await kvPut("ext:"+date,ext);
  if(STATE.abort){ log("■ stopped","e"); await buildBundle(); return finishRun(); }

  /* ── verify: does the cited page actually say what the answer claimed? ──
     Deduplicated by (source, claim) — the same claim recurs across runs and
     one check settles it for every instance. */
  if(CFG.scan.verify){
    const store=(await kvGet("ver:"+date))||{};
    const pairs=new Map();
    for(const e of ext){
      const a=answers.find(x=>x.aid===e.aid); if(!a) continue;
      for(const c of e.citations||[]){
        const cit=a.citations[c.index-1]; if(!cit||!cit.url) continue;
        const host=cit.host||hostOf(cit.url)||""; if(!host) continue;
        const key=host+"|"+(c.claim||"").slice(0,120);
        if(store[key]||pairs.has(key)) continue;
        pairs.set(key,{host,url:cit.url,claim:c.claim||""});
      }
    }
    const list=[...pairs.entries()].slice(0,clamp(+CFG.scan.verifyMax||40,1,400));
    if(list.length){
      log(`▸ verifying ${list.length} distinct claims against the pages they cite`,"g");
      RUN.done=0; RUN.total=list.length; renderRunMetrics();
      await pool(list,2,async ([key,v])=>{
        const out=await verifyClaim(v.host,v.url,v.claim);
        store[key]=out;
        if(out.support==="unsupported") RUN.unsupported++;
      },(done,total)=>{ RUN.done=done; $("#bar").style.width=(done/total*100).toFixed(1)+"%"; renderRunMetrics(); });
      await kvPut("ver:"+date,store);
      log(`  ${RUN.unsupported} claim(s) the cited page does not support`, RUN.unsupported?"e":"d");
    }
  }

  await buildBundle();
  finishRun();
}
function finishRun(){
  STATE.running=false; $("#btnRun").disabled=false; $("#btnStop").disabled=true;
  renderRunMetrics(); renderSteps(); renderExplore();
}
async function snapshotDates(){
  const keys=await kvKeys();
  return keys.filter(k=>String(k).startsWith("ans:")).map(k=>String(k).slice(4)).sort();
}
async function buildBundle(){
  const p=CFG.profile;
  if(!p) return;
  const dates=await snapshotDates();
  STATE.dates=dates;
  if(!dates.length){ log("nothing collected yet","e"); return; }
  const epoch=new Date(dates[0]);
  const own=[p.site,...(p.competitors||[]).map(c=>c.domain).filter(Boolean)]
    .filter(Boolean).map(d=>d.replace(/^www\./,"").toLowerCase());
  const roster=new Set(brandIds(p));
  const sources=new Map(); const records=[]; const answers=[]; let rid=0;

  for(const date of dates){
    const raw=(await kvGet("ans:"+date))||[];
    const byId=new Map(raw.map(a=>[a.aid,a]));
    const ver=(await kvGet("ver:"+date))||{};
    const week=Math.max(1,Math.floor((new Date(date)-epoch)/(7*864e5))+1);

    for(const ex of (await kvGet("ext:"+date))||[]){
      const a=byId.get(ex.aid); if(!a) continue;

      /* ── one row per ANSWER. This is the half that can see absence. ── */
      const brands=(ex.brandsMentioned||[]).filter(b=>roster.has(b.brand));
      answers.push({
        aid:a.aid, platform:a.channel, prompt:a.promptId, theme:a.theme, intent:a.intent,
        week, repeat:a.repeat, refused:!!ex.refused,
        mentioned:!!ex.clientMentioned, recommended:!!ex.clientRecommended,
        first:brands.length?brands.slice().sort((x,y)=>x.order-y.order)[0].brand:null,
        brands:brands.map(b=>({brand:b.brand,order:b.order,recommended:!!b.recommended,
          share:clamp(Number(b.sharePct)||0,0,100)})),
        cites:(a.citations||[]).length,
        sources:[...new Set((a.citations||[]).map(c=>slug(classify(c.host||hostOf(c.url),own)?.host||"")).filter(Boolean))],
      });

      /* ── one row per CITATION, as before, now carrying verdict / risk / truth ── */
      for(const c of ex.citations||[]){
        const cit=a.citations[c.index-1]; if(!cit) continue;
        const cls=classify(cit.host||hostOf(cit.url),own); if(!cls) continue;
        if(!sources.has(cls.host)) sources.set(cls.host,
          {id:slug(cls.host),dom:cls.host,type:cls.type,auth:cls.auth,influence:INFLUENCE[cls.type]||"earned"});
        const sent=clamp(Number(c.sentiment)||0,-1,1);
        const brand=roster.has(c.brand)?c.brand:"none";
        const key=cls.host+"|"+(c.claim||"").slice(0,120);
        const v=ver[key];
        const conflict=(c.factConflict||"").trim();
        const nuance=(c.nuance||[]).slice(0,3);
        records.push({
          id:"r"+(rid++), aid:a.aid, platform:a.channel, prompt:a.promptId,
          theme:a.theme, intent:a.intent, source:slug(cls.host), stype:cls.type,
          influence:INFLUENCE[cls.type]||"earned",
          brand, sent:Math.round(sent*100)/100,
          bandId:sent>=.22?"pos":sent<=-.22?"neg":"neu",
          verdict:VERDICTS.includes(c.verdict)?c.verdict:"not compared",
          rank:cit.rank, week, auth:cls.auth, tone:c.tone,
          text:c.evidence||c.claim, claim:c.claim, nuance,
          risks:(c.risks||[]).slice(0,2),
          factConflict:conflict||null,
          support:v?v.support:"unchecked", supportNote:v?v.note:null,
          url:cit.url||null,
        });
      }
    }
  }
  if(!records.length && !answers.length){ log("nothing survived extraction","e"); return; }

  /* ── volatility: same question, same model, different day-to-day answer ── */
  const vol=[]; const grp=new Map();
  for(const a of answers){
    const k=a.prompt+"|"+a.platform;
    (grp.get(k)||grp.set(k,[]).get(k)).push(a);
  }
  for(const [k,list] of grp){
    if(list.length<2) continue;
    const [prompt,platform]=k.split("|");
    const appear=list.filter(a=>a.mentioned).length/list.length;
    const firsts=new Set(list.map(a=>a.first));
    const jac=[];
    for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){
      const A=new Set(list[i].sources), B=new Set(list[j].sources);
      const inter=[...A].filter(x=>B.has(x)).length, uni=new Set([...A,...B]).size;
      if(uni) jac.push(inter/uni);
    }
    vol.push({ prompt, platform, runs:list.length,
      appearRate:Math.round(appear*100)/100,
      flipped: appear>0 && appear<1,
      firstBrandChurn: firsts.size>1,
      sourceOverlap: jac.length?Math.round(jac.reduce((x,y)=>x+y,0)/jac.length*100)/100:1 });
  }

  const used=new Set([...records.map(r=>r.brand), ...answers.flatMap(a=>a.brands.map(b=>b.brand)), "client"]);
  const brands=[{id:"client",name:p.brand,client:true},
    ...p.competitors.map((c,i)=>({id:(c.sibling?"sib":"comp")+i,name:c.name,sibling:!!c.sibling})),
    {id:"none",name:"No brand (general)"}].filter(b=>used.has(b.id));

  const bundle={
    meta:{ schema:2, brand:p.brand, product:p.product, site:p.site, generated:today(),
      weeks:Math.max(1,...records.map(r=>r.week),...answers.map(a=>a.week)),
      promptSetVersion:CFG.prompts?.version||1, snapshots:dates, demo:!!CFG.demo,
      hasFacts:!!(CFG.facts||"").trim(),
      verified:records.filter(r=>r.support!=="unchecked").length },
    platforms:CHANNELS.filter(c=>answers.some(a=>a.platform===c.id)||records.some(r=>r.platform===c.id))
      .map(c=>({id:c.id,name:c.name})),
    themes:p.themes, brands,
    prompts:CFG.prompts.prompts.map(q=>({id:q.id,text:q.text,intent:q.intent,theme:q.theme})),
    sources:[...sources.values()], records, answers, volatility:vol,
  };
  STATE.bundle=bundle; await kvPut("bundle",bundle);
  const seen=answers.filter(a=>a.mentioned).length;
  log(`✓ ${records.length} citations · ${answers.length} answers · seen in ${answers.length?Math.round(seen/answers.length*100):0}% · ${bundle.sources.length} sources`,"g");
  renderSteps(); renderExplore();
}

/* ── GitHub Actions engine ─────────────────────────────────────────── */
const b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
async function ghPutRaw(repo, pat, path, text, msg){
  const H = { authorization:"Bearer "+pat, accept:"application/vnd.github+json",
              "x-github-api-version":"2022-11-28", "content-type":"application/json" };
  let sha;
  const cur = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers:H });
  if(cur.ok) sha = (await cur.json()).sha;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method:"PUT", headers:H,
    body:JSON.stringify({ message:msg, content:b64(text), ...(sha?{sha}:{}) }),
  });
  if(!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0,180)}`);
}
async function ghPut(repo, pat, path, obj, msg){
  const H = { authorization:"Bearer "+pat, accept:"application/vnd.github+json",
              "x-github-api-version":"2022-11-28", "content-type":"application/json" };
  let sha;
  const cur = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers:H });
  if(cur.ok) sha = (await cur.json()).sha;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method:"PUT", headers:H,
    body:JSON.stringify({ message:msg, content:b64(JSON.stringify(obj,null,2)), ...(sha?{sha}:{}) }),
  });
  if(!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0,180)}`);
}
/* The Action needs the same profile and frozen query set the dashboard is
   using, so push them before asking it to run. Requires contents:write on
   the token alongside actions:write. */
async function pushConfig(repo, pat){
  const p = CFG.profile;
  await ghPut(repo, pat, "pipeline/data/profile.json",
    { ...p, ownDomains:[p.site, ...(p.competitors||[]).map(c=>c.domain).filter(Boolean)] },
    "answer-space: profile");
  await ghPut(repo, pat, "pipeline/data/prompts.json", CFG.prompts, "answer-space: query set");
  if((CFG.facts||"").trim())
    await ghPutRaw(repo, pat, "pipeline/data/facts.txt", CFG.facts, "answer-space: ground truth");
}
async function dispatch(){
  const repo=$("#ghRepo").value.trim(), pat=$("#ghPat").value.trim();
  CFG.gh={repo,pat}; saveCfg();
  if(!repo||!pat) return alert("Repository and token are both required.");
  if(!CFG.profile||!CFG.prompts) return alert("Finish Refine and Queries first — the Action runs your frozen set, not its own.");
  const st=$("#ghStatus"); st.textContent="pushing config…";
  try{
    await pushConfig(repo,pat);
    st.textContent="dispatching…";
    const res=await fetch(`https://api.github.com/repos/${repo}/actions/workflows/collect.yml/dispatches`,{
      method:"POST",
      headers:{ authorization:"Bearer "+pat, accept:"application/vnd.github+json",
        "x-github-api-version":"2022-11-28", "content-type":"application/json" },
      body:JSON.stringify({ ref:"main", inputs:{
        site:CFG.profile?.site||CFG.site||"", queries:String(CFG.scan.q||20),
        repeats:String(CFG.scan.r||3), verify:CFG.scan.verify?"true":"false" } }),
    });
    if(res.status===204){ st.innerHTML='<span style="color:#5fd6aa">queued — watch the Actions tab</span>'; }
    else st.innerHTML=`<span style="color:#ffb3b3">${res.status} ${esc((await res.text()).slice(0,160))}</span>`;
  }catch(e){ st.innerHTML=`<span style="color:#ffb3b3">${esc(e.message.slice(0,160))}</span>`; }
}
async function pullRecords(){
  const st=$("#ghStatus"); st.textContent="pulling…";
  try{
    const r=await fetch("./records.json?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok) throw new Error("no records.json beside this page ("+r.status+")");
    const b=await r.json(); await adoptBundle(b);
    st.innerHTML=`<span style="color:#5fd6aa">loaded ${b.records.length} citations</span>`;
  }catch(e){ st.innerHTML=`<span style="color:#ffb3b3">${esc(e.message.slice(0,180))}</span>`; }
}
async function adoptBundle(b){
  if(!b||!Array.isArray(b.records)) throw new Error("that file is not a records bundle");
  STATE.bundle=b; await kvPut("bundle",b); renderSteps(); renderExplore();
}

/* ── step 6 · explore ──────────────────────────────────────────────── */
function renderExplore(){
  const b=STATE.bundle;
  if(!b){ $("#dsmetrics").innerHTML=""; $("#exploreStatus").textContent="Nothing collected yet."; return; }
  const R=b.records||[], A=b.answers||[], V=b.volatility||[];
  const s=R.length?R.reduce((x,r)=>x+r.sent,0)/R.length:0;
  const seen=A.filter(a=>a.mentioned).length;
  const rec=A.filter(a=>a.recommended).length;
  const flip=V.filter(v=>v.flipped).length;
  const unsup=R.filter(r=>r.support==="unsupported").length;
  const conf=R.filter(r=>r.factConflict).length;
  const risk=R.filter(r=>r.risks&&r.risks.length).length;
  const loses=R.filter(r=>r.verdict==="client loses").length;
  const wins=R.filter(r=>r.verdict==="client wins").length;
  const tile=(k,v,col)=>`<div class="metric"><div class="k">${k}</div><div class="v"${col?` style="color:${col}"`:""}>${v}</div></div>`;
  $("#dsmetrics").innerHTML=
      tile("Seen in", A.length?Math.round(seen/A.length*100)+"%":"–")
    + tile("Recommended", A.length?Math.round(rec/A.length*100)+"%":"–")
    + tile("Answers", A.length.toLocaleString())
    + tile("Citations", R.length.toLocaleString())
    + tile("Avg tone", (s>=0?"+":"")+s.toFixed(2))
    + tile("Unstable queries", flip, flip?"#c98500":null)
    + tile("Head-to-head", wins+loses?`${wins}W ${loses}L`:"–", loses>wins?"#ff6b6b":null)
    + tile("Unsupported", unsup, unsup?"#ff6b6b":null)
    + (b.meta.hasFacts?tile("Fact conflicts", conf, conf?"#ff6b6b":null):"")
    + (risk?tile("Risk flags", risk, "#c98500"):"");

  const bits=[];
  if(b.meta.demo) bits.push('<span style="color:#e0b558">Demo data — every number here is fabricated.</span>');
  bits.push(`${b.meta.snapshots.length} snapshot${b.meta.snapshots.length===1?"":"s"} · query set v${b.meta.promptSetVersion}`);
  if(!b.meta.verified) bits.push('verification was off for this run — "unsupported" cannot be counted');
  if(!b.meta.hasFacts) bits.push("no ground truth supplied — fact conflicts not checked");
  $("#exploreStatus").innerHTML=bits.join(" · ");
}

function openViz(){
  if(!STATE.bundle) return;
  document.body.classList.add("viz-open");
  $("#app").classList.add("on");
  VIZ.load(STATE.bundle);
  requestAnimationFrame(()=>VIZ.refit());
}
function closeViz(){
  document.body.classList.remove("viz-open");
  $("#app").classList.remove("on");
}
function download(name,obj){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"});
  const a=el("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

/* ══════════════════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════════════════ */
async function boot(){
  loadCfg();
  renderChannels();
  $("#site").value=CFG.site||""; $("#hint").value=CFG.hint||"";
  $("#scanQ").value=CFG.scan.q||20; $("#scanR").value=CFG.scan.r||3;
  $("#verifyMax").value=CFG.scan.verifyMax||40; $("#scanDate").value=today();
  $("#facts").value=CFG.facts||"";

  $$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  $("#btnDemo").onclick=()=>{ CFG.demo=!CFG.demo; saveCfg(); renderChannels(); renderSteps(); };
  $("#btnAnalyze").onclick=analyse;
  $("#btnAddComp").onclick=()=>{ const v=$("#newComp").value.trim(); if(!v)return;
    CFG.profile.competitors.push({name:v,sibling:false}); $("#newComp").value=""; saveCfg(); renderRefine(); };
  $("#btnAddTheme").onclick=()=>{ const v=$("#newTheme").value.trim(); if(!v)return;
    CFG.profile.themes.push({id:slug(v)||"t"+Date.now(),name:v}); $("#newTheme").value=""; saveCfg(); renderRefine(); };
  ["brandName","prodName","aliases"].forEach(id=>$("#"+id).oninput=()=>{
    CFG.profile.brand=$("#brandName").value.trim();
    CFG.profile.product=$("#prodName").value.trim();
    CFG.profile.aliases=$("#aliases").value.split(",").map(s=>s.trim()).filter(Boolean);
    saveCfg();
  });
  $("#btnToFacts").onclick=()=>go("facts");
  $("#facts").oninput=()=>{ CFG.facts=$("#facts").value; saveCfg(); renderFacts(); renderSteps(); };
  $("#btnSkipFacts").onclick=async()=>{ CFG.facts=""; saveCfg(); await toQueries(); };
  async function toQueries(){
    const b=$("#btnToQueries"); b.disabled=true;
    try{ await genPrompts(false); go("queries"); }
    catch(e){ alert("Could not write the query set:\n\n"+e.message.slice(0,300)); }
    finally{ b.disabled=false; }
  }
  $("#btnToQueries").onclick=toQueries;
  $("#verifyToggle").onclick=()=>{ CFG.scan.verify=!CFG.scan.verify; saveCfg(); renderCollect(); };
  $("#verifyMax").oninput=()=>{ CFG.scan.verifyMax=clamp(+$("#verifyMax").value||40,1,400); saveCfg(); renderCollect(); };
  $("#btnRegen").onclick=async()=>{
    if(!confirm("Rewrite all 60 queries?\n\nAny snapshots you have already collected stay on disk, but they were answered against the old questions — the timeline will not be comparable across the change."))return;
    try{ await genPrompts(true); renderQueries(); }catch(e){ alert(e.message); }
  };
  $("#btnAddQ").onclick=()=>{ CFG.prompts.prompts.push({id:"q"+Date.now(),text:"",
    intent:"info",theme:CFG.profile.themes[0].id,brandLed:false}); saveCfg(); renderQueries(); };
  ["scanQ","scanR"].forEach(id=>$("#"+id).oninput=renderCollect);
  $("#btnRun").onclick=()=>runCollection().catch(e=>{log("✗ "+e.message,"e");finishRun()});
  $("#btnStop").onclick=()=>{ STATE.abort=true; log("stopping after in-flight calls…","e"); };
  $("#btnBuild").onclick=()=>buildBundle();
  $("#btnDispatch").onclick=dispatch;
  $("#btnPull").onclick=pullRecords;
  $("#btnOpenViz").onclick=openViz;
  $("#backToSetup").onclick=closeViz;
  $("#btnDownload").onclick=()=>STATE.bundle&&download("records.json",STATE.bundle);
  $("#fileIn").onchange=async e=>{
    const f=e.target.files[0]; if(!f)return;
    try{ await adoptBundle(JSON.parse(await f.text())); go("explore"); }
    catch(err){ alert("Could not read that file:\n\n"+err.message); }
  };
  $("#btnExport").onclick=async()=>download("answer-space-config.json",
    {cfg:{...CFG,keys:{}},bundle:STATE.bundle,dates:await snapshotDates()});
  $("#btnWipe").onclick=async()=>{
    if(!confirm("Delete the profile, query set, every snapshot and all keys from this browser?"))return;
    localStorage.removeItem(LS);
    for(const k of await kvKeys()) await kvDel(k);
    location.reload();
  };
  addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("#app").classList.contains("on")) closeViz(); });

  STATE.bundle=(await kvGet("bundle"))||null;
  STATE.dates=await snapshotDates();
  if(!STATE.bundle){ try{ const r=await fetch("./records.json",{cache:"no-store"});
    if(r.ok) STATE.bundle=await r.json(); }catch{} }
  go(ready(CFG.step)?CFG.step:"keys");
  renderSteps();
}
boot();

/* exposed for tests and console poking only */
window.APP={ get cfg(){return CFG}, get state(){return STATE}, go, buildBundle, openViz, closeViz };
})();
