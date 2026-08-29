'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decodeEntities(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#33;/g, '!')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ASIN pulito da un URL Amazon (o link corto già risolto)
function extractAsin(url) {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)
    || url.match(/[?&]asin=([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

function cleanAmazonUrl(url) {
  const asin = extractAsin(url);
  if (asin) return `https://www.amazon.it/dp/${asin}`;
  return null;
}

async function fetchChannel(handle, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://t.me/s/${encodeURIComponent(handle)}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return parseChannel(handle, html);
  } finally {
    clearTimeout(t);
  }
}

const ASIN_IN_TEXT = /(?:\/dp\/|\/gp\/product\/|\bASIN[:\s]*)([A-Z0-9]{10})\b/g;

function asinsInText(s) {
  const out = [];
  let m;
  ASIN_IN_TEXT.lastIndex = 0;
  while ((m = ASIN_IN_TEXT.exec(s))) out.push(m[1].toUpperCase());
  return out;
}

// Divide il testo di un messaggio nei singoli prodotti.
// - 1 solo asin  -> 1 candidato con tutto il testo e la foto del post.
// - piu' asin    -> 1 candidato per asin, testo = il suo paragrafo,
//                   NIENTE foto (la foto del post è di un solo prodotto: meglio
//                   nessuna foto che quella sbagliata).
function splitProducts(text, asins, postImage) {
  const uniq = [...new Set(asins)];
  if (uniq.length <= 1) {
    return [{ asin: uniq[0] || null, text: text || '', image: pickBodyImage(text, postImage) }];
  }
  const segments = (text || '').split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  const buckets = [];
  let current = null;
  for (const seg of segments) {
    const found = asinsInText(seg);
    if (found.length) {
      current = { asin: found[0], text: seg, image: pickBodyImage(seg, null) };
      buckets.push(current);
    } else if (current) {
      current.text = `${current.text}\n\n${seg}`.trim();
    }
  }
  // asin visti nei link ma non agganciati a un paragrafo: candidato minimale
  for (const a of uniq) {
    if (!buckets.some((b) => b.asin === a)) buckets.push({ asin: a, text: text || '', image: null });
  }
  return buckets;
}

function pickBodyImage(scopeText, fallback) {
  if (scopeText) {
    const m = scopeText.match(/https?:\/\/[a-z0-9.-]*media-amazon\.com\/images\/I\/[A-Za-z0-9_.+-]+\.(?:jpg|jpeg|png)/i);
    if (m) return m[0];
  }
  return fallback || null;
}

function parseChannel(handle, html) {
  const titleM = html.match(/<meta property="og:title" content="([^"]*)"/);
  const channelTitle = titleM ? decodeEntities(titleM[1]) : handle;

  const out = [];
  const blocks = html.split('<div class="tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const idM = b.match(/data-post="([^"]+)"/);
    if (!idM) continue;
    const postId = idM[1]; // es. "tecnofferte/12345"

    const timeM = b.match(/<time[^>]*datetime="([^"]+)"/);
    const dateIso = timeM ? timeM[1] : null;

    const textM = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_(?:footer|reply_markup)|<\/div>)/);
    const rawText = textM ? textM[1] : '';
    const text = decodeEntities(rawText);

    // link Amazon nel corpo
    const hrefs = [...b.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    const amazonUrls = [];
    for (const h of hrefs) {
      if (/(?:amazon\.[a-z.]+|amzn\.to|amzn\.eu|amzn\.com)/i.test(h) && !/media-amazon\.com/i.test(h)) {
        amazonUrls.push(h);
      }
    }
    const asins = [...new Set(amazonUrls.map(extractAsin).filter(Boolean))];

    // immagine prodotto: 1) foto allegata al post (CDN Telegram), 2) fallback
    // sull'immagine Amazon linkata nel corpo del messaggio.
    let image = null;
    const photoM = b.match(/tgme_widget_message_photo_wrap[^"]*"[^>]*?background-image:url\('([^']+)'\)/);
    if (photoM && !/tgme_widget_message_video/.test(b.slice(0, photoM.index))) {
      image = photoM[1].replace(/&amp;/g, '&');
    }
    if (!image) {
      const amzImg = b.match(/https?:\/\/[a-z0-9.-]*media-amazon\.com\/images\/I\/[A-Za-z0-9_.+-]+\.(?:jpg|jpeg|png)/i);
      if (amzImg) image = amzImg[0].replace(/&amp;/g, '&');
    }

    if (!asins.length) continue;

    // Un messaggio può contenere più prodotti: separali in "candidati", ognuno
    // col SUO asin e col SUO pezzo di testo, così titolo/prezzo/link/foto
    // restano sempre coerenti tra loro.
    const products = splitProducts(text, asins, image);

    out.push({
      key: postId,
      channel: handle,
      channelTitle,
      dateIso,
      ts: dateIso ? Date.parse(dateIso) : Date.now(),
      text,
      amazonUrls,
      asins,
      firstAsin: asins[0] || null,
      image,
      products,
      url: `https://t.me/${postId}`,
    });
  }
  return { channelTitle, messages: out };
}

module.exports = { fetchChannel, parseChannel, cleanAmazonUrl, extractAsin, decodeEntities };
