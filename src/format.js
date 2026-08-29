'use strict';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function price(n) {
  if (n == null || isNaN(n)) return null;
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function discountDots(pct) {
  if (pct == null) return '';
  if (pct >= 70) return '🔴🔴🔴🔴';
  if (pct >= 50) return '🟠🟠🟠';
  if (pct >= 30) return '🟡🟡';
  return '🟢';
}

function timeAgo(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'ora';
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h fa`;
  return `${Math.round(h / 24)} g fa`;
}

const CAT_EMOJI = {
  tecnologia: '💻',
  casa: '🏠',
  console_videogiochi: '🎮',
  altro: '📦',
};

function severityHeader(sev) {
  if (sev === 'errore_clamoroso') return '🔴🔴🔴 <b>ERRORE DI PREZZO CLAMOROSO</b> 🔴🔴🔴\n\n';
  if (sev === 'errore') return '🚨 <b>ERRORE DI PREZZO</b>\n\n';
  if (sev === 'forte') return '🔥 <b>Offerta forte</b>\n\n';
  return '';
}

// deal: { category, title, currentPrice, originalPrice, discountPct, severity, reason }
// meta: { channelTitle, ts, amazonUrl, channelUrl }
function buildMessage(deal, meta) {
  let out = severityHeader(deal.severity);
  out += `${CAT_EMOJI[deal.category] || '📦'} <b>${esc(deal.title)}</b>\n\n`;

  const cur = price(deal.currentPrice);
  const orig = price(deal.originalPrice);
  if (cur && orig) out += `💰 <s>${esc(orig)}</s>  →  <b>${esc(cur)}</b>\n`;
  else if (cur) out += `💰 <b>${esc(cur)}</b>\n`;

  if (deal.discountPct != null) out += `📉 Sconto ${deal.discountPct}%  ${discountDots(deal.discountPct)}\n`;

  if (deal.reason) out += `\nℹ️ ${esc(deal.reason)}\n`;

  if (meta.amazonUrl) out += `\n🔗 ${esc(meta.amazonUrl)}\n`;
  out += `\n📢 ${esc(meta.channelTitle)} · ${timeAgo(meta.ts)}`;
  if (meta.channelUrl) out += ` · <a href="${esc(meta.channelUrl)}">post</a>`;
  return out;
}

module.exports = { buildMessage, discountDots, esc, price };
