import config from './config.js';
import { ALLOWED_REGIONS, REGION_TO_ROUTES } from './constants/regions.js';

// Convert region choice to routing values, use defaults if missing
export function resolveRegion(regionMaybe) {
    const fallback = config.defaultRegion;
    const region = (regionMaybe || fallback).toUpperCase();
    const routes = REGION_TO_ROUTES[region];
    if (!routes) throw new Error(`Region routing not configured: ${region}`);
    return { region, ...routes };
}

const RIOT_TFT_API_KEY = config.riotTftApiKey;
const RIOT_LOL_API_KEY = config.riotLolApiKey;

async function riotFetchJson(url, gameType = "TFT") {
    const apiKey = gameType === "TFT" ? RIOT_TFT_API_KEY : RIOT_LOL_API_KEY;
    const res = await fetch(url, { headers: { "X-Riot-Token": apiKey } });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Riot API request failed: ${res.status} on ${url}: ${body}`);
    }
    return res.json();
}

const { regional: DEFAULT_REGIONAL } = resolveRegion();

export async function getAccountByRiotId( {regional = DEFAULT_REGIONAL, gameName, tagLine} ) {
    const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
    )}/${encodeURIComponent(tagLine)}`;
  return riotFetchJson(url, "TFT");
}

export async function getTFTRankByPuuid({ platform, puuid }) {
  const url = `https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`;
  return riotFetchJson(url, "TFT");
}

export async function getTFTMatchIdsByPuuid({ regional, puuid, count = 1, start = 0 }) {
    const safeCount = Math.max(1, Math.min(Number(count) || 1, 20));
    const safeStart = Math.max(0, Number(start) || 0);
    const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${encodeURIComponent(
        puuid
    )}/ids?count=${safeCount}&start=${safeStart}`;

    return riotFetchJson(url, "TFT");
}

export async function getTFTMatch({ regional, matchId}) {
    const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/${encodeURIComponent(
        matchId)}`;
        return riotFetchJson(url, "TFT");
}

// --- Data Dragon (TFT regalia) cache ---
let ddragonVersionCache = null;
let tftRegaliaCache = null;

// "DIAMOND" -> "Diamond"
function toTitleCaseTier(tier) {
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
  const entry = regalia?.data?.[queueType]?.[tierKey];
  const file = entry?.image?.full;
  if (!file) return null;

  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-regalia/${file}`;
}

export async function getTftChampionThumbnail({championId = "Aatrox"}) {
    const version = await getLatestDDragonVersion();
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-champion/TFT16_${championId})_splash_centered_0.TFT_Set16.png`;
}

// function to build leagueofgraphs url for a gamename#tagline
export function getLeagueOfGraphsUrl({ region = "NA", gameName, tagLine }) {
    const shard = String(region || "NA").toLowerCase();
    const encodedName = encodeURIComponent(gameName);
    const encodedTag = encodeURIComponent(tagLine);
    return `https://www.leagueofgraphs.com/tft/summoner/${shard}/${encodedName}-${encodedTag}`;
}

function platformToLoGShard(platformPrefix) {
  return platformPrefix
    .toLowerCase()
    .replace(/\d+$/, ""); // remove trailing digits
}

export function getTFTMatchUrl({ matchId }) {
    // split match id into everything before and after the _
    if (!matchId || !matchId.includes("_")) return null;
    const [platformPrefix, numericId] = matchId.split("_");
    const shard = platformToLoGShard(platformPrefix || "NA");
    return `https://www.leagueofgraphs.com/tft/match/${shard}/${numericId}`;
}