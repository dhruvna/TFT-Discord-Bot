import config from '../config.js';
import { REGION_TO_ROUTES } from '../constants/regions.js';
import { createRiotRateLimiter } from '../utils/rateLimiter.js';

export function resolveRegion(regionMaybe) {
    const fallback = config.defaultRegion;
    const region = (regionMaybe || fallback).toUpperCase();
    const routes = REGION_TO_ROUTES[region];
    if (!routes) throw new Error(`Region routing not configured: ${region}`);
    return { region, ...routes };
}

const RIOT_TFT_API_KEY = config.riotTftApiKey;
const RIOT_LOL_API_KEY = config.riotLolApiKey;
const sharedRiotLimiter = createRiotRateLimiter();

async function riotFetchJson(url, gameType = 'TFT', limiter = sharedRiotLimiter) {
    const apiKey = gameType === 'TFT' ? RIOT_TFT_API_KEY : RIOT_LOL_API_KEY;

    if (limiter) {
        await limiter.acquire();
    }

    const res = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Riot API request failed: ${res.status} on ${url}`);
        err.status = res.status;
        err.responseText = body || null;
        err.endpoint = url;
        throw err;
    }

    return res.json();
}

const { regional: DEFAULT_REGIONAL } = resolveRegion();

export async function getAccountByRiotId({ regional = DEFAULT_REGIONAL, gameName, tagLine, limiter }) {
    const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
        gameName
    )}/${encodeURIComponent(tagLine)}`;
    return riotFetchJson(url, 'TFT', limiter);
}

export async function getTFTRankByPuuid({ platform, puuid, limiter }) {
    const url = `https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`;
    return riotFetchJson(url, 'TFT', limiter);
}

export async function getTFTMatchIdsByPuuid({ regional, puuid, count = 1, start = 0, limiter }) {
    const safeCount = Math.max(1, Math.min(Number(count) || 1, 20));
    const safeStart = Math.max(0, Number(start) || 0);
    const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${encodeURIComponent(
        puuid
    )}/ids?count=${safeCount}&start=${safeStart}`;

    return riotFetchJson(url, 'TFT', limiter);
}

export async function getTFTMatch({ regional, matchId, limiter }) {
    const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/${encodeURIComponent(matchId)}`;
    return riotFetchJson(url, 'TFT', limiter);
}

export function getLeagueOfGraphsUrl({ region = 'NA', gameName, tagLine }) {
    const shard = String(region || 'NA').toLowerCase();
    const encodedName = encodeURIComponent(gameName);
    const encodedTag = encodeURIComponent(tagLine);
    return `https://www.leagueofgraphs.com/tft/summoner/${shard}/${encodedName}-${encodedTag}`;
}

function platformToLoGShard(platformPrefix) {
    return platformPrefix.toLowerCase().replace(/\d+$/, '');
}

export function getTFTMatchUrl({ matchId }) {
    if (!matchId || !matchId.includes('_')) return null;
    const [platformPrefix, numericId] = matchId.split('_');
    const shard = platformToLoGShard(platformPrefix || 'NA');
    return `https://www.leagueofgraphs.com/tft/match/${shard}/${numericId}`;
}
