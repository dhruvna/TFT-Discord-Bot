function toTitleCaseTier(tier) {
    if (!tier) return null;
    const lower = tier.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

async function fetchJsonOrThrow(url, label) {
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`${label} fetch failed: ${res.status}: ${body}`);
    }
    return res.json();
}

let ddragonVersionCache = null;

export async function getLatestDDragonVersion() {
    if (ddragonVersionCache) return ddragonVersionCache;

    const versions = await fetchJsonOrThrow(
        'https://ddragon.leagueoflegends.com/api/versions.json',
        'Data Dragon versions'
    );

    ddragonVersionCache = versions[0];
    return ddragonVersionCache;
}

function createDatasetLoader({ cacheKey, path }) {
    let cache = null;

    return async function loadDataset() {
        if (cache) return cache;
        const version = await getLatestDDragonVersion();
        const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/${path}`;
        cache = await fetchJsonOrThrow(url, `Data Dragon ${cacheKey}`);
        return cache;
    };
}

export const loadTFTRegalia = createDatasetLoader({
    cacheKey: 'TFT regalia',
    path: 'tft-regalia.json',
});

export const loadTFTChampions = createDatasetLoader({
    cacheKey: 'TFT champion',
    path: 'tft-champion.json',
});

export const loadTFTItems = createDatasetLoader({
    cacheKey: 'TFT item',
    path: 'tft-item.json',
});

export const loadTFTTraits = createDatasetLoader({
    cacheKey: 'TFT trait',
    path: 'tft-trait.json',
});

export async function getTftRegaliaThumbnailUrl({ queueType, tier }) {
    const regalia = await loadTFTRegalia();
    const version = await getLatestDDragonVersion();

    const tierKey = toTitleCaseTier(tier);
    if (!tierKey) return null;

    const entry = regalia?.data?.[queueType]?.[tierKey];
    const file = entry?.image?.full;
    if (!file) return null;

    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-regalia/${file}`;
}

export async function getTftChampionThumbnail({ championId = 'TFT16_Aatrox' }) {
    const version = await getLatestDDragonVersion();
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/tft-champion/${championId}_splash_centered_0.TFT_Set16.png`;
}
