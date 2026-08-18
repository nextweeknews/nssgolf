const TEAM_STYLES = {
  "ANIMALS": { bg: "#2b2020", fg: "#ffffff" },
  "TERRIFIC TIGERS": { bg: "#fe6d01", fg: "#000000" },
  "BREAKERS": { bg: "#f1c232", fg: "#1c4487" },
  "DAGGERS": { bg: "#ea9999", fg: "#1d2244" },
  "SNIPERS": { bg: "#275318", fg: "#ffe6cd" },
  "MCSTROKERS": { bg: "#4d94d8", fg: "#ffffff" },
  "INFERNIX": { bg: "#f6b26b", fg: "#000000" },
  "INFERNIX*": { bg: "#f6b26b", fg: "#000000" },
  "DOUBLE-EAGLES": { bg: "#1c4487", fg: "#ffffff" },
  "PHANTOM TROUPE": { bg: "#674ea7", fg: "#ffffff" },
  "ASTERISM": { bg: "#ba2636", fg: "#ffffff" },
  "CARROTS": { bg: "#ff9966", fg: "#000000" },
  "SPOCCO COWS": { bg: "#78206e", fg: "#ffffff" },
  "BURGERS": { bg: "#7e5444", fg: "#ffffff" },
  "TREEMEISTERS": { bg: "#2d6316", fg: "#ffffff" },
  "FLAG SMOKERS": { bg: "#03384B", fg: "#ffffff" },
  "REVERIE": { bg: "#d9d2e9", fg: "#00367a" },
  "DELIRIUM": { bg: "#86c7f5", fg: "#052741" },
};

function slugify(value){
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getProLeagueTeamStyle(name){
  return TEAM_STYLES[String(name || "").trim().toUpperCase()] || null;
}

export function proLeagueTeamLogoSrc(name){
  return `/proleague/logos/${slugify(name)}.png`;
}
