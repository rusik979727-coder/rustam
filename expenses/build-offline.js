// Builds the installable offline app (expenses/offline/) from expenses/index.html.
// Run: node expenses/build-offline.js
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "index.html");
const outDir = path.join(__dirname, "offline");
const body = fs.readFileSync(src, "utf8");

const head = `<!doctype html>
<html lang="kk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14232b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Шығын">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), head + body + "\n</body>\n</html>\n");

// Bump the cache version whenever the app changes so installed copies update.
const hash = require("crypto").createHash("sha1").update(body).digest("hex").slice(0, 10);
const sw = fs.readFileSync(path.join(outDir, "sw.js"), "utf8")
  .replace(/const VERSION = "[^"]*";/, `const VERSION = "${hash}";`);
fs.writeFileSync(path.join(outDir, "sw.js"), sw);
console.log("Built expenses/offline/index.html, cache version", hash);
