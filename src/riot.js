import 'dotenv/config';

const defaultPlatform = (process.env.DEFAULT_PLATFORM || 'na1').toLowerCase();
const defaultRegional = (process.env.DEFAULT_REGIONAL || 'americas').toLowerCase();

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

export async function getAccountByRiotId( {region = defaultRegional, gameName, tagLine} ) {
    const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
    )}/${encodeURIComponent(tagLine)}`;
    
  return riotFetchJson(url);
}

export async function getTFTRankByPuuid({ platform, puuid }) {
  const url = `https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`;
  return riotFetchJson(url);
}