// === Imports: configuration and routing metadata ===
// We keep Riot API keys and region routing in dedicated modules so this file
// focuses on network requests and URL building.

import config from './config.js';
import { ALLOWED_REGIONS, REGION_TO_ROUTES } from './constants/regions.js';
import { createRiotRateLimiter } from './utils/rateLimiter.js';
import fs from 'node:fs/promises';

// === Region resolution ===
// Convert a user-provided region into the routing values expected by Riot.
// We always fall back to configured defaults to avoid hard failures on missing input.
export function resolveRegion(regionMaybe) {
    const fallback = config.defaultRegion;
    const region = (regionMaybe || fallback).toUpperCase();
    const routes = REGION_TO_ROUTES[region];
    if (!routes) throw new Error(`Region routing not configured: ${region}`);
    return { region, ...routes };
}

// === API keys ===
// We keep TFT and LoL keys separate because Riot issues different keys per product.
const RIOT_TFT_API_KEY = config.riotTftApiKey;
const RIOT_LOL_API_KEY = config.riotLolApiKey;

const sharedRiotLimiter = createRiotRateLimiter();

// === Network helper ===
// Centralizes Riot API requests so we consistently apply headers and error handling.
async function riotFetchJson(url, gameType = "TFT", limiter = sharedRiotLimiter) {
    const apiKey = gameType === "TFT" ? RIOT_TFT_API_KEY : RIOT_LOL_API_KEY;
    
    if (limiter) {
        await limiter.acquire();
    }

    const res = await fetch(url, { headers: { "X-Riot-Token": apiKey } });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Riot API request failed: ${res.status} on ${url}: ${body}`);
    }
    return res.json();
}

// === Defaults derived from config ===
// Precompute default routing values so most calls don't need to specify them.
const { regional: DEFAULT_REGIONAL } = resolveRegion();


// === Riot API wrappers ===
// These helpers expose purpose-specific functions that build URLs and delegate
// to the shared fetch helper above.
export async function getAccountByRiotId( {regional = DEFAULT_REGIONAL, gameName, tagLine, limiter} ) {
    const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
    )}/${encodeURIComponent(tagLine)}`;
  return riotFetchJson(url, "TFT", limiter);
}

export async function getTFTRankByPuuid({ platform, puuid, limiter }) {
  const url = `https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`;
  return riotFetchJson(url, "TFT", limiter);
}

export async function getTFTMatchIdsByPuuid({ regional, puuid, count = 1, start = 0, limiter }) {
    // Protect the API from invalid pagination input by constraining values.
    const safeCount = Math.max(1, Math.min(Number(count) || 1, 20));
    const safeStart = Math.max(0, Number(start) || 0);
    const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${encodeURIComponent(
        puuid
    )}/ids?count=${safeCount}&start=${safeStart}`;

    return riotFetchJson(url, "TFT", limiter);
}

export async function getTFTMatch({ regional, matchId, limiter }) {
    const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/${encodeURIComponent(
        matchId)}`;
        return riotFetchJson(url, "TFT", limiter);
}

// === Data Dragon (TFT regalia) cache ===
// Data Dragon responses change infrequently, so we cache them in-memory to
// reduce network requests and improve response time.
let ddragonVersionCache = null;
let tftRegaliaCache = null;
let tftChampionCache = null;
let tftItemCache = null;
let tftTraitCache = null;
let tftChampionNameById = null;
let tftChampionImageById = null;
let tftItemNameById = null;
let tftItemImageById = null;
let tftTraitNameById = null;

// Normalize a tier string for Data Dragon's title-cased keys.
// Example: "DIAMOND" -> "Diamond"
function toTitleCaseTier(tier) {
    if (!tier) return null;
    const lower = tier.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Fetch and cache the latest Data Dragon version string.
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

// Fetch and cache TFT regalia metadata so we can resolve tier images.
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

async function loadTFTChampions() {
    if (tftChampionCache) return tftChampionCache;
    const version = await getLatestDDragonVersion();
    const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/tft-champion.json`;

    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Data Dragon TFT champion fetch failed: ${res.status}: ${body}`);
    }
    tftChampionCache = await res.json();
    // let's also cache the raw JSON to disk for debugging and future reference
    await fs.writeFile('./tft-champion.json', JSON.stringify(tftChampionCache, null, 2), 'utf-8');
    return tftChampionCache;
}

async function loadTFTItems() {
    if (tftItemCache) return tftItemCache;
    const version = await getLatestDDragonVersion();
    const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/tft-item.json`;

    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Data Dragon TFT item fetch failed: ${res.status}: ${body}`);
    }

    tftItemCache = await res.json();
    // let's also cache the raw JSON to disk for debugging and future reference
    await fs.writeFile('./tft-item.json', JSON.stringify(tftItemCache, null, 2), 'utf-8');
    return tftItemCache;
}

async function loadTFTTraits() {
    if (tftTraitCache) return tftTraitCache;
    const version = await getLatestDDragonVersion();
    const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/tft-trait.json`;

    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Data Dragon TFT trait fetch failed: ${res.status}: ${body}`);
    }

    tftTraitCache = await res.json();
    // let's also cache the raw JSON to disk for debugging and future reference
    await fs.writeFile('./tft-trait.json', JSON.stringify(tftTraitCache, null, 2), 'utf-8');
    return tftTraitCache;
}

async function getChampionNameIndex() {
    if (tftChampionNameById) return tftChampionNameById;
    const championData = await loadTFTChampions();
    const entries = Object.values(championData?.data ?? {});
    const champNameMap = new Map();
    const champImageMap = new Map();
    for (const entry of entries) {
        if (entry?.id) {
            if (entry?.name) {
                champNameMap.set(entry.id, entry.name);
            }
            if (entry?.image?.full) {
                champImageMap.set(entry.id, entry.image.full);
            }
        }
    }
    tftChampionNameById = champNameMap;
    tftChampionImageById = champImageMap;

    return tftChampionNameById;
}

async function getItemNameIndex() {
    if (tftItemNameById) return tftItemNameById;
    const itemData = await loadTFTItems();
    const entries = Object.values(itemData?.data ?? {});
    const itemNameMap = new Map();
    const itemImageMap = new Map();
    for (const entry of entries) {
        if (entry?.id) {
            if (entry?.name) {
                itemNameMap.set(String(entry.id), entry.name);
            }
            if (entry?.image?.full) {
                itemImageMap.set(String(entry.id), entry.image.full);
            }
        }
    }
    tftItemNameById = itemNameMap;
    tftItemImageById = itemImageMap;

    return tftItemNameById;
}

async function getTraitNameIndex() {
    if (tftTraitNameById) return tftTraitNameById;
    const traitData = await loadTFTTraits();
    const entries = Object.values(traitData?.data ?? {});
    const map = new Map();
    for (const entry of entries) {
        if (entry?.trait_id && entry?.name) {
            map.set(entry.trait_id, entry.name);
        }
    }
    tftTraitNameById = map;
    return tftTraitNameById;
}

// Build a regalia thumbnail URL for a given queue type + tier.
// Returns null when the tier does not map to a known asset.
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

export async function getTftChampionNameById(characterId) {
    if (!characterId) return null;
    const map = await getChampionNameIndex();
    return map.get(characterId) ?? null;
}

export async function getTftChampionImageById(characterId) { 
    if (!characterId) return null;
    if (!tftChampionImageById) {
        await getChampionNameIndex(); // loads both name and image maps
    }
    const version = await getLatestDDragonVersion();
    const file = tftChampionImageById?.get(characterId);
    if (!file) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-champion/${file}`;
}

export async function getTftItemNameById(itemId) {
    if (!itemId) return null;
    const map = await getItemNameIndex();
    return map.get(itemId) ?? null;
}

export async function getTftItemImageById(itemId) {
    if (!itemId) return null;
    if (!tftItemImageById) {
        await getItemNameIndex(); // loads both name and image maps
    }
    const version = await getLatestDDragonVersion();
    const file = tftItemImageById?.get(itemId);
    if (!file) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-item/${file}`;
}

export async function getTftTraitNameById(traitId) {
    if (!traitId) return null;
    const map = await getTraitNameIndex();
    return map.get(traitId) ?? null;
}

// Build a champion thumbnail URL from a champion id.
// Defaults to Aatrox so callers always get a valid image.
export async function getTftChampionThumbnail({championId = "TFT16_Aatrox"}) {
    const version = await getLatestDDragonVersion();
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-champion/${championId}_splash_centered_0.TFT_Set16.png`;
}

// === External link helpers ===
// These helpers provide stable URLs to third-party sites for user convenience.

// Build a League of Graphs profile URL for a gameName#tagLine pair.
export function getLeagueOfGraphsUrl({ region = "NA", gameName, tagLine }) {
    const shard = String(region || "NA").toLowerCase();
    const encodedName = encodeURIComponent(gameName);
    const encodedTag = encodeURIComponent(tagLine);
    return `https://www.leagueofgraphs.com/tft/summoner/${shard}/${encodedName}-${encodedTag}`;
}

// Convert a match ID platform prefix into the League of Graphs shard name.
function platformToLoGShard(platformPrefix) {
  return platformPrefix
    .toLowerCase()
    .replace(/\d+$/, ""); // remove trailing digits
}

// Build a League of Graphs match URL from a Riot match id.
export function getTFTMatchUrl({ matchId }) {
    // split match id into everything before and after the _
    if (!matchId || !matchId.includes("_")) return null;
    const [platformPrefix, numericId] = matchId.split("_");
    const shard = platformToLoGShard(platformPrefix || "NA");
    return `https://www.leagueofgraphs.com/tft/match/${shard}/${numericId}`;
}