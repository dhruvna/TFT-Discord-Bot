import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getTftChampionImageById } from "../riot.js";

const DEFAULT_TILE_SIZE = 64;
const DEFAULT_PADDING = 6;
const DEFAULT_MAX_UNITS = 10;
const DEFAULT_COLUMNS = 5;

function normalizeUnits(units, maxUnits) {
    if (!Array.isArray(units)) return [];
    const sortedUnits = [...units].sort((a, b) => {
        const tierA = Number(a?.tier ?? 0);
        const tierB = Number(b?.tier ?? 0);
        if (tierB !== tierA) return tierB - tierA; // higher star tiers first
        const costA = Number(a?.rarity ?? 0);
        const costB = Number(b?.rarity ?? 0);
        return costB - costA; // then higher rarity
    });
    return sortedUnits.slice(0, maxUnits);
}

function drawStarTier(ctx, stars, x, y) {
    const count = Number(stars ?? 0);
    if (!Number.isFinite(count) || count <= 0) return;
    const starText = "★".repeat(Math.min(3, count));
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(x, y, 40, 18);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(starText, x + 4, y + 14);
}

async function loadUnitImage(characterId) {
    const url = await getTftChampionImageById(characterId);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return loadImage(buffer);
}

export async function buildUnitStripImage(units, options = {}) {
    const {
        tileSize = DEFAULT_TILE_SIZE,
        padding = DEFAULT_PADDING,
        maxUnits = DEFAULT_MAX_UNITS,
        columns = DEFAULT_COLUMNS,
    } = options;

    const normalized = normalizeUnits(units, maxUnits);
    if (normalized.length === 0) return null;

    const rows = Math.ceil(normalized.length / columns);
    const width = columns * tileSize + (columns + 1) * padding;
    const height = rows * tileSize + (rows + 1) * padding;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(17, 17, 17, 0.85)";
    ctx.fillRect(0, 0, width, height);

    await Promise.all(
        normalized.map(async (units, index) => {
            const col = index % columns;
            const row = Math.floor(index / columns);
            const x = padding + col * (tileSize + padding);
            const y = padding + row * (tileSize + padding);
            const image = await loadUnitImage(unit?.character_id);
            if (image) {
                ctx.drawImage(image, x, y, tileSize, tileSize);
            } else {
                ctx.fillStyle = "#2f2f3a";
                ctx.fillRect(x, y, tileSize, tileSize);
            }
            drawStarTier(ctx, unit?.tier, x + 4, y + 4);
        })
    );

    return canvas.toBuffer("image/png");
}