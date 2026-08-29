'use strict';
const { loadConfig } = require('./config_loader');
const store = require('./src/store');
const tg = require('./src/telegram');
const gem = require('./src/gemini');
const { fetchChannel, cleanAmazonUrl } = require('./src/channels');
const { buildMessage } = require('./src/format');
const { shouldNotify, isSilent } = require('./src/match');

const cfg = loadConfig();
tg.init(cfg.telegramToken);
gem.init(cfg.geminiKeys, cfg.geminiModel);

const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry');
const FIRST_RUN_MAX_AGE_MIN = 45; // alla primissima esecuzione non spammare storico

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function collectNew(seen, firstEver) {
  const fresh = [];
  for (const handle of cfg.channels) {
    try {
      const { messages } = await fetchChannel(handle);
      for (const m of messages) {
        if (seen[m.key]) continue;
        // segna come visto SUBITO (anche se poi scartato) per non ri-analizzarlo
        seen[m.key] = Date.now();
        if (!m.firstAsin) continue; // senza prodotto Amazon non ci interessa
        if (firstEver && Date.now() - m.ts > FIRST_RUN_MAX_AGE_MIN * 60000) continue;
        if (Date.now() - m.ts > 6 * 3600e3) continue; // troppo vecchio
        fresh.push(m);
      }
      await new Promise((r) => setTimeout(r, 800)); // gentile con t.me
    } catch (e) {
      console.error(`[scan] canale ${handle}: ${e.message}`);
    }
  }
  fresh.sort((a, b) => a.ts - b.ts);
  return fresh.slice(-cfg.maxNewItemsPerScan);
}

async function runOnce() {
  const seen = store.loadSeen();
  const firstEver = Object.keys(seen).length === 0;
  const subs = store.loadSubs();
  // assicura che l'owner sia iscritto
  if (cfg.ownerChatId) store.getSub(subs, cfg.ownerChatId, cfg);

  const fresh = await collectNew(seen, firstEver);
  if (!fresh.length) {
    store.saveSeen(seen, cfg.seenPruneDays);
    store.saveSubs(subs);
    console.log(`[scan] nessun nuovo prodotto${firstEver ? ' (primo avvio: storico ignorato)' : ''}`);
    return;
  }
  console.log(`[scan] ${fresh.length} nuovi prodotti da analizzare`);

  const analyzed = [];
  for (const batch of chunk(fresh, cfg.geminiBatchSize)) {
    const payload = batch.map((m, i) => ({
      idx: i,
      channelTitle: m.channelTitle,
      text: m.text,
      url: cleanAmazonUrl(m.amazonUrls[0] || '') || (m.firstAsin ? `https://www.amazon.it/dp/${m.firstAsin}` : ''),
    }));
    let res;
    try {
      res = await gem.analyzeDeals(payload, cfg);
    } catch (e) {
      console.error(`[scan] Gemini batch fallito: ${e.message}`);
      continue;
    }
    batch.forEach((m, i) => {
      const d = res.get(i);
      if (d) analyzed.push({ msg: m, deal: d });
    });
  }

  const subEntries = Object.entries(subs);
  let sent = 0;
  for (const { msg, deal } of analyzed) {
    const amazonUrl = cleanAmazonUrl(msg.amazonUrls[0] || '') || (msg.firstAsin ? `https://www.amazon.it/dp/${msg.firstAsin}` : null);
    const meta = { channelTitle: msg.channelTitle, ts: msg.ts, amazonUrl, channelUrl: msg.url };
    const text = buildMessage(deal, meta);
    for (const [chatId, sub] of subEntries) {
      if (!shouldNotify(deal, sub, cfg)) continue;
      if (DRY) { console.log(`  → [DRY] invierei a ${chatId}${msg.image ? ' (con foto)' : ''}`); sent++; continue; }
      try {
        await tg.sendDeal(chatId, text, msg.image, { silent: isSilent(deal) });
        sent++;
        await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        console.error(`[scan] invio a ${chatId} fallito: ${e.message}`);
      }
    }
    console.log(`  · ${deal.severity.padEnd(16)} ${deal.category.padEnd(18)} ${(deal.title || '').slice(0, 60)}`);
  }

  if (!DRY) { store.saveSeen(seen, cfg.seenPruneDays); store.saveSubs(subs); }
  console.log(`[scan] fatto — ${analyzed.length} analizzati, ${sent} notifiche inviate`);
}

async function main() {
  if (ONCE) { await runOnce(); return; }
  const deadline = Date.now() + cfg.durationSeconds * 1000;
  while (Date.now() < deadline) {
    try { await runOnce(); } catch (e) { console.error('[scan] errore ciclo:', e.message); }
    await new Promise((r) => setTimeout(r, cfg.scanIntervalSeconds * 1000));
  }
  console.log('[scan] durata massima raggiunta, esco');
}

main();
