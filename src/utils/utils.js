// === Misc utilities ===
// Shared helper functions used across the bot.

// === Timing helpers ===
// Standard async sleep utility for pacing async loops.
export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
