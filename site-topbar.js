import { createBrowserSupabaseClient } from "/auth/supabase-auth.js";

const supabase = createBrowserSupabaseClient();

function normalizeText(value){
  return String(value || "").trim();
}

function normalizeDiscordId(value){
  return normalizeText(value).replace(/[^\d]/g, "");
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

  const viewPlayer = document.createElement("button");
  viewPlayer.className = "user-menu-item";
  viewPlayer.id = "viewPlayerPageBtn";
  viewPlayer.type = "button";
  viewPlayer.setAttribute("role", "menuitem");
  viewPlayer.textContent = "View player page";

  const accountSettings = document.createElement("button");
  accountSettings.className = "user-menu-item";
  accountSettings.id = "accountSettingsBtn";
  accountSettings.type = "button";
  accountSettings.setAttribute("role", "menuitem");
  accountSettings.disabled = true;
  accountSettings.textContent = "Account settings";

  const divider = document.createElement("div");
  divider.className = "user-menu-divider";
  divider.setAttribute("aria-hidden", "true");

  const logout = document.createElement("button");
  logout.className = "user-menu-item";
  logout.id = "menuLogoutBtn";
  logout.type = "button";
  logout.setAttribute("role", "menuitem");
  logout.textContent = "Log out";

  dropdown.append(viewPlayer, accountSettings, divider, logout);
  menu.append(greeting, button, dropdown);
  topbarInner.appendChild(menu);
  return menu;
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

async function renderTopbarAuth(){
  const menu = ensureTopbarMenu();
  if(!menu) return;

  const { data } = await supabase.auth.getSession();
  const session = data?.session || null;
  if(!session?.user){
    menu.hidden = true;
    menu.classList.remove("is-visible");
    setMenuOpen(menu, false);
    return;
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
  viewPlayer.disabled = !discordId;
  viewPlayer.dataset.playerUrl = discordId ? `/player.html?id=${encodeURIComponent(discordId)}` : "";

  menu.hidden = false;
  menu.classList.add("is-visible");
}

function bindTopbarMenu(){
  const menu = ensureTopbarMenu();
  if(!menu || menu.dataset.bound === "true") return;
  menu.dataset.bound = "true";

  const button = menu.querySelector("#topbarUserMenuBtn");
  const avatar = menu.querySelector("#topbarUserAvatar");
  const dropdown = menu.querySelector("#topbarUserDropdown");
  const logout = menu.querySelector("#menuLogoutBtn");
  const viewPlayer = menu.querySelector("#viewPlayerPageBtn");
  let isOpen = false;

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

  logout.addEventListener("click", async () => {
    await supabase.auth.signOut();
    menu.hidden = true;
    menu.classList.remove("is-visible");
  });
}

bindTopbarMenu();
void renderTopbarAuth();

supabase.auth.onAuthStateChange(() => {
  void renderTopbarAuth();
});
