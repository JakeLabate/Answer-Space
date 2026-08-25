import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./util.js";
/* Dev server. The dashboard fetches ./records.json, and fetch() is blocked on
   file:// — so open it through here rather than by double-clicking the html.
   Serves the repo root (one level up from pipeline/) so index.html, the assets
   and the pipeline's own data/records.json all resolve. */
const SITE = path.resolve(ROOT, "..");
const PORT = process.env.PORT || 8080;
const MIME = { ".html":"text/html", ".json":"application/json", ".js":"text/javascript",
               ".css":"text/css", ".svg":"image/svg+xml" };
http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split("?")[0]);
  if (f === "/") f = "/index.html";
  let p = path.join(SITE, f);
  if (f === "/records.json" && !fs.existsSync(p)) p = path.join(ROOT, "data", "records.json");
  if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream",
                       "cache-control": "no-store" });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`▸ http://localhost:${PORT}`));
