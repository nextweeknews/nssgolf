export const RESULT_EVENTS = Object.freeze([
  {
    key:"proleague",
    label:"Shotgun Pro League",
    color:"#7dd3fc",
    publicPath:"/proleague/index.html",
    sheetId:"1qIM0HKhx9Y-3eCJCFzBqrbATwiPrK3C1ynATwZzRC1o",
  },
  {
    key:"superleague",
    label:"Super League",
    color:"#d176ff",
    publicPath:"/superleague/index.html",
    sheetId:"1BbT8t6erCVdx-Bdshv_hax9r9JSRzU1WygjWxW3vPkY",
  },
  {
    key:"worldopen",
    label:"World Open",
    color:"#5dff9c",
    publicPath:"/worldopen/index.html",
    sheetId:"1WcRVGmEpQkRDTwe8aDfQgxuDoapvLxAdSjnqg4PHgXM",
  },
  {
    key:"lightningcup",
    label:"Lightning Cup",
    color:"#f6ff6a",
    publicPath:"/lightningcup/index.html",
    sheetId:"1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ",
  },
  {
    key:"noptational",
    label:"The Noptational",
    color:"#818cf8",
    publicPath:"/noptational.html",
    sheetId:"1T7kmgUtimrOW3LaTw2hYLMFvO600SjmUDLTecL6gY00",
  },
  {
    key:"championship",
    label:"World Championship",
    color:"#bef264",
    publicPath:"/championship.html",
    sheetId:"10nVyu3uM_PbK6fDgmomtjlHakNJ1oIM66MRXXHX3k_Q",
  },
  {
    key:"masters",
    label:"World Golf Masters",
    color:"#facc15",
    publicPath:"/masters.html",
    sheetId:"16r1G1StlWQflPjAqFbHip_Y3hRo85F6iS3jYyK25CwE",
  },
  {
    key:"worldcup",
    label:"World Cup",
    color:"#60a5fa",
    publicPath:"/worldcup.html",
    sheetId:"1hmxKPrk4LH7U0kK60N6yghYB898GyTG0Erg3NtsGWXk",
  },
]);

export const ADMIN_SECTIONS = Object.freeze([
  { key:"event-signups", label:"Event Signups", path:"/event-signups.html" },
  { key:"build-list", label:"Build list", path:"/build.html" },
  { key:"championship-points", label:"Championship Points", path:"/championship.html" },
  { key:"custom-player-urls", label:"Custom Player URLs", path:"/admin-settings.html" },
  { key:"action-logs", label:"Action Logs", path:"/admin/action-logs.html" },
]);

const RESULT_EVENT_KEYS = new Set(RESULT_EVENTS.map((event) => event.key));
const ADMIN_SECTION_KEYS = new Set(ADMIN_SECTIONS.map((section) => section.key));

function copyIfPresent(source, target, keys){
  keys.forEach((key) => {
    const value = source.get(key)?.trim();
    if(value) target.set(key, value);
  });
}

export function adminUrl(section, params = {}){
  const search = new URLSearchParams({ section });
  Object.entries(params).forEach(([key, value]) => {
    if(value !== "" && value !== null && value !== undefined) search.set(key, String(value));
  });
  return `/admin/?${search}`;
}

export function tournamentPublicUrl(eventKey, params = new URLSearchParams()){
  const event = RESULT_EVENTS.find((candidate) => candidate.key === eventKey);
  if(!event) return "";

  const publicParams = new URLSearchParams();
  if(eventKey === "masters"){
    const view = params.get("view")?.trim();
    if(["bracket", "qualifiers"].includes(view)) publicParams.set("view", view);
  }else if(eventKey === "proleague"){
    copyIfPresent(params, publicParams, ["season", "stage"]);
  }else if(eventKey === "superleague"){
    copyIfPresent(params, publicParams, ["season"]);
    const view = params.get("view")?.trim() || "";
    const page = view === "promotions"
      ? "promotions"
      : (view === "qualifiers" || view.startsWith("qualifier-")) ? "qualifiers" : "season";
    if(view || publicParams.has("season")) publicParams.set("page", page);
  }else if(eventKey === "worldopen"){
    const round = params.get("view")?.match(/^round-([1-7])$/)?.[1];
    if(round) publicParams.set("round", round);
  }else if(eventKey === "lightningcup"){
    const region = params.get("view")?.trim();
    publicParams.set("view", "results");
    if(["wii-plaza", "wuhu-island", "wedge-island", "spocco-square", "finals"].includes(region)){
      publicParams.set("region", region);
    }
  }else if(eventKey === "worldcup"){
    copyIfPresent(params, publicParams, ["year"]);
    const view = params.get("view")?.trim();
    if(view === "group-stage") publicParams.set("tab", "group");
    if(view === "bracket-stage") publicParams.set("tab", "bracket");
  }
  return `${event.publicPath}${publicParams.size ? `?${publicParams}` : ""}`;
}

export function parseAdminRoute(search = ""){
  const params = new URLSearchParams(search);
  const requestedSection = params.get("section")?.trim() || "";
  const section = requestedSection === "results-editor" || ADMIN_SECTION_KEYS.has(requestedSection)
    ? requestedSection
    : "home";

  if(section === "home"){
    return {
      section,
      eventKey:"",
      groupLabel:"Admin",
      label:"Overview",
      frameUrl:"/admin/landing.html",
      canonicalUrl:"/admin/",
    };
  }

  if(section === "results-editor"){
    const requestedEvent = params.get("eventKey")?.trim() || "";
    const eventKey = RESULT_EVENT_KEYS.has(requestedEvent) ? requestedEvent : RESULT_EVENTS[0].key;
    const event = RESULT_EVENTS.find((candidate) => candidate.key === eventKey);
    const frameParams = new URLSearchParams({ eventKey });
    copyIfPresent(params, frameParams, ["view", "season", "stage", "year"]);
    frameParams.set("embed", "1");
    frameParams.set("v", "20260818-mobile-editor-fixes");
    return {
      section,
      eventKey,
      groupLabel:"Results Editor",
      label:event.label,
      frameUrl:`/admin/tournament-results.html?${frameParams}`,
      canonicalUrl:adminUrl(section, Object.fromEntries([...frameParams].filter(([key]) => !["embed", "v"].includes(key)))),
      publicUrl:tournamentPublicUrl(eventKey, params),
      sheetUrl:`https://docs.google.com/spreadsheets/d/${event.sheetId}/edit`,
    };
  }

  const config = ADMIN_SECTIONS.find((candidate) => candidate.key === section);
  const frameParams = new URLSearchParams();
  if(section === "event-signups") copyIfPresent(params, frameParams, ["event"]);
  if(section === "championship-points") frameParams.set("view", "settings");
  frameParams.set("embed", "1");
  frameParams.set("v", "20260818-mobile-editor-fixes");
  return {
    section,
    eventKey:"",
    groupLabel:"Admin",
    label:config.label,
    frameUrl:`${config.path}?${frameParams}`,
    canonicalUrl:adminUrl(section, section === "event-signups" && params.get("event") ? { event:params.get("event") } : {}),
  };
}

export function routeFromEmbeddedPage(pathname, search = ""){
  const params = new URLSearchParams(search);
  if(pathname === "/admin/landing.html") return "/admin/";
  if(pathname === "/admin/tournament-results.html"){
    const next = {};
    ["eventKey", "view", "season", "stage", "year"].forEach((key) => {
      const value = params.get(key)?.trim();
      if(value) next[key] = value;
    });
    return adminUrl("results-editor", next);
  }
  if(pathname === "/event-signups.html"){
    return adminUrl("event-signups", params.get("event") ? { event:params.get("event") } : {});
  }
  const section = ADMIN_SECTIONS.find((candidate) => candidate.path === pathname)?.key;
  return section ? adminUrl(section) : "";
}
