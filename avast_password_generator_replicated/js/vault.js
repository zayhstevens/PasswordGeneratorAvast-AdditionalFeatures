// vault.js
// - CSV parsing/building helpers
// - AES-128-GCM encryption helpers (WebCrypto)
// - API helpers (server.py) to read/write the two known vault CSV files

const DB_NAME = "avast_pwdgen_clone";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const store = tx.objectStore("kv");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function makeKey(website, username) {
  return `${(website ?? "").trim().toLowerCase()}||${(username ?? "").trim().toLowerCase()}`;
}

// -----------------
// CSV helpers
// -----------------
function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

// Minimal CSV parser compatible with our output (handles quotes, commas, newlines)
function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ""; i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (ch === '\r') { i++; continue; }
    field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);

  // Trim empty trailing row
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

export function parsePlainVaultCsv(text) {
  const rows = parseCsv((text ?? "").trim());
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = rows[r][c] ?? "";
    out.push(obj);
  }
  return out;
}

export function buildPlainVaultCsv(records) {
  const header = ["website","username","password","cardNumber","cardExp","cardCvc","cardType","createdAt","projectStrength","avastStrength"];
  const lines = [header.join(",")];
  for (const rec of records) {
    const row = header.map((k) => csvEscape(rec[k]));
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

export function parseEncryptedVaultCsv(text) {
  const rows = parseCsv((text ?? "").trim());
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = rows[r][c] ?? "";
    out.push(obj);
  }
  return out;
}

export function buildEncryptedVaultCsv(records) {
  const header = ["website","username","encPayload","iv","createdAt","cardType"];
  const lines = [header.join(",")];
  for (const rec of records) {
    const row = header.map((k) => csvEscape(rec[k]));
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

// -----------------
// AES-128-GCM helpers
// -----------------
async function getOrCreateVaultKey() {
  // Stored per-browser (IndexedDB). This is for the "encrypted" CSV only.
  // If you want a different key, delete site data for localhost.
  let key = await kvGet("vaultKey");
  if (key) return key;
  key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt", "decrypt"]);
  await kvSet("vaultKey", key);
  return key;
}

function b64(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin);
}
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSensitive(payloadObj) {
  const key = await getOrCreateVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payloadObj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { encPayload: b64(ct), iv: b64(iv) };
}

export async function decryptSensitive(encPayload, iv) {
  const key = await getOrCreateVaultKey();
  const ct = unb64(encPayload);
  const ivBytes = unb64(iv);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

// -----------------
// API helpers
// -----------------
export async function apiGetPlainCsv() {
  const res = await fetch("/api/vault/plain", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to read vault_plain.csv (${res.status})`);
  return await res.text();
}

export async function apiGetEncryptedCsv() {
  const res = await fetch("/api/vault/encrypted", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to read vault_encrypted.csv (${res.status})`);
  return await res.text();
}

export async function apiSaveRecord(payload) {
  const res = await fetch("/api/vault/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) {
    throw new Error(out.error || `Save failed (${res.status})`);
  }
  return out;
}

export async function apiUpdateRecord(payload) {
  const res = await fetch("/api/vault/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) {
    throw new Error(out.error || `Update failed (${res.status})`);
  }
  return out;
}
