'use strict';
const { loadConfig } = require('./config_loader');
const store = require('./src/store');
const tg = require('./src/telegram');
const gem = require('./src/gemini');
const { handleCommand } = require('./src/commands');

const cfg = loadConfig();
tg.init(cfg.telegramToken);
gem.init(cfg.geminiKeys, cfg.geminiModel);

const COMMANDS = [
  { command: 'start', description: 'Avvia il bot e mostra la guida' },
  { command: 'categorie', description: 'Scegli su quali categorie ricevere avvisi' },
  { command: 'soglia', description: 'Solo errori clamorosi oppure tutte le occasioni' },
  { command: 'stato', description: 'Mostra le tue impostazioni attuali' },
  { command: 'pausa', description: 'Sospendi temporaneamente le notifiche' },
  { command: 'riprendi', description: 'Riattiva le notifiche' },
  { command: 'help', description: 'Come funziona il bot e tutti i comandi' },
];

async function handleUpdate(u) {
  const msg = u.message;
  if (!msg || !msg.chat || !msg.text) return;
  const chatId = String(msg.chat.id);
  const subs = store.loadSubs();
  const sub = store.getSub(subs, chatId, cfg);
  const isNew = !sub._greeted;

  let out;
  try {
    out = await handleCommand(msg.text, sub, cfg);
  } catch (e) {
    console.error('[bot] handleCommand:', e.message);
    out = { reply: '⚠️ Errore interno, riprova.' };
  }

  if (isNew && !/^\/(start|help)/i.test(msg.text.trim())) {
    sub._greeted = true;
  }
  store.saveSubs(subs);

  if (out && out.reply) {
    try { await tg.sendMessage(chatId, out.reply, { silent: true }); }
    catch (e) { console.error(`[bot] risposta a ${chatId}: ${e.message}`); }
  }
}

async function main() {
  try { await tg.setMyCommands(COMMANDS); console.log('[bot] comandi registrati'); }
  catch (e) { console.error('[bot] setMyCommands:', e.message); }

  let offset = store.loadOffset();
  const deadline = Date.now() + cfg.durationSeconds * 1000;
  console.log('[bot] in ascolto…');

  while (Date.now() < deadline) {
    try {
      const updates = await tg.getUpdates(offset, cfg.botPollSeconds);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
      if (updates.length) store.saveOffset(offset);
    } catch (e) {
      if (e.name !== 'AbortError') console.error('[bot] getUpdates:', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log('[bot] durata massima raggiunta, esco');
}

main();
