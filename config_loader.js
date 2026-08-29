'use strict';
const fs = require('fs');
const path = require('path');

// Carica .env (semplice, senza dipendenze) se presente.
(function loadDotEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
})();

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

function geminiKeys() {
  const keys = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (/^GEMINI_API_KEY(_\d+)?$/.test(k) && v && v.trim()) keys.push(v.trim());
  }
  return [...new Set(keys)];
}

function loadConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN mancante (impostalo in .env o nei secrets GitHub)');
  const keys = geminiKeys();
  if (!keys.length) throw new Error('Nessuna GEMINI_API_KEY trovata (GEMINI_API_KEY_1, _2, ...)');
  return {
    ...config,
    telegramToken: token,
    ownerChatId: String(process.env.TELEGRAM_CHAT_ID || config.ownerChatId || '').trim(),
    geminiKeys: keys,
  };
}

module.exports = { loadConfig };
