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

async function getUpdates(offset, timeout) {
  return call('getUpdates', { offset, timeout, allowed_updates: ['message'] }, { timeoutMs: (timeout + 10) * 1000 });
}

async function setMyCommands(commands) {
  return call('setMyCommands', { commands });
}

module.exports = { init, call, sendMessage, getUpdates, setMyCommands };
