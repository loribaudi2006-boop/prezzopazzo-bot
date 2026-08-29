'use strict';
const store = require('./store');

let KEYS = [];
let MODEL = 'gemini-flash-lite-latest';
function init(keys, model) { KEYS = keys; if (model) MODEL = model; }

async function rawCall(payload, { timeoutMs = 45000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const idx = store.nextKeyIndex(KEYS.length);
    const key = KEYS[idx];
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        }
      );
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`Gemini ${res.status} (key #${idx + 1})`);
        continue; // prova la chiave successiva
      }
      const json = await res.json();
      if (json.error) throw new Error(`Gemini: ${json.error.message}`);
      const txt = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      return txt;
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') lastErr = new Error('Gemini timeout');
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('Gemini: tutte le chiavi hanno fallito');
}

function parseJson(txt) {
  let s = txt.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  const c = s.indexOf('[');
  const d = s.lastIndexOf(']');
  let slice = s;
  if (c !== -1 && (a === -1 || c < a)) slice = s.slice(c, d + 1);
  else if (a !== -1) slice = s.slice(a, b + 1);
  return JSON.parse(slice);
}

const CATS = ['tecnologia', 'casa', 'console_videogiochi', 'altro'];

async function analyzeDeals(items, cfg) {
  // items: [{ idx, channelTitle, asin, text, url (amazon pulito) }]
  const catDesc = Object.entries(cfg.categoryDescriptions).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const list = items.map((it) => `### ITEM ${it.idx}
Canale: ${it.channelTitle}
ASIN: ${it.asin || '(sconosciuto)'}
Link: ${it.url || '(nessuno)'}
Testo (riguarda SOLO questo prodotto):
${(it.text || '').slice(0, 900)}`).join('\n\n');

  const prompt = `Sei un analista di offerte Amazon.it. Ogni ITEM qui sotto è UN SINGOLO prodotto (identificato dall'ASIN). Restituisci un oggetto JSON per ogni ITEM, descrivendo ESATTAMENTE quel prodotto — non inventare, non confondere prodotti diversi.

Categorie disponibili:
${catDesc}

Livelli di gravità (severity):
- "normale": sconto modesto o prezzo in linea col mercato.
- "forte": buon affare, sconto reale importante (indicativamente 30-55%).
- "errore": molto probabile errore di prezzo o sconto anomalo (il canale lo segnala come errore di prezzo, oppure lo sconto è ~55-70% su un prodotto normalmente stabile).
- "errore_clamoroso": prezzo palesemente sbagliato / assurdo per quel tipo di prodotto (sconto >70%, oppure prezzo irrisorio rispetto al valore reale). Usalo solo quando è davvero eclatante.

Regole:
- "title": riformula in italiano corretto e conciso (max 14 parole) dicendo COS'È davvero QUESTO prodotto (dispositivo? accessorio? confezione multipla? gioco?). Niente maiuscolo urlato, niente keyword spam.
- Prezzi: estrai currentPrice e originalPrice come numeri in euro (punto decimale). Se un valore non c'è, null.
- discountPct: intero 0-100. Se non calcolabile, null.
- "isProduct": false solo se l'ITEM non è un vero prodotto acquistabile (sondaggio, pubblicità del canale, testo troppo confuso).
- "reason": una frase breve sul perché è interessante o perché sembra un errore.

Rispondi SOLO con un array JSON, un oggetto per ITEM:
[{"idx": <numero ITEM>, "isProduct": true, "category": "tecnologia", "title": "...", "currentPrice": 12.99, "originalPrice": 49.99, "discountPct": 74, "severity": "errore_clamoroso", "reason": "..."}]

ITEMS:
${list}`;

  const txt = await rawCall({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  });
  let arr;
  try { arr = parseJson(txt); } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [arr];
  const byIdx = new Map();
  for (const r of arr) {
    if (r && typeof r.idx === 'number') {
      if (!CATS.includes(r.category)) r.category = 'altro';
      if (!['normale', 'forte', 'errore', 'errore_clamoroso'].includes(r.severity)) r.severity = 'normale';
      byIdx.set(r.idx, r);
    }
  }
  return byIdx;
}

async function interpretCategories(text) {
  const prompt = `L'utente di un bot di offerte descrive a parole sue su quali categorie vuole ricevere avvisi.
Categorie interne valide (usa ESATTAMENTE questi nomi): tecnologia, casa, console_videogiochi, altro.
- "tecnologia" = informatica, PC, componenti, elettronica di consumo, audio/cuffie, smartphone, TV, fotografia, domotica, smartwatch, stampanti, SSD/hard disk, power bank.
- "casa" = ELETTRODOMESTICI (grandi e piccoli: frigo, lavatrice, forno, friggitrice ad aria, aspirapolvere, robot), cucina e pentole, pulizia, arredamento, giardino, fai-da-te, illuminazione, casalinghi.
- "console_videogiochi" = console, videogiochi, controller, accessori gaming, sedie gaming, visori VR.
- "altro" = moda, bellezza e cura persona, alimentari e bevande, sport, giocattoli, libri, animali, salute/parafarmacia, auto e moto, cancelleria.
Nota: "elettrodomestici" e "roba per la casa" => "casa" (NON "tecnologia"). "informatica" => "tecnologia".
Se l'utente dice "tutto"/"tutte"/"qualsiasi cosa"/"sempre" => tutte e quattro.

Messaggio utente: """${text}"""

Rispondi SOLO JSON: {"categories": ["..."], "spiegazione": "breve frase in italiano su cosa hai capito"}`;
  const txt = await rawCall({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  const j = parseJson(txt);
  let cats = Array.isArray(j.categories) ? j.categories.filter((c) => CATS.includes(c)) : [];
  cats = [...new Set(cats)];
  return { categories: cats, spiegazione: j.spiegazione || '' };
}

module.exports = { init, analyzeDeals, interpretCategories, CATS };
