'use strict';

let TOKEN = null;
function init(token) { TOKEN = token; }
function api(method) { return `https://api.telegram.org/bot${TOKEN}/${method}`; }

async function call(method, body, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) {
      const err = new Error(`Telegram ${method}: ${json.description || res.status}`);
      err.telegram = json;
      throw err;
    }
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

async function sendMessage(chatId, text, { silent = false, preview = false } = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: !preview,
    disable_notification: silent,
  });
}

const IMG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchImage(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': IMG_UA, Referer: 'https://t.me/' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 512 || buf.length > 8 * 1024 * 1024) return null;
    return { buf, ct };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function sendPhotoBytes(chatId, buf, ct, caption, { silent = false } = {}) {
  const ext = /png/i.test(ct) ? 'png' : 'jpg';
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('caption', caption);
  fd.append('parse_mode', 'HTML');
  fd.append('disable_notification', String(silent));
  fd.append('photo', new Blob([buf], { type: ct || 'image/jpeg' }), `p.${ext}`);
  const res = await fetch(api('sendPhoto'), { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`sendPhoto: ${json.description || res.status}`);
  return json.result;
}

// Prova con foto (scaricata e ricaricata come file); se qualcosa non va, testo.
async function sendDeal(chatId, text, photoUrl, opts = {}) {
  if (photoUrl && text.length <= 1024) {
    try {
      const img = await fetchImage(photoUrl);
      if (img) return await sendPhotoBytes(chatId, img.buf, img.ct, text, opts);
    } catch (e) {
      console.error(`[tg] invio foto fallito (${e.message}), ripiego su testo`);
    }
  }
  return sendMessage(chatId, text, { ...opts, preview: false });
}

async function getUpdates(offset, timeout) {
  return call('getUpdates', { offset, timeout, allowed_updates: ['message'] }, { timeoutMs: (timeout + 10) * 1000 });
}

async function setMyCommands(commands) {
  return call('setMyCommands', { commands });
}

module.exports = { init, call, sendMessage, sendDeal, getUpdates, setMyCommands };
