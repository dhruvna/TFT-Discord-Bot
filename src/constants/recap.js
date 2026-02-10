// === Recap mode constants ===
// Keep recap mode option payloads and labels consistent across commands.
export const RECAP_MODE_CHOICES = [
  { name: "Daily (last 24h)", value: "DAILY" },
  { name: "Weekly (last 7d)", value: "WEEKLY" },
];

export function modeLabel(mode) {
  return mode === "WEEKLY" ? "Weekly" : "Daily";
}
