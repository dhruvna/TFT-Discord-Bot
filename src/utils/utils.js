// utils.js

import { listGuildAccounts } from "../storage.js";

export function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is required`);
  return value;
}

export function getOptionalEnv(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function parseIntEnv(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = getOptionalEnv(name, fallback);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}


export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
