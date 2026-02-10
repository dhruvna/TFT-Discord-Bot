import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getTftChampionImageById, getTftItemImageById, getTftTraitImageById } from "../riot.js";

const DEFAULT_TILE_SIZE = 76;
const DEFAULT_PADDING = 10;
const DEFAULT_MAX_UNITS = 10;
const DEFAULT_COLUMNS = 4;

const ITEM_ROW_RATIO = 0.3;
const PORTRAIT_ROW_RATIO = 1 - ITEM_ROW_RATIO;

function getFrameColor(unit) {
    // tier means star level
    // rarity seems to be a binary version of cost? 0, 1, 2, 4, 6, 7 
    const rarity = Number(unit?.rarity ?? 0);
    if (rarity >= 6) return "#f18b2f";
    if (rarity === 4) return "#9a4de0";
    if (rarity === 2) return "#2f97e8";
    if (rarity === 1) return "#3ca56a";
    return "#656a74";
}

function normalizeUnits(units, maxUnits) {
    if (!Array.isArray(units)) return [];
    const sortedUnits = [...units].sort((a, b) => {
        const costA = Number(a?.rarity ?? 0);
        const costB = Number(b?.rarity ?? 0);
        if (costB !== costA) return costB - costA; // highest cost first
        
        const tierA = Number(a?.tier ?? 0);
        const tierB = Number(b?.tier ?? 0);
        if (tierB !== tierA) return tierB - tierA; // higher star tiers first

        const idA = String(a?.character_id ?? "");
        const idB = String(b?.character_id ?? "");
        return idA.localeCompare(idB); // deterministic L->R order on ties
    });
    return sortedUnits.slice(0, maxUnits);
}

function normalizeTraits(traits, maxTraits = 8) {
    if (!Array.isArray(traits)) return [];
    const activeTraits = traits
        .filter((trait) => Number(trait?.tier_current ?? 0) > 0)
        .sort((a, b) => {
            const tierA = Number(a?.tier_current ?? 0);
            const tierB = Number(b?.tier_current ?? 0);
            if (tierB !== tierA) return tierB - tierA;
            const styleA = Number(a?.style ?? 0);
            const styleB = Number(b?.style ?? 0);
            if (styleB !== styleA) return styleB - styleA;
            const nameA = String(a?.name ?? "");
            const nameB = String(b?.name ?? "");
            return nameA.localeCompare(nameB);
        });
    return activeTraits.slice(0, maxTraits);
}

function drawStarTier(ctx, stars, x, y) {
    const count = Math.min(3, Math.max(0, Number(stars ?? 0)));
    if (!Number.isFinite(count) || count <= 0) return;

    const markerRadius = 3;
    const markerSpacing = 4;
    const badgePaddingX = 5;
    const badgePaddingY = 4;
    const badgeHeight = markerRadius * 2 + badgePaddingY * 2;
    const badgeWidth =
        badgePaddingX * 2 + count * markerRadius * 2 + (count - 1) * markerSpacing;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillRect(x, y, badgeWidth, badgeHeight);

    const markerY = y + badgeHeight / 2;
    const startX = x + badgePaddingX + markerRadius;

    for (let i = 0; i < count; i += 1) {
        const markerX = startX + i * (markerRadius * 2 + markerSpacing);
        ctx.beginPath();
        ctx.arc(markerX, markerY, markerRadius, 0, Math.PI * 2);
        ctx.fill();
    }
}

async function loadUnitImage(characterId) {
    const url = await getTftChampionImageById(characterId);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return loadImage(buffer);
}

async function loadItemImage(itemId) {
    const url = await getTftItemImageById(itemId);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return loadImage(buffer);
}

async function loadTraitImage(traitId) {
    const url = await getTftTraitImageById(traitId);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return loadImage(buffer);
}

function getTraitTierColor(trait) {
    // style:
    // 0 = gray (no active bonus)
    // 1 = bronze 
    // 2 = silver
    // 3 = UNIQUE
    // 4 = gold  
    // 5 = prismatic
    const style = Number(trait?.style ?? 0);
    if (style >= 5) return "#c4fdc9";
    if (style === 4) return "#DBC66F";
    if (style === 3) return "#FEAF76";
    if (style === 2) return "#ACC5CA";
    if (style === 1) return "#CD7B46";
    return "#7b808e"; 
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

export async function buildUnitStripImage(units, options = {}) {
    const {
        tileSize = DEFAULT_TILE_SIZE,
        padding = DEFAULT_PADDING,
        maxUnits = DEFAULT_MAX_UNITS,
        columns = DEFAULT_COLUMNS,
        traits = [],
        traitIconSize = 30,
    } = options;

    const normalized = normalizeUnits(units, maxUnits);
    const normalizedTraits = normalizeTraits(traits);
    if (normalized.length === 0) return null;

    const rows = Math.ceil(normalized.length / columns);
    const cardWidth = tileSize;
    const cardHeight = Math.floor(tileSize * 1.25);
    const portraitHeight = Math.floor(cardHeight * PORTRAIT_ROW_RATIO);
    const itemRowHeight = cardHeight - portraitHeight;

    const traitSectionHeight = normalizedTraits.length > 0
        ? Math.ceil(normalizedTraits.length / columns) * traitIconSize + padding * 2
        : 0;

    const width = columns * cardWidth + (columns + 1) * padding;
    const height = rows * cardHeight + (rows + 1) * padding + traitSectionHeight;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const backgroundGradient = ctx.createLinearGradient(0, 0, 0, height);
    backgroundGradient.addColorStop(0, "rgba(15, 17, 26, 0.92)");
    backgroundGradient.addColorStop(1, "rgba(8, 10, 15, 0.92)");
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, width, height);

    let unitGridStartY = 0;

    if (normalizedTraits.length > 0) {
        drawRoundedRect(ctx, padding / 2, padding / 2, width - padding, traitSectionHeight - padding / 2, 8);
        ctx.fill();
        
        for (const [index, trait] of normalizedTraits.entries()) {
            const col = index % columns;
            const row = Math.floor(index / columns);
            const iconX = padding + col * (traitIconSize + padding);
            const iconY = padding + row * (traitIconSize + padding);
            const traitImage = await loadTraitImage(trait?.name);

            const backgroundColor = getTraitTierColor(trait);
            ctx.fillStyle = backgroundColor.replace(/rgb\((\d+), (\d+), (\d+)\)/, "rgba($1, $2, $3, 0.95)");
            drawRoundedRect(ctx, iconX, iconY, traitIconSize, traitIconSize, 6);
            ctx.fill();

            if (traitImage) {
                ctx.drawImage(traitImage, iconX + 2, iconY + 2, traitIconSize - 4, traitIconSize - 4);
            }
        }
        unitGridStartY = traitSectionHeight;
    }

    for (const [index, unit] of normalized.entries()) {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = padding + col * (cardWidth + padding);
        const y = unitGridStartY + padding + row * (cardHeight + padding);

        const champImage = await loadUnitImage(unit?.character_id);
        const itemIds = Array.isArray(unit?.itemNames) && unit.itemNames.length > 0
            ? unit.itemNames
            : unit?.items;

        const itemImages = [];
        for (const itemId of (itemIds || []).slice(0, 3)) {
            const itemImage = await loadItemImage(itemId);
            if (itemImage) itemImages.push(itemImage);
        }
        const frameColor = getFrameColor(unit);
        ctx.fillStyle = "rgba(14, 16, 23, 0.96)";
        drawRoundedRect(ctx, x, y, cardWidth, cardHeight, 6);
        ctx.fill();

        if (champImage) {
            ctx.drawImage(champImage, x + 3, y + 3, cardWidth - 6, portraitHeight - 5);
        } else {
            ctx.fillStyle = "#2f2f3a";
            ctx.fillRect(x + 3, y + 3, cardWidth - 6, portraitHeight - 5);
        }

        const itemRowY = y + portraitHeight;
        ctx.fillStyle = "rgba(10, 12, 20, 0.95)";
        ctx.fillRect(x + 1, itemRowY, cardWidth - 2, itemRowHeight - 1);

        const slots = 3;
        const slotWidth = cardWidth / slots;
        const itemSize = Math.floor(Math.min(slotWidth, itemRowHeight) * 0.78);
        for (let i = 0; i < slots; i += 1) {
            const slotCenterX = x + slotWidth * i + slotWidth / 2;
            const itemX = Math.floor(slotCenterX - itemSize / 2);
            const itemY = Math.floor(itemRowY + (itemRowHeight - itemSize) / 2);

            ctx.fillRect(itemX - 1, itemY - 1, itemSize + 2, itemSize + 2);

            if (itemImages[i]) {
                ctx.drawImage(itemImages[i], itemX, itemY, itemSize, itemSize);
            }
        }

        ctx.strokeStyle = frameColor;
        ctx.lineWidth = 3;
        drawRoundedRect(ctx, x + 1.5, y + 1.5, cardWidth - 3, cardHeight - 3, 5);
        ctx.stroke();

        drawStarTier(ctx, unit?.tier, x + 4, y + 4);
    }

    return canvas.toBuffer("image/png");
}