/* Bakes the explorer into one portable file: no dashboard, reads ./records.json
   if it is served alongside, otherwise draws the built-in demo dataset. */
import fs from "node:fs";
const css = fs.readFileSync("viz.css","utf8")
  .replace('#app{position:fixed;inset:0;z-index:400;display:none;grid-template-rows:52px 1fr;background:var(--ground);\n  max-width:100vw;overflow:hidden}\n#app.on{display:grid}',
           '#app{position:fixed;inset:0;display:grid;grid-template-rows:52px 1fr;background:var(--ground);\n  max-width:100vw;overflow:hidden}')
  .replace(/\n\/\* explorer is an overlay owned by the dashboard \*\/[\s\S]*?#backToSetup:hover\{[^}]*\}\n/, "\n")
  .replace(/\nbody\.viz-open #dash\{display:none\}\n/, "\n");
const html = fs.readFileSync("index.html","utf8");
const markup = html.slice(html.indexOf('<div id="app">'), html.indexOf('\n<script>window.ANSWER_SPACE_APP'))
  .replace('<button id="backToSetup" title="Back to the dashboard">← Setup</button>\n    ','');
const js = fs.readFileSync("viz.js","utf8");
fs.writeFileSync("answer-space-explorer.html",
`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Answer Space</title>
<meta name="description" content="A 3D read of how AI assistants answer questions in your category: whether you appear at all, which sources they cite, and what the answers claim.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='13' fill='%234d9cff'/%3E%3Ccircle cx='12' cy='12' r='5' fill='%23bfe0ff'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
${css.trim()}
</style>
</head>
<body>
${markup.trim()}
<script>
${js.trim()}
</script>
</body>
</html>
`);
console.log("answer-space-explorer.html", fs.statSync("answer-space-explorer.html").size);
