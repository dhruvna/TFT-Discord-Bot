import {
    getLatestDDragonVersion,
    loadTFTChampions,
    loadTFTItems,
    loadTFTTraits,
} from './ddragon.js';

function createLookupIndex({ loadDataset, normalizeEntryId = (id) => id }) {
    let nameById = null;
    let imageById = null;

    async function loadIndexes() {
        if (nameById && imageById) {
            return { nameById, imageById };
        }

        const dataset = await loadDataset();
        const entries = Object.values(dataset?.data ?? {});
        const nextNameById = new Map();
        const nextImageById = new Map();

        for (const entry of entries) {
            if (!entry?.id) continue;
            const normalizedId = normalizeEntryId(entry.id);
            if (entry?.name) {
                nextNameById.set(normalizedId, entry.name);
            }
            if (entry?.image?.full) {
                nextImageById.set(normalizedId, entry.image.full);
            }
        }

        nameById = nextNameById;
        imageById = nextImageById;
        return { nameById, imageById };
    }

    return {
        async getNameById(id) {
            const key = normalizeEntryId(id);
            if (!key) return null;
            const { nameById: map } = await loadIndexes();
            return map.get(key) ?? null;
        },
        async getImageById(id, imageFolder) {
            const key = normalizeEntryId(id);
            if (!key) return null;
            const { imageById: map } = await loadIndexes();
            const file = map.get(key);
            if (!file) return null;
            const version = await getLatestDDragonVersion();
            return `https://ddragon.leagueoflegends.com/cdn/${version}/img/${imageFolder}/${file}`;
        },
    };
}

const championLookup = createLookupIndex({
    loadDataset: loadTFTChampions,
});

const itemLookup = createLookupIndex({
    loadDataset: loadTFTItems,
    normalizeEntryId: (id) => String(id),
});

const traitLookup = createLookupIndex({
    loadDataset: loadTFTTraits,
    normalizeEntryId: (id) => String(id),
});

export function getTftChampionNameById(characterId) {
    return championLookup.getNameById(characterId);
}

export function getTftChampionImageById(characterId) {
    return championLookup.getImageById(characterId, 'tft-champion');
}

export function getTftItemNameById(itemId) {
    return itemLookup.getNameById(itemId);
}

export function getTftItemImageById(itemId) {
    return itemLookup.getImageById(itemId, 'tft-item');
}

export function getTftTraitNameById(traitId) {
    return traitLookup.getNameById(traitId);
}

export function getTftTraitImageById(traitId) {
    return traitLookup.getImageById(traitId, 'tft-trait');
}
