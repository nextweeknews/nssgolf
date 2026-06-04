import { createBrowserSupabaseClient } from "/auth/supabase-auth.js";

const RECORD_GROUPS = [
  {
    title: "18-hole",
    roleIds: [
      "1466897504334516257",
      "1279498515776540796",
      "1279498415444856864",
      "1279498113886982225",
      "1279497781454569563",
      "1279497671815725137",
      "1279496346960789597",
    ],
  },
  {
    title: "9-hole",
    roleIds: [
      "1279496097328398438",
      "1279495906089111573",
      "1279495694578614455",
      "1279495547727909005",
    ],
  },
  {
    title: "Global",
    roleIds: [
      "1247012004028354620",
      "1095534496570425354",
      "1077315124613890139",
      "1279487297246462064",
    ],
  },
];

const TRACKED_ROLE_IDS = RECORD_GROUPS.flatMap(group => group.roleIds);
const supabase = createBrowserSupabaseClient();
const rootEl = document.getElementById("player-root");
const statusEl = document.getElementById("player-status");

function cleanRoleName(name){
  const clean = String(name || "")
    .replace(/^[^A-Za-z0-9\-−–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "Record title unavailable";
}

function getDiscordIdFromLocation(){
  const pathSegment = String(window.location.pathname || "")
    .split("/")
    .filter(Boolean)[0] || "";
  if(/^\d+$/.test(pathSegment)) return pathSegment;

  const queryId = new URLSearchParams(window.location.search).get("id") || "";
  if(/^\d+$/.test(queryId)) return queryId;

  return "";
}

function avatarUrlFor(member){
  return member?.server_avatar_url || member?.avatar_url || "/logos/golf.png";
}

function displayNameFor(member){
  return member?.display_name || member?.username || member?.discord_user_id || "Player";
}

function formatLongDate(value){
  if(!value) return "";
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function setStatus(message){
  if(!statusEl) return;
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
}

function renderNotFound(){
  document.title = "Page Not Found | NSS Golf";
  rootEl.innerHTML = "";

  const card = document.createElement("section");
  card.className = "profile-card";

  const title = document.createElement("h1");
  title.className = "headline";
  title.textContent = "Page Not Found";

  const copy = document.createElement("p");
  copy.className = "profile-muted";
  copy.textContent = "That page could not be found.";

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const home = document.createElement("a");
  home.className = "btn";
  home.href = "/index.html";
  home.textContent = "Home";

  const records = document.createElement("a");
  records.className = "btn";
  records.href = "/records.html";
  records.textContent = "Records";

  actions.append(home, records);
  card.append(title, copy, actions);
  rootEl.appendChild(card);
  setStatus("");
}

function renderProfile(member, trackedRoles){
  document.title = `${displayNameFor(member)} | NSS Golf`;
  rootEl.innerHTML = "";

  const card = document.createElement("section");
  card.className = "profile-card";
  card.setAttribute("aria-labelledby", "player-name");

  const header = document.createElement("div");
  header.className = "profile-header";

  const avatar = document.createElement("img");
  avatar.className = "profile-avatar";
  avatar.src = avatarUrlFor(member);
  avatar.alt = "";
  avatar.decoding = "async";
  avatar.referrerPolicy = "no-referrer";

  const headingWrap = document.createElement("div");
  headingWrap.className = "profile-heading";

  const name = document.createElement("h1");
  name.className = "headline";
  name.id = "player-name";
  name.textContent = displayNameFor(member);

  const sinceDate = formatLongDate(member.joined_at);
  const memberSince = document.createElement("p");
  memberSince.className = "profile-muted";
  memberSince.textContent = sinceDate ? `Member since ${sinceDate}` : "Member since unavailable";

  headingWrap.append(name, memberSince);
  header.append(avatar, headingWrap);

  const details = document.createElement("dl");
  details.className = "profile-details";

  const idTerm = document.createElement("dt");
  idTerm.textContent = "Discord ID";
  const idValue = document.createElement("dd");
  idValue.textContent = member.discord_user_id;
  details.append(idTerm, idValue);

  const recordsSection = document.createElement("section");
  recordsSection.className = "profile-section";

  const recordsTitle = document.createElement("h2");
  recordsTitle.className = "profile-section-title";
  recordsTitle.textContent = "Tracked Record Roles";
  recordsSection.appendChild(recordsTitle);

  if(!trackedRoles.length){
    const empty = document.createElement("p");
    empty.className = "profile-muted";
    empty.textContent = "No tracked records.";
    recordsSection.appendChild(empty);
  }else{
    const list = document.createElement("ul");
    list.className = "profile-record-list";

    for(const role of trackedRoles){
      const item = document.createElement("li");
      item.className = "profile-record-item";

      const roleName = document.createElement("span");
      roleName.className = "profile-record-name";
      roleName.textContent = role.name;

      const groupName = document.createElement("span");
      groupName.className = "profile-record-group";
      groupName.textContent = role.groupTitle;

      item.append(roleName, groupName);
      list.appendChild(item);
    }

    recordsSection.appendChild(list);
  }

  card.append(header, details, recordsSection);
  rootEl.appendChild(card);
  setStatus("");
}

async function loadPlayerProfile(){
  const discordId = getDiscordIdFromLocation();
  if(!discordId){
    renderNotFound();
    return;
  }

  setStatus("Loading player...");

  const [membersRes, linksRes] = await Promise.all([
    supabase
      .from("discord_guild_members")
      .select("discord_user_id,username,display_name,avatar_url,server_avatar_url,joined_at,is_current_member")
      .eq("discord_user_id", discordId)
      .eq("is_current_member", true)
      .limit(1),
    supabase
      .from("discord_member_roles")
      .select("role_id,discord_user_id")
      .eq("discord_user_id", discordId)
      .in("role_id", TRACKED_ROLE_IDS),
  ]);

  if(membersRes.error) throw membersRes.error;
  if(linksRes.error) throw linksRes.error;

  const member = (membersRes.data || [])[0];
  if(!member){
    renderNotFound();
    return;
  }

  const heldRoleIds = new Set((linksRes.data || []).map(row => row.role_id).filter(Boolean));
  let rolesById = new Map();

  if(heldRoleIds.size){
    const rolesRes = await supabase
      .from("discord_roles")
      .select("role_id,name")
      .in("role_id", [...heldRoleIds]);

    if(rolesRes.error) throw rolesRes.error;
    rolesById = new Map((rolesRes.data || []).map(role => [role.role_id, role]));
  }

  const trackedRoles = [];
  for(const group of RECORD_GROUPS){
    for(const roleId of group.roleIds){
      if(!heldRoleIds.has(roleId)) continue;
      const role = rolesById.get(roleId);
      trackedRoles.push({
        groupTitle: group.title,
        roleId,
        name: cleanRoleName(role?.name),
      });
    }
  }

  renderProfile(member, trackedRoles);
}

loadPlayerProfile().catch(error => {
  console.error(error);
  setStatus(`Unable to load player: ${error?.message || "Unknown error"}`);
});
