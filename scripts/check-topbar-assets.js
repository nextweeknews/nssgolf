const { createHash } = require("node:crypto");
const { readdirSync, readFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const ROOT = join(__dirname, "..");
const ASSETS = ["site-topbar.css", "site-topbar.js", "settings-page.css"];
const SKIP = new Set([".git", "node_modules", "_site"]);

function htmlFiles(directory){
  return readdirSync(directory, { withFileTypes:true }).flatMap((entry) => {
    if(SKIP.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if(entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

const files = htmlFiles(ROOT);
const errors = [];

ASSETS.forEach((asset) => {
  const expected = createHash("sha256")
    .update(readFileSync(join(ROOT, asset)))
    .digest("hex")
    .slice(0, 12);
  const pattern = new RegExp(`/${asset.replaceAll(".", "\\.")}(?:\\?v=([^"'\\s>]+))?`, "g");
  let references = 0;

  files.forEach((file) => {
    const source = readFileSync(file, "utf8");
    for(const match of source.matchAll(pattern)){
      references += 1;
      if(match[1] !== expected){
        errors.push(`${relative(ROOT, file)}: /${asset} must use ?v=${expected}`);
      }
    }
  });

  if(!references) errors.push(`No HTML references found for ${asset}`);
});

if(errors.length){
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Topbar asset versions match their content hashes.");
