import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js";
import { ADMIN_ROLE_ID, playerUrlPathForSlug } from "/settings-data.js";

const supabase = createBrowserSupabaseClient();
const LOGOUT_HOME_PATH = "/lightningcup/index.html";
const PRIVATE_AFTER_LOGOUT_PATHS = new Set([
  "/admin-settings.html",
  "/build.html",
  "/player-settings.html",
]);

function normalizeText(value){
  return String(value || "").trim();
}

function normalizeDiscordId(value){
  return normalizeText(value).replace(/[^\d]/g, "");
}

function getCurrentInternalPath(){
  const location = globalThis.location;
  return `${location?.pathname || "/"}${location?.search || ""}${location?.hash || ""}`;
}

function shouldReturnHomeAfterLogout(){
  return PRIVATE_AFTER_LOGOUT_PATHS.has(globalThis.location?.pathname || "");
}

function returnHomeAfterLogout(){
  globalThis.location.href = LOGOUT_HOME_PATH;
}

function getMetadataName(user){
  const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  return normalizeText(
    metadata.full_name ||
    metadata.name ||
    metadata.global_name ||
    metadata.preferred_username ||
    metadata.user_name ||
    metadata.username
  );
}

function getDiscordIdentity(user){
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.find((identity) => normalizeText(identity?.provider).toLowerCase() === "discord") || null;
}

function getDiscordIdFromUser(user){
  const identity = getDiscordIdentity(user);
  return normalizeDiscordId(
    identity?.provider_id ||
    identity?.identity_data?.provider_id ||
    identity?.identity_data?.sub ||
    identity?.identity_data?.id ||
    user?.user_metadata?.provider_id ||
    user?.user_metadata?.sub
  );
}

function getAvatarUrlFromUser(user){
  const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const identity = getDiscordIdentity(user);
  const identityData = identity?.identity_data && typeof identity.identity_data === "object" ? identity.identity_data : {};
  return normalizeText(
    metadata.avatar_url ||
    metadata.picture ||
    metadata.image_url ||
    identityData.avatar_url ||
    identityData.picture ||
    identityData.image_url
  );
}

function createFallbackIcon(){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M12 12.5c2.66 0 4.75-2.09 4.75-4.75S14.66 3 12 3 7.25 5.09 7.25 7.75 9.34 12.5 12 12.5zm0 2c-4.06 0-7.75 2.06-7.75 4.75V21h15.5v-1.75c0-2.69-3.69-4.75-7.75-4.75z");
  svg.appendChild(path);
  return svg;
}

function createMenuIcon(pathData){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "user-menu-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  pathData.forEach((data) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.appendChild(path);
  });

  return svg;
}

function createMenuButton({ id, text, icon, className = "" }){
  const button = document.createElement("button");
  button.className = `user-menu-item ${className}`.trim();
  button.id = id;
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.append(createMenuIcon(icon), document.createTextNode(text));
  return button;
}

function ensureTopbarMenu(){
  const topbarInner = document.querySelector(".topbar-inner");
  if(!topbarInner) return null;

  const existing = document.getElementById("topbarUserMenu");
  if(existing) return existing;

  const menu = document.createElement("div");
  menu.className = "topbar-user";
  menu.id = "topbarUserMenu";
  menu.hidden = true;

  const greeting = document.createElement("span");
  greeting.className = "user-greeting";
  greeting.id = "topbarUserGreeting";

  const button = document.createElement("button");
  button.className = "user-menu-button";
  button.id = "topbarUserMenuBtn";
  button.type = "button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Account menu");

  const avatar = document.createElement("img");
  avatar.className = "user-menu-avatar";
  avatar.id = "topbarUserAvatar";
  avatar.alt = "";
  avatar.loading = "lazy";
  avatar.decoding = "async";
  avatar.referrerPolicy = "no-referrer";
  avatar.hidden = true;

  button.append(avatar, createFallbackIcon());

  const dropdown = document.createElement("div");
  dropdown.className = "user-menu-dropdown";
  dropdown.id = "topbarUserDropdown";
  dropdown.setAttribute("role", "menu");
  dropdown.setAttribute("aria-labelledby", "topbarUserMenuBtn");

  const viewPlayer = createMenuButton({
    id: "viewPlayerPageBtn",
    text: "View player page",
    icon: [
      "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
      "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    ],
  });

  const playerSettings = createMenuButton({
    id: "playerSettingsBtn",
    text: "Player settings",
    icon: [
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z",
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    ],
  });

  const adminSettings = createMenuButton({
    id: "adminSettingsBtn",
    text: "Admin actions",
    icon: [
      "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.81 17 5 19 5a1 1 0 0 1 1 1v7Z",
      "m9 12 2 2 4-4",
    ],
  });
  adminSettings.hidden = true;

  const divider = document.createElement("div");
  divider.className = "user-menu-divider";
  divider.setAttribute("aria-hidden", "true");

  const logout = createMenuButton({
    id: "menuLogoutBtn",
    text: "Log out",
    className: "danger",
    icon: [
      "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
      "M16 17l5-5-5-5",
      "M21 12H9",
    ],
  });

  dropdown.append(viewPlayer, playerSettings, adminSettings, divider, logout);
  menu.append(greeting, button, dropdown);
  topbarInner.appendChild(menu);
  return menu;
}

function ensureTopbarSignInButton(){
  const topbarInner = document.querySelector(".topbar-inner");
  if(!topbarInner) return null;

  const existing = document.getElementById("topbarDiscordLoginBtn");
  if(existing) return existing;

  const button = document.createElement("button");
  button.className = "topbar-auth-button";
  button.id = "topbarDiscordLoginBtn";
  button.type = "button";

  const icon = document.createElement("img");
  icon.className = "topbar-auth-icon";
  icon.src = "/logos/discord.svg";
  icon.alt = "";
  icon.loading = "lazy";
  icon.decoding = "async";

  const label = document.createElement("span");
  label.textContent = "Sign in";

  button.append(icon, label);
  topbarInner.appendChild(button);
  return button;
}

function setMenuOpen(menu, open){
  const button = menu.querySelector("#topbarUserMenuBtn");
  const dropdown = menu.querySelector("#topbarUserDropdown");
  dropdown?.classList.toggle("is-open", open);
  button?.setAttribute("aria-expanded", open ? "true" : "false");
}

async function getProfileForUser(user){
  if(!user?.id) return null;

  try{
    const { data, error } = await supabase
      .from("profiles")
      .select("username,discord_user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if(error) return null;
    return data || null;
  }catch{
    return null;
  }
}

async function playerHasAdminRole(discordId){
  const cleanDiscordId = normalizeDiscordId(discordId);
  if(!cleanDiscordId) return false;

  try{
    const { data, error } = await supabase
      .from("discord_member_roles")
      .select("role_id")
      .eq("discord_user_id", cleanDiscordId)
      .eq("role_id", ADMIN_ROLE_ID)
      .maybeSingle();
    if(error) return false;
    return !!data;
  }catch{
    return false;
  }
}

async function getApprovedPlayerUrl(discordId){
  const cleanDiscordId = normalizeDiscordId(discordId);
  if(!cleanDiscordId) return "";

  try{
    const { data, error } = await supabase
      .from("player_custom_urls")
      .select("slug")
      .eq("discord_user_id", cleanDiscordId)
      .eq("status", "approved")
      .maybeSingle();
    if(error) return "";
    return playerUrlPathForSlug(data?.slug);
  }catch{
    return "";
  }
}

async function renderTopbarAuth(){
  const menu = ensureTopbarMenu();
  const signInButton = ensureTopbarSignInButton();
  if(!menu) return;

  const { data } = await supabase.auth.getSession();
  const session = data?.session || null;
  if(!session?.user){
    menu.hidden = true;
    menu.classList.remove("is-visible");
    setMenuOpen(menu, false);
    if(signInButton){
      signInButton.hidden = false;
      signInButton.classList.add("is-visible");
    }
    return;
  }

  if(signInButton){
    signInButton.hidden = true;
    signInButton.classList.remove("is-visible");
  }

  let user = session.user;
  try{
    const { data: userData, error } = await supabase.auth.getUser();
    if(!error && userData?.user?.id === session.user.id){
      user = userData.user;
    }
  }catch{
    // Keep the menu usable with the session user if enrichment fails.
  }

  const profile = await getProfileForUser(user);
  const discordId = normalizeDiscordId(profile?.discord_user_id) || getDiscordIdFromUser(user);
  const displayName = normalizeText(profile?.username) || getMetadataName(user) || "Player";
  const avatarUrl = getAvatarUrlFromUser(user);

  const greeting = menu.querySelector("#topbarUserGreeting");
  greeting.replaceChildren(
    document.createTextNode("Hi, "),
    Object.assign(document.createElement("span"), { className: "user-greeting-name", textContent: displayName })
  );

  const avatar = menu.querySelector("#topbarUserAvatar");
  const button = menu.querySelector("#topbarUserMenuBtn");
  if(avatarUrl){
    avatar.src = avatarUrl;
    avatar.hidden = false;
    button.classList.add("has-avatar");
  }else{
    avatar.hidden = true;
    avatar.removeAttribute("src");
    button.classList.remove("has-avatar");
  }

  const viewPlayer = menu.querySelector("#viewPlayerPageBtn");
  const approvedPlayerUrl = await getApprovedPlayerUrl(discordId);
  viewPlayer.disabled = !discordId;
  viewPlayer.dataset.playerUrl = approvedPlayerUrl || (discordId ? `/player.html?id=${encodeURIComponent(discordId)}` : "");

  const playerSettings = menu.querySelector("#playerSettingsBtn");
  playerSettings.disabled = !discordId;
  playerSettings.dataset.settingsUrl = "/player-settings.html";

  const adminSettings = menu.querySelector("#adminSettingsBtn");
  const isAdmin = await playerHasAdminRole(discordId);
  adminSettings.hidden = !isAdmin;
  adminSettings.dataset.settingsUrl = "/admin-settings.html";

  menu.hidden = false;
  menu.classList.add("is-visible");
}

function bindTopbarMenu(){
  const menu = ensureTopbarMenu();
  const signInButton = ensureTopbarSignInButton();
  if(!menu || menu.dataset.bound === "true") return;
  menu.dataset.bound = "true";

  const button = menu.querySelector("#topbarUserMenuBtn");
  const avatar = menu.querySelector("#topbarUserAvatar");
  const dropdown = menu.querySelector("#topbarUserDropdown");
  const logout = menu.querySelector("#menuLogoutBtn");
  const viewPlayer = menu.querySelector("#viewPlayerPageBtn");
  const playerSettings = menu.querySelector("#playerSettingsBtn");
  const adminSettings = menu.querySelector("#adminSettingsBtn");
  let isOpen = false;
  let signInPending = false;

  avatar.addEventListener("error", () => {
    avatar.hidden = true;
    avatar.removeAttribute("src");
    button.classList.remove("has-avatar");
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    isOpen = !isOpen;
    setMenuOpen(menu, isOpen);
  });

  document.addEventListener("click", (event) => {
    if(!isOpen) return;
    if(menu.contains(event.target)) return;
    isOpen = false;
    setMenuOpen(menu, false);
  });

  dropdown.addEventListener("click", (event) => {
    const clicked = event.target.closest("button");
    if(!clicked) return;
    if(clicked.disabled){
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    isOpen = false;
    setMenuOpen(menu, false);
  });

  viewPlayer.addEventListener("click", () => {
    const playerUrl = normalizeText(viewPlayer.dataset.playerUrl);
    if(playerUrl) window.location.href = playerUrl;
  });

  playerSettings.addEventListener("click", () => {
    const settingsUrl = normalizeText(playerSettings.dataset.settingsUrl);
    if(settingsUrl) window.location.href = settingsUrl;
  });

  adminSettings.addEventListener("click", () => {
    const settingsUrl = normalizeText(adminSettings.dataset.settingsUrl);
    if(settingsUrl) window.location.href = settingsUrl;
  });

  signInButton?.addEventListener("click", async () => {
    if(signInPending) return;
    signInPending = true;
    signInButton.disabled = true;
    try{
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: { redirectTo: buildAuthRedirectTo(getCurrentInternalPath()) },
      });
      if(error) throw error;
    }catch{
      signInPending = false;
      signInButton.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    await supabase.auth.signOut();
    menu.hidden = true;
    menu.classList.remove("is-visible");
    if(shouldReturnHomeAfterLogout()){
      returnHomeAfterLogout();
    }else{
      void renderTopbarAuth();
    }
  });
}

bindTopbarMenu();
void renderTopbarAuth();

supabase.auth.onAuthStateChange((eventName) => {
  if(eventName === "SIGNED_OUT" && shouldReturnHomeAfterLogout()){
    returnHomeAfterLogout();
    return;
  }
  void renderTopbarAuth();
});
