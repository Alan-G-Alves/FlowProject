const fs = require("fs");
const path = require("path");

const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    if (fs.statSync(filePath).isDirectory()) {
      walk(filePath);
    } else if (filePath.endsWith(".html")) {
      files.push(filePath);
    }
  }
}

walk(path.resolve(__dirname, "..", "public"));

const issues = [];
const existingPagesOutsideSeoScope = new Set([
  path.normalize(path.resolve(__dirname, "..", "public", "index.html")),
  path.normalize(path.resolve(__dirname, "..", "public", "privacidade.html")),
  path.normalize(path.resolve(__dirname, "..", "public", "termos.html")),
  path.normalize(path.resolve(__dirname, "..", "public", "lgpd.html")),
  path.normalize(path.resolve(__dirname, "..", "public", "dpa.html")),
  path.normalize(path.resolve(__dirname, "..", "public", "venda.html"))
]);

for (const file of files) {
  if (existingPagesOutsideSeoScope.has(path.normalize(file))) continue;
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes("<title>")) issues.push(`${file}: missing title`);
  if (!html.includes('meta name="description"')) issues.push(`${file}: missing description`);

  const jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = jsonLdPattern.exec(html))) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      issues.push(`${file}: invalid JSON-LD: ${error.message}`);
    }
  }
}

console.log(`HTML files: ${files.length}`);
console.log(`Issues: ${issues.length}`);
if (issues.length) {
  console.log(issues.join("\n"));
  process.exit(1);
}
