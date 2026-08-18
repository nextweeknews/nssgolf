import { DEFAULT_SEASON_CONFIGURATION, normalizeSeasonConfiguration } from "./season-configuration-core.mjs";

const DEFAULT_SUPABASE_URL = "https://kwaprkwemtxizorpnrzq.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gJ6-wdgZYpDBF1YxxNrlLg_BrtYUeL_";
const CONFIG_PROMISE_KEY = Symbol.for("nssgolf.seasonConfiguration");
const runtimeConfig = globalThis.NSSGOLF_SUPABASE_CONFIG || {};
const SUPABASE_URL = (String(runtimeConfig.url || "").trim() || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
const SUPABASE_PUBLISHABLE_KEY = String(runtimeConfig.publishableKey || "").trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

if(/service[_-]?role/i.test(SUPABASE_PUBLISHABLE_KEY)){
  throw new Error("Season configuration requires a publishable key, not a service-role key.");
}

async function loadSeasonConfiguration(){
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 2500);
  try{
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/season_configuration?id=eq.current&select=ranked_league_season,shotgun_pro_league_season,shotgun_pro_league_stage,super_league_season`,
      {
        headers:{ apikey:SUPABASE_PUBLISHABLE_KEY },
        cache:"no-store",
        signal:controller.signal,
      },
    );
    if(!response.ok) throw new Error(`Season configuration request failed (${response.status}).`);
    const [row] = await response.json();
    return normalizeSeasonConfiguration(row);
  }catch(error){
    console.warn("Unable to load season configuration; using bundled defaults.", error);
    return DEFAULT_SEASON_CONFIGURATION;
  }finally{
    globalThis.clearTimeout(timeout);
  }
}

const configuration = await (globalThis[CONFIG_PROMISE_KEY] ||= loadSeasonConfiguration());

export const CURRENT_RANKED_LEAGUE_SEASON = `Season_${configuration.rankedLeagueSeason}`;
export const TEAMUP_API_BASE_URL = "https://api.teamupgg.com";
export const RANKED_LEAGUE_TEAMUP_CLIENT_ID = "DISCORD|1069003073311211601";
export const RANKED_LEAGUE_TEAMUP_URL = "https://teamupgg.com/leaderboard/DISCORD%7C1069003073311211601";

export const SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON = configuration.shotgunProLeagueSeason;
export const SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE = configuration.shotgunProLeagueStage;
export const SHOTGUN_PRO_LEAGUE_MAX_SEASON_TO_CHECK = configuration.shotgunProLeagueSeason;

export const SUPER_LEAGUE_SEASON = `Season ${configuration.superLeagueSeason}`;
