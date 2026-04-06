import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const DEFAULT_SUPABASE_URL = "https://kwaprkwemtxizorpnrzq.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gJ6-wdgZYpDBF1YxxNrlLg_BrtYUeL_";

export const AUTH_CALLBACK_PATH = "/auth/callback";
export const DEFAULT_POST_AUTH_PATH = "/lightningcup/index.html";

// Static pages can optionally override these at runtime via:
// window.NSSGOLF_SUPABASE_CONFIG = { url: "...", publishableKey: "..." }
const runtimeConfig = globalThis.NSSGOLF_SUPABASE_CONFIG || {};
const SUPABASE_URL = asTrimmedString(runtimeConfig.url) || DEFAULT_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = asTrimmedString(runtimeConfig.publishableKey) || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

if(!SUPABASE_URL){
  throw new Error("Missing Supabase URL.");
}

if(!SUPABASE_PUBLISHABLE_KEY || /service[_-]?role/i.test(SUPABASE_PUBLISHABLE_KEY)){
  throw new Error("Supabase browser auth requires a publishable key, not a service-role key.");
}

function asTrimmedString(value){
  return typeof value === "string" ? value.trim() : "";
}

function getSiteOrigin(){
  const origin = asTrimmedString(globalThis.location?.origin);
  if(origin && origin !== "null") return origin;
  return "https://nssgolf.com";
}

function normalizeFallbackPath(fallbackPath){
  const fallback = asTrimmedString(fallbackPath);
  if(!fallback) return DEFAULT_POST_AUTH_PATH;

  try{
    const parsed = new URL(fallback, getSiteOrigin());
    if(parsed.origin !== getSiteOrigin()) return DEFAULT_POST_AUTH_PATH;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }catch{
    return DEFAULT_POST_AUTH_PATH;
  }
}

export function sanitizeInternalRedirect(nextValue, fallbackPath = DEFAULT_POST_AUTH_PATH){
  const fallback = normalizeFallbackPath(fallbackPath);
  const raw = asTrimmedString(nextValue);
  if(!raw) return fallback;

  try{
    const parsed = new URL(raw, getSiteOrigin());
    if(parsed.origin !== getSiteOrigin()) return fallback;
    const nextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if(!nextPath.startsWith("/")) return fallback;
    if(nextPath === AUTH_CALLBACK_PATH || nextPath.startsWith(`${AUTH_CALLBACK_PATH}/`)) return fallback;
    return nextPath;
  }catch{
    return fallback;
  }
}

export function getAuthCallbackUrl(){
  return new URL(AUTH_CALLBACK_PATH, getSiteOrigin()).toString();
}

export function buildAuthRedirectTo(nextValue = DEFAULT_POST_AUTH_PATH){
  const callbackUrl = new URL(getAuthCallbackUrl());
  callbackUrl.searchParams.set("next", sanitizeInternalRedirect(nextValue));
  return callbackUrl.toString();
}

export function getNextPathFromCurrentLocation(fallbackPath = DEFAULT_POST_AUTH_PATH){
  const url = new URL(globalThis.location?.href || getSiteOrigin());
  return sanitizeInternalRedirect(url.searchParams.get("next"), fallbackPath);
}

export function createBrowserSupabaseClient({ detectSessionInUrl = false } = {}){
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl,
      debug: false,
    },
  });
}
