'use strict';
const { loadConfig } = require('./config_loader');
const store = require('./src/store');
const tg = require('./src/telegram');
const gem = require('./src/gemini');
const { fetchChannel } = require('./src/channels');
const { buildMessage } = require('./src/format');
const { shouldNotify, isSilent } = require('./src/match');

const cfg = loadConfig();
tg.init(cfg.telegramToken);
gem.init(cfg.geminiKeys, cfg.geminiModel);

const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry');
const FIRST_RUN_MAX_AGE_MIN = 45;
const MAX_AGE_MS = 6 * 3600e3;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function dpUrl(asin) { return `https://www.amazon.it/dp/${asin}`; }

// Raccoglie i PRODOTTI nuovi (un candidato per asin), non i messaggi.
async function collectNew(seen, firstEver) {
  const byAsin = new Map(); // asin -> candidato (teniamo il migliore)
  const now = Date.now();

  for (const handle of cfg.channels) {
    let messages;
    try {
      ({ messages } = await fetchChannel(handle));
    } catch (e) {
      console.error(`[scan] canale ${handle}: ${e.message}`);
      continue;
    }
    for (const m of messages) {
      if (firstEver && now - m.ts > FIRST_RUN_MAX_AGE_MIN * 60000) continue;
      if (now - m.ts > MAX_AGE_MS) continue;

      for (const p of m.products) {
        if (!p.asin) continue;
        const seenKey = `${m.key}#${p.asin}`;
        if (seen[seenKey]) continue;
        seen[seenKey] = now; // marcato subito: non ri-analizzarlo

        const cand = {
          asin: p.asin,
          text: p.text || m.text,
          image: p.image,
          channel: m.channel,
          channelTitle: m.channelTitle,
          ts: m.ts,
          url: m.url,
          amazonUrl: dpUrl(p.asin),
          isError: /errore di prezzo/i.test(p.text || m.text),
        };
        const prev = byAsin.get(p.asin);
        if (!prev) byAsin.set(p.asin, cand);
        else if ((cand.isError && !prev.isError) || (cand.isError === prev.isError && (cand.text || '').length > (prev.text || '').length)) {
          byAsin.set(p.asin, cand); // preferisci chi segnala "errore di prezzo" / testo più ricco
        }
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  return [...byAsin.values()].sort((a, b) => a.ts - b.ts).slice(-cfg.maxNewItemsPerScan);
}

async function runOnce() {
  const seen = store.loadSeen();
  const firstEver = Object.keys(seen).length === 0;
  const subs = store.loadSubs();
  const sentLog = store.readJson('sent.json', {});
  if (cfg.ownerChatId) store.getSub(subs, cfg.ownerChatId, cfg);

  const fresh = await collectNew(seen, firstEver);
  const persist = () => {
    if (DRY) return;
    store.saveSeen(seen, cfg.seenPruneDays);
    store.saveSubs(subs);
    pruneSent(sentLog);
    store.writeJson('sent.json', sentLog);
  };

  if (!fresh.length) {
    persist();
    console.log(`[scan] nessun prodotto nuovo${firstEver ? ' (primo avvio: storico ignorato)' : ''}`);
    return;
  }
  console.log(`[scan] ${fresh.length} prodotti nuovi da analizzare`);

  const analyzed = [];
  for (const batch of chunk(fresh, cfg.geminiBatchSize)) {
    const payload = batch.map((c, i) => ({
      idx: i, channelTitle: c.channelTitle, asin: c.asin, text: c.text, url: c.amazonUrl,
    }));
    let res;
    try {
      res = await gem.analyzeDeals(payload, cfg);
    } catch (e) {
      console.error(`[scan] Gemini batch fallito: ${e.message}`);
      continue;
    }
    batch.forEach((c, i) => { const d = res.get(i); if (d) analyzed.push({ cand: c, deal: d }); });
  }

  const subEntries = Object.entries(subs);
  const dedupMs = cfg.sentPruneDays * 86400e3;
  let sent = 0;

  for (const { cand, deal } of analyzed) {
    const meta = { channelTitle: cand.channelTitle, ts: cand.ts, amazonUrl: cand.amazonUrl, channelUrl: cand.url };
    const text = buildMessage(deal, meta);

    for (const [chatId, sub] of subEntries) {
      if (!shouldNotify(deal, sub, cfg)) continue;
      const prevTs = (sentLog[chatId] || {})[cand.asin];
      if (prevTs && Date.now() - prevTs < dedupMs) continue; // già inviato di recente

      if (DRY) {
        console.log(`  → [DRY] a ${chatId}  ${cand.asin}${cand.image ? ' +foto' : ''}`);
      } else {
        try {
          await tg.sendDeal(chatId, text, cand.image, { silent: isSilent(deal) });
          await new Promise((r) => setTimeout(r, 350));
        } catch (e) {
          console.error(`[scan] invio a ${chatId} fallito: ${e.message}`);
          continue;
        }
      }
      (sentLog[chatId] || (sentLog[chatId] = {}))[cand.asin] = Date.now();
      sent++;
    }
    console.log(`  · ${deal.severity.padEnd(16)} ${deal.category.padEnd(18)} ${cand.asin}  ${(deal.title || '').slice(0, 55)}`);
  }

  persist();
  console.log(`[scan] fatto — ${analyzed.length} analizzati, ${sent} notifiche inviate`);
}

function pruneSent(sentLog) {
  const cutoff = Date.now() - cfg.sentPruneDays * 86400e3;
  for (const chatId of Object.keys(sentLog)) {
    for (const [asin, ts] of Object.entries(sentLog[chatId])) if (ts < cutoff) delete sentLog[chatId][asin];
    if (!Object.keys(sentLog[chatId]).length) delete sentLog[chatId];
  }
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
