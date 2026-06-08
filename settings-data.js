export const ADMIN_ROLE_ID = "1069007873985740890";

export const GLOBAL_RANKS = [
  "<A20", "A21", "A22", "A23", "A24", "A25", "A26", "A27", "A28", "A29",
  "S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9",
  "∞0", "∞1", "∞2", "∞3", "∞4", "∞5", "∞6", "∞7", "∞8", "∞9", "∞10",
];

export const COUNTRY_CODES = [
  "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR",
  "IO", "BN", "BG", "BF", "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC",
  "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO",
  "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF",
  "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY",
  "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM",
  "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY",
  "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
  "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI",
  "NE", "NG", "NU", "NF", "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH",
  "PN", "PL", "PT", "PR", "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC",
  "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS",
  "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK",
  "TO", "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU",
  "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW",
];

export function countryNameFor(code){
  const cleanCode = String(code || "").trim().toUpperCase();
  if(!cleanCode) return "";
  try{
    return new Intl.DisplayNames(["en"], { type: "region" }).of(cleanCode) || cleanCode;
  }catch{
    return cleanCode;
  }
}

export function flagForCountry(code){
  const cleanCode = String(code || "").trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(cleanCode)) return "";
  return cleanCode
    .split("")
    .map((letter) => String.fromCodePoint(0x1F1E6 + letter.charCodeAt(0) - 65))
    .join("");
}

export function countryLabelFor(code){
  const cleanCode = String(code || "").trim().toUpperCase();
  if(!cleanCode) return "";
  const flag = flagForCountry(cleanCode);
  const name = countryNameFor(cleanCode);
  return `${flag ? `${flag} ` : ""}${name}`;
}

export function buildCountryOptions(){
  return COUNTRY_CODES
    .map((code) => ({ code, label: countryLabelFor(code), name: countryNameFor(code) }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

export function getSupportedTimeZones(){
  if(Intl.supportedValuesOf){
    try{
      return Intl.supportedValuesOf("timeZone");
    }catch{}
  }
  return [
    "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
    "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo",
    "Australia/Sydney", "Pacific/Auckland",
  ];
}

export function timeZoneOffsetLabel(timeZone, date = new Date()){
  try{
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    }).formatToParts(date);
    const value = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
    return value.replace("GMT", "UTC");
  }catch{
    return "UTC";
  }
}

export function helperCityForTimeZone(timeZone){
  const city = String(timeZone || "").split("/").pop() || "";
  return city.replace(/_/g, " ");
}

export function timeZoneLabelFor(timeZone){
  const cleanTimeZone = String(timeZone || "").trim();
  if(!cleanTimeZone) return "";
  return `${timeZoneOffsetLabel(cleanTimeZone)} - ${helperCityForTimeZone(cleanTimeZone)}`;
}

export function buildTimeZoneOptions(){
  return getSupportedTimeZones().map((timeZone) => ({
    timeZone,
    label: timeZoneLabelFor(timeZone),
  }));
}
