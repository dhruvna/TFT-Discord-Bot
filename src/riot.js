export {
    resolveRegion,
    getAccountByRiotId,
    getTFTRankByPuuid,
    getTFTMatchIdsByPuuid,
    getTFTMatch,
    getLolRankByPuuid,
    getLolMatchIdsByPuuid,
    getLolMatch,
    getLeagueOfGraphsUrl,
    getLolProfileUrl,
    getTFTMatchUrl,
    getLolMatchUrl,
} from './riot/api.js';

export {
    getLatestDDragonVersion,
    loadTFTRegalia,
    loadTFTChampions,
    loadTFTItems,
    loadTFTTraits,
    getTftRegaliaThumbnailUrl,
} from './riot/ddragon.js';

export {
    getTftChampionNameById,
    getTftChampionImageById,
    getTftItemNameById,
    getTftItemImageById,
    getTftTraitNameById,
    getTftTraitImageById,
} from './riot/ddragonIndexes.js';
