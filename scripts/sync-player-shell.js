const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "player.html");
const fallbackPath = path.join(root, "404.html");

function read(filePath){
  return fs.readFileSync(filePath, "utf8");
}

function main(){
  const shouldWrite = process.argv.includes("--write");
  const source = read(sourcePath);
  const fallback = read(fallbackPath);

  if(source === fallback){
    console.log("player.html and 404.html are in sync.");
    return;
  }

  if(shouldWrite){
    fs.writeFileSync(fallbackPath, source);
    console.log("Synced 404.html from player.html.");
    return;
  }

  console.error("player.html and 404.html are out of sync.");
  console.error("Run `npm run sync:player-shell` after intentional player shell changes.");
  process.exit(1);
}

main();
