import 'dotenv/config';

// Discord dropdown choices for region selection
export const REGION_CHOICES = [
  { name: 'NA', value: 'NA' },
  { name: 'EUW', value: 'EUW' },
  { name: 'EUNE', value: 'EUNE' },
  { name: 'KR', value: 'KR' },
  { name: 'BR', value: 'BR' },
  { name: 'LAN', value: 'LAN' },
  { name: 'LAS', value: 'LAS' },
  { name: 'OCE', value: 'OCE' },
  { name: 'JP', value: 'JP' },
  { name: 'RU', value: 'RU' },
  { name: 'TR', value: 'TR' },
  { name: 'VN', value: 'VN' },
  { name: 'SG', value: 'SG' },
  { name: 'PH', value: 'PH' },
  { name: 'TH', value: 'TH' },
  { name: 'TW', value: 'TW' },
];

// Maps user-facing region -> Riot routing values
const REGION_TO_ROUTES = {
  NA:  { platform: 'na1', regional: 'americas' },
  BR:  { platform: 'br1', regional: 'americas' },
  LAN: { platform: 'la1', regional: 'americas' },
  LAS: { platform: 'la2', regional: 'americas' },

  EUW: { platform: 'euw1', regional: 'europe' },
  EUNE:{ platform: 'eun1', regional: 'europe' },
  TR:  { platform: 'tr1', regional: 'europe' },
  RU:  { platform: 'ru', regional: 'europe' },

  KR:  { platform: 'kr', regional: 'asia' },
  JP:  { platform: 'jp1', regional: 'asia' },

  OCE: { platform: 'oc1', regional: 'sea' },
  SG:  { platform: 'sg2', regional: 'sea' },
  PH:  { platform: 'ph2', regional: 'sea' },
  TH:  { platform: 'th2', regional: 'sea' },
  TW:  { platform: 'tw2', regional: 'sea' },
  VN:  { platform: 'vn2', regional: 'sea' },
};

// Convert region choice to routing values, use defaults if missing
export function resolveRegion(regionMaybe) {
  const fallback = (process.env.DEFAULT_REGION || 'NA').toUpperCase();
  const region = (regionMaybe || fallback).toUpperCase();
  const routes = REGION_TO_ROUTES[region];
  if (!routes) throw new Error(`Unknown region: ${region}`);
  return { region, ...routes };
}

function mustGetEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value;
}

const RIOT_API_KEY = mustGetEnv('RIOT_API_KEY');

async function riotFetchJson(url) {
    const res = await fetch(url, {
        headers: {
            'X-Riot-Token': RIOT_API_KEY,
        },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Riot API request failed: ${res.status} on ${url}: ${body}`);
    }

    return res.json();
}

export async function getAccountByRiotId( {regional = defaultRegional, gameName, tagLine} ) {
    const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
    )}/${encodeURIComponent(tagLine)}`;
    
  return riotFetchJson(url);
}

export async function getTFTRankByPuuid({ platform, puuid }) {
  const url = `https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`;
  return riotFetchJson(url);
}

// --- Data Dragon (TFT regalia) cache ---
let ddragonVersionCache = null;
let tftRegaliaCache = null;

function toTitleCaseTier(tier) {
    // "DIAMOND" -> "Diamond"
    if (!tier) return null;
    const lower = tier.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

async function getLatestDDragonVersion() {
    if (ddragonVersionCache) return ddragonVersionCache;

    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Data Dragon versions fetch failed: ${res.status}: ${body}`);
    }

    const versions = await res.json();
    ddragonVersionCache = versions[0]; // latest version
    return ddragonVersionCache;
}

async function loadTFTRegalia() {
    if (tftRegaliaCache) return tftRegaliaCache;

    const version = await getLatestDDragonVersion();
    const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/tft-regalia.json`;

    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Data Dragon TFT regalia fetch failed: ${res.status}: ${body}`);
    }

    tftRegaliaCache = await res.json();
    return tftRegaliaCache;
}

export async function getTftRegaliaThumbnailUrl({ queueType, tier }) {
  const regalia = await loadTFTRegalia();
  const version = await getLatestDDragonVersion();

  const tierKey = toTitleCaseTier(tier);
  if (!tierKey) return null;

  // regalia.json is usually shaped like: regalia.data[queueType][tierKey].image.full
  const data = regalia?.data;
  const byQueue = data?.[queueType];
  const entry = byQueue?.[tierKey];

  const file = entry?.image?.full;
  if (!file) return null;

  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-regalia/${file}`;
}
