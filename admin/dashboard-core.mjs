export const RESULT_EVENTS = Object.freeze([
  { key:"masters", label:"World Golf Masters" },
  { key:"championship", label:"Championship" },
  { key:"proleague", label:"Pro League" },
  { key:"superleague", label:"Super League" },
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
    copyIfPresent(params, frameParams, ["view", "season", "stage"]);
    frameParams.set("embed", "1");
    return {
      section,
      eventKey,
      groupLabel:"Results Editor",
      label:event.label,
      frameUrl:`/admin/tournament-results.html?${frameParams}`,
      canonicalUrl:adminUrl(section, Object.fromEntries([...frameParams].filter(([key]) => key !== "embed"))),
    };
  }

  const config = ADMIN_SECTIONS.find((candidate) => candidate.key === section);
  const frameParams = new URLSearchParams();
  if(section === "event-signups") copyIfPresent(params, frameParams, ["event"]);
  if(section === "championship-points") frameParams.set("view", "settings");
  frameParams.set("embed", "1");
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
    ["eventKey", "view", "season", "stage"].forEach((key) => {
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
