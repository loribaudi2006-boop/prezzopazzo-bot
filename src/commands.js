'use strict';
const gem = require('./gemini');

const HELP = `👋 Ciao! Ti avviso quando su Amazon.it compare un <b>errore di prezzo</b> o uno sconto molto forte.

📩 Per ogni offerta ti mando:
• cos'è il prodotto, spiegato in modo chiaro e breve
• prezzo attuale e prezzo originale (barrato)
• livello di sconto:  🟢 &lt;30%   🟡 30-50%   🟠 50-70%   🔴 oltre 70%
• 🔴🔴🔴 in testa se è un errore di prezzo clamoroso (con suono)
• link diretto ad Amazon

⚙️ <b>Comandi</b>
/categorie – scegli cosa ti interessa. Scrivi a parole tue:
   es. "tecnologia e informatica", "console e videogiochi",
   "roba per la casa", "tutto"
/soglia clamorosi – solo errori di prezzo grossi (predefinito)
/soglia tutto – anche tutte le occasioni
/stato – vedi le tue impostazioni
/pausa · /riprendi – ferma o riattiva gli avvisi
/help – questo messaggio`;

const CAT_NAMES = {
  tecnologia: '💻 Tecnologia',
  casa: '🏠 Casa',
  console_videogiochi: '🎮 Console e videogiochi',
  altro: '📦 Altro',
};

function fmtCats(cats) {
  if (!cats || !cats.length) return '(nessuna — non riceverai avvisi)';
  if (cats.length === 4) return 'tutte';
  return cats.map((c) => CAT_NAMES[c] || c).join(', ');
}

function statusText(sub) {
  const th = sub.threshold === 'tutto'
    ? 'tutte le occasioni'
    : 'solo errori di prezzo / sconti enormi';
  return `📋 <b>Le tue impostazioni</b>
Categorie: ${fmtCats(sub.categories)}
Avvisi: ${th}
Stato: ${sub.paused ? '⏸ in pausa' : '▶️ attivo'}`;
}

// Ritorna { reply, silent? } — modifica sub in place.
async function handleCommand(text, sub, cfg) {
  const raw = (text || '').trim();
  const lower = raw.toLowerCase();
  const [cmd, ...rest] = raw.split(/\s+/);
  const arg = rest.join(' ').trim();
  const c = cmd.toLowerCase().replace(/@\w+$/, '');

  if (c === '/start' || c === '/help' || c === 'help') {
    return { reply: HELP };
  }

  if (c === '/stato' || c === '/status') {
    return { reply: statusText(sub) };
  }

  if (c === '/pausa' || lower === 'pausa' || lower === 'stop') {
    sub.paused = true;
    return { reply: '⏸ Avvisi sospesi. Scrivi /riprendi per riattivarli.' };
  }
  if (c === '/riprendi' || lower === 'riprendi' || lower === 'start') {
    sub.paused = false;
    return { reply: '▶️ Avvisi riattivati.' };
  }

  if (c === '/soglia') {
    if (/tutt|semp|ogni/.test(arg.toLowerCase())) {
      sub.threshold = 'tutto';
      return { reply: '✅ Ora ricevi <b>tutte le occasioni</b> nelle tue categorie.' };
    }
    if (/clam|gross|errore|solo|big/.test(arg.toLowerCase())) {
      sub.threshold = 'clamorosi';
      return { reply: '✅ Ora ricevi <b>solo gli errori di prezzo grossi</b>.' };
    }
    return {
      reply: `Scegli la soglia:
/soglia clamorosi – solo errori di prezzo / sconti enormi (attuale: ${sub.threshold === 'clamorosi' ? '✔' : ' '})
/soglia tutto – tutte le occasioni (attuale: ${sub.threshold === 'tutto' ? '✔' : ' '})`,
    };
  }

  if (c === '/categorie' || c === '/categoria' || c === '/cat') {
    if (!arg) {
      return {
        reply: `Le tue categorie: <b>${fmtCats(sub.categories)}</b>

Per cambiarle scrivi <code>/categorie</code> seguito da cosa ti interessa, a parole tue. Esempi:
• <code>/categorie tecnologia e informatica</code>
• <code>/categorie console, videogiochi e roba per la casa</code>
• <code>/categorie tutto</code>`,
      };
    }
    try {
      const { categories, spiegazione } = await gem.interpretCategories(arg);
      if (!categories.length) {
        return { reply: '🤔 Non ho capito quali categorie. Riprova con qualcosa come "tecnologia e casa" oppure "tutto".' };
      }
      sub.categories = categories;
      return { reply: `✅ Fatto. ${spiegazione ? spiegazione + '\n' : ''}Categorie attive: <b>${fmtCats(categories)}</b>` };
    } catch (e) {
      return { reply: '⚠️ Errore nell\'interpretare la richiesta, riprova tra poco.' };
    }
  }

  // testo libero non-comando: prova a interpretarlo come scelta categorie/soglia
  if (!raw.startsWith('/')) {
    if (/^(tutto|tutte|sempre)$/i.test(lower)) {
      sub.categories = [...gem.CATS];
      sub.threshold = 'tutto';
      return { reply: '✅ Ok: tutte le categorie, tutte le occasioni.' };
    }
    try {
      const { categories, spiegazione } = await gem.interpretCategories(raw);
      if (categories.length) {
        sub.categories = categories;
        return { reply: `✅ ${spiegazione ? spiegazione + '\n' : ''}Categorie attive: <b>${fmtCats(categories)}</b>\n\n(usa /help per tutti i comandi)` };
      }
    } catch {}
  }

  return { reply: 'Comando non riconosciuto. Scrivi /help per la guida.' };
}

module.exports = { handleCommand, HELP, statusText };
