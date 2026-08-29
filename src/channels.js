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

    // immagine prodotto (utile ma non usata per l'invio)
    const imgM = b.match(/background-image:\s*url\('([^']+media-amazon[^']+)'\)/)
      || b.match(/<i class="tgme_widget_message_photo_wrap"[^>]*style="[^"]*url\('([^']+)'\)/);
    const image = imgM ? imgM[1].replace(/&amp;/g, '&') : null;

    if (!text && !asins.length) continue;

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
      url: `https://t.me/${postId}`,
    });
  }
  return { channelTitle, messages: out };
}

module.exports = { fetchChannel, parseChannel, cleanAmazonUrl, extractAsin, decodeEntities };
