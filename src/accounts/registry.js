// src/accounts/registry.js — реестр аккаунтов (data/accounts.json).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, PROFILES_DIR } from "../config.js";

const REG_PATH = path.join(DATA_DIR, "accounts.json");

export function loadRegistry() {
  if (!existsSync(REG_PATH)) return { accounts: [] };
  try {
    const reg = JSON.parse(readFileSync(REG_PATH, "utf8"));
    if (!Array.isArray(reg.accounts)) reg.accounts = [];
    return reg;
  } catch {
    return { accounts: [] };
  }
}

export function saveRegistry(reg) {
  writeFileSync(REG_PATH, JSON.stringify(reg, null, 2) + "\n");
}

export function upsertAccount(acc) {
  const reg = loadRegistry();
  const i = reg.accounts.findIndex((a) => a.id === acc.id);
  if (i >= 0) reg.accounts[i] = { ...reg.accounts[i], ...acc };
  else reg.accounts.push(acc);
  saveRegistry(reg);
  return reg;
}

export function getAccount(id) {
  return loadRegistry().accounts.find((a) => a.id === id) || null;
}

export function profilePath(id) {
  return path.join(PROFILES_DIR, id);
}
