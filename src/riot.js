import 'dotenv/config';

const defaultPlatform = (process.env.DEFAULT_PLATFORM || 'na1').toLowerCase();
const defaultRegional = (process.env.DEFAULT_REGIONAL || 'americas').toLowerCase();

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

const PLATFORM_TO_REGIONAL = {
  na1: 'americas',
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',

  euw1: 'europe',
  eun1: 'europe',
  tr1: 'europe',
  ru: 'europe',

  kr: 'asia',
  jp1: 'asia',

  oc1: 'sea',
  sg2: 'sea',
  ph2: 'sea',
  th2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

export function normalizePlatform(platformMaybe) {
    return (platformMaybe || defaultPlatform).toLowerCase();
}

export function platformToRegional(platform) {
    return PLATFORM_TO_REGIONAL[platform] || defaultRegional;
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
