import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js?v=20260817-singleton";
import { getTournamentAdminFlag } from "/admin/tournament-results-core.mjs?v=20260817-all-years";
import { ADMIN_SECTIONS, RESULT_EVENTS, adminUrl, parseAdminRoute, routeFromEmbeddedPage } from "/admin/dashboard-core.mjs?v=20260817-compact-change-values";

const supabase = createBrowserSupabaseClient();
const loading = document.getElementById("adminLoading");
const denied = document.getElementById("adminDenied");
const shell = document.getElementById("adminShell");
const loginButton = document.getElementById("adminLoginBtn");
const accessCopy = document.getElementById("adminAccessCopy");
const frame = document.getElementById("adminFrame");
const frameLoading = document.getElementById("adminFrameLoading");
const breadcrumbGroup = document.getElementById("adminBreadcrumbGroup");
const breadcrumbPage = document.getElementById("adminBreadcrumbPage");
const headerActions = document.getElementById("adminHeaderActions");
const publicPageLink = document.getElementById("adminPublicPageLink");
const googleSheetLink = document.getElementById("adminGoogleSheetLink");
const resultsParent = document.getElementById("resultsEditorToggle");
const resultsChildren = document.getElementById("resultsEditorChildren");

function icon(paths){
  return `<svg class="admin-nav-icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}

const sectionIcons = {
  "event-signups":icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  "build-list":icon('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  "championship-points":icon('<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>'),
  "custom-player-urls":icon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  "action-logs":icon('<path d="M3 5h18M3 12h18M3 19h18"/><path d="M7 3v4M17 10v4M11 17v4"/>'),
};

function renderNavigation(route){
  resultsChildren.replaceChildren(...RESULT_EVENTS.map((event) => {
    const link = document.createElement("a");
    link.className = "admin-nav-item";
    link.href = adminUrl("results-editor", { eventKey:event.key });
    link.textContent = event.label;
    link.style.setProperty("--event-color", event.color);
    if(route.section === "results-editor" && route.eventKey === event.key) link.setAttribute("aria-current", "page");
    return link;
  }));

  const sectionMount = document.getElementById("adminSectionLinks");
  sectionMount.replaceChildren(...ADMIN_SECTIONS.map((section) => {
    const link = document.createElement("a");
    link.className = "admin-nav-item";
    link.href = adminUrl(section.key);
    link.innerHTML = `${sectionIcons[section.key]}<span>${section.label}</span>`;
    if(route.section === section.key) link.setAttribute("aria-current", "page");
    return link;
  }));

  const resultsActive = route.section === "results-editor";
  resultsParent.setAttribute("aria-expanded", resultsActive ? "true" : "false");
  resultsChildren.hidden = !resultsActive;
}

function applyRoute({ historyMode = "replace", reloadFrame = true } = {}){
  const route = parseAdminRoute(globalThis.location.search);
  if(`${globalThis.location.pathname}${globalThis.location.search}` !== route.canonicalUrl){
    globalThis.history[`${historyMode}State`](null, "", route.canonicalUrl);
  }
  renderNavigation(route);
  breadcrumbGroup.textContent = route.groupLabel;
  breadcrumbPage.textContent = route.label;
  headerActions.hidden = route.section !== "results-editor";
  if(route.section === "results-editor"){
    publicPageLink.href = route.publicUrl;
    googleSheetLink.href = route.sheetUrl;
  }
  document.title = `${route.label} | NSS Golf Admin`;
  frame.title = route.label;
  if(reloadFrame && frame.getAttribute("src") !== route.frameUrl){
    frameLoading.hidden = false;
    frame.src = route.frameUrl;
  }
}

function closeSidebar(){
  document.body.classList.remove("sidebar-open");
}

resultsParent.addEventListener("click", () => {
  const expanded = resultsParent.getAttribute("aria-expanded") === "true";
  resultsParent.setAttribute("aria-expanded", expanded ? "false" : "true");
  resultsChildren.hidden = expanded;
});

document.getElementById("adminSidebarTrigger").addEventListener("click", () => {
  if(matchMedia("(max-width: 840px)").matches){
    document.body.classList.toggle("sidebar-open");
  }else{
    document.body.classList.toggle("sidebar-collapsed");
  }
});
document.getElementById("adminScrim").addEventListener("click", closeSidebar);
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if(!link) return;
  if(link.closest(".admin-sidebar")) closeSidebar();
  if(
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
    || link.target === "_blank"
    || link.origin !== globalThis.location.origin
    || link.pathname !== "/admin/"
  ) return;
  event.preventDefault();
  const nextUrl = `${link.pathname}${link.search}${link.hash}`;
  if(nextUrl === `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`) return;
  globalThis.history.pushState(null, "", nextUrl);
  applyRoute();
});
document.addEventListener("keydown", (event) => {
  if(event.key === "Escape") closeSidebar();
});
frame.addEventListener("load", () => {
  frameLoading.hidden = true;
});
globalThis.addEventListener("popstate", () => applyRoute());
globalThis.addEventListener("message", (event) => {
  if(event.origin !== globalThis.location.origin || event.source !== frame.contentWindow) return;
  if(event.data?.type === "nssgolf-admin-size") return;
  if(event.data?.type !== "nssgolf-admin-route") return;
  const nextUrl = routeFromEmbeddedPage(event.data.pathname, event.data.search);
  if(nextUrl && nextUrl !== `${globalThis.location.pathname}${globalThis.location.search}`){
    globalThis.history.replaceState(null, "", nextUrl);
    applyRoute({ reloadFrame:false });
  }
});

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  accessCopy.textContent = "Opening Discord login…";
  const { error } = await supabase.auth.signInWithOAuth({
    provider:"discord",
    options:{ redirectTo:buildAuthRedirectTo(globalThis.location.href) },
  });
  if(error){
    loginButton.disabled = false;
    accessCopy.textContent = error.message || "Unable to start Discord login.";
  }
});

async function initialize(){
  const { data:sessionData, error:sessionError } = await supabase.auth.getSession();
  if(sessionError) throw sessionError;
  if(!sessionData?.session?.user){
    loading.hidden = true;
    denied.hidden = false;
    loginButton.hidden = false;
    accessCopy.textContent = "Sign in with Discord to access the admin dashboard.";
    return;
  }

  const { error:userError } = await supabase.auth.getUser();
  if(userError) throw userError;
  const isAdmin = await getTournamentAdminFlag(supabase);
  loading.hidden = true;
  if(!isAdmin){
    denied.hidden = false;
    accessCopy.textContent = "Your Discord account does not have administrator access.";
    return;
  }

  shell.hidden = false;
  applyRoute();
}

initialize().catch((error) => {
  console.error(error);
  loading.hidden = true;
  denied.hidden = false;
  accessCopy.textContent = error?.message || "Unable to load the admin dashboard.";
});
