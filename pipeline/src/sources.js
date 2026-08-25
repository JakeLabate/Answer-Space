import { hostOf } from "./util.js";
import { SOURCE_TYPES } from "./taxonomy.js";

/* Domain → source type + authority.
   Rules first, then an operator override file, then a conservative default.
   Authority is a 0-1 proxy for "how much weight a reader gives this outlet".
   Wire your own DR/DA feed in `authorityFor` if you have one; the static floor
   is honest but coarse, and the viz labels it as a proxy. */

const RULES = [
  [/(^|\.)reddit\.com$|quora\.com$|trustpilot\.com$|news\.ycombinator\.com$|stackexchange\.com$|stackoverflow\.com$|discord\.com$|(^|\.)x\.com$|twitter\.com$/, "community", 0.55],
  [/youtube\.com$|tiktok\.com$|instagram\.com$|vimeo\.com$|medium\.com$|substack\.com$|linkedin\.com$/, "video", 0.42],
  [/wikipedia\.org$|investopedia\.com$|britannica\.com$|statista\.com$|\.gov$|\.edu$|docs\./, "reference", 0.80],
  [/nerdwallet\.com$|bankrate\.com$|cnet\.com$|pcmag\.com$|tomsguide\.com$|techradar\.com$|g2\.com$|capterra\.com$|trustradius\.com$|consumerreports\.org$|forbes\.com\/advisor/, "review", 0.75],
  [/reuters\.com$|wsj\.com$|ft\.com$|bloomberg\.com$|cnbc\.com$|nytimes\.com$|theverge\.com$|techcrunch\.com$|wired\.com$|arstechnica\.com$|businessinsider\.com$|forbes\.com$|guardian|bbc\.co/, "editorial", 0.84],
];

export function makeClassifier({ ownDomains = [], overrides = {} } = {}) {
  const own = ownDomains.map((d) => d.replace(/^www\./, "").toLowerCase());
  return function classify(url) {
    const host = hostOf(url) || url?.host || null;
    if (!host) return null;
    if (overrides[host]) return { host, ...overrides[host] };
    if (own.some((d) => host === d || host.endsWith(`.${d}`))) return { host, type: "owned", auth: 0.88 };
    for (const [re, type, auth] of RULES) if (re.test(host)) return { host, type, auth };
    // Unknown: assume an editorial-ish long tail with modest authority.
    return { host, type: "editorial", auth: 0.45 };
  };
}

export const TYPE_IDS = SOURCE_TYPES.map((t) => t.id);
