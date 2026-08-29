'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) { return path.join(DATA_DIR, name); }

function readJson(name, fallback) {
  try {
    const p = file(name);
    if (!fs.existsSync(p)) return fallback;
    const txt = fs.readFileSync(p, 'utf8').trim();
    return txt ? JSON.parse(txt) : fallback;
  } catch (e) {
    console.error(`[store] lettura ${name} fallita:`, e.message);
    return fallback;
  }
}

function writeJson(name, obj) {
  const p = file(name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

// ---- seen (dedup messaggi) ----
function loadSeen() { return readJson('seen.json', {}); }
function saveSeen(seen, pruneDays) {
  if (pruneDays) {
    const cutoff = Date.now() - pruneDays * 86400e3;
    for (const [k, ts] of Object.entries(seen)) if (ts < cutoff) delete seen[k];
  }
  writeJson('seen.json', seen);
}

// ---- subscribers ----
function loadSubs() { return readJson('subs.json', {}); }
function saveSubs(subs) { writeJson('subs.json', subs); }

function getSub(subs, chatId, cfg) {
  const id = String(chatId);
  if (!subs[id]) {
    subs[id] = {
      categories: [...cfg.defaultCategories],
      threshold: cfg.defaultThreshold,
      paused: false,
      createdAt: new Date().toISOString(),
    };
  }
  return subs[id];
}

// ---- key rotation ----
function nextKeyIndex(total) {
  const st = readJson('key_state.json', { i: 0 });
  const i = st.i % total;
  writeJson('key_state.json', { i: (i + 1) % total });
  return i;
}

// ---- offset bot ----
function loadOffset() { return readJson('offset.json', { offset: 0 }).offset; }
function saveOffset(offset) { writeJson('offset.json', { offset }); }

module.exports = {
  DATA_DIR, readJson, writeJson,
  loadSeen, saveSeen,
  loadSubs, saveSubs, getSub,
  nextKeyIndex,
  loadOffset, saveOffset,
};
