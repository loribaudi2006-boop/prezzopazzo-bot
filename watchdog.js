// Watchdog: job GitHub Actions minuscolo e indipendente (~ogni 15 min + a fine di
// ogni ciclo di bot.yml). Verifica che bot.yml sia attivo; se e' fermo da troppo
// tempo manda un avviso Telegram e prova a riavviarlo.
//
// Env:
//   GH_TOKEN, GITHUB_REPOSITORY (auto), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//   DEFAULT_BRANCH (default main), BOT_WORKFLOW (default bot.yml), GAP_MINUTES (default 20)

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const WORKFLOW = process.env.BOT_WORKFLOW || "bot.yml";
const BRANCH = process.env.DEFAULT_BRANCH || "main";
const GAP_MIN = Number(process.env.GAP_MINUTES || 20);
const name = repo ? repo.split("/")[1] : "bot";

async function gh(pathname, opts = {}) {
  return fetch(`https://api.github.com/repos/${repo}/${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
}

async function tg(text) {
  if (!tgToken || !chatId) { console.log("Telegram non configurato, salto."); return; }
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("Invio Telegram fallito:", res.status, await res.text());
}

(async () => {
  const res = await gh(`actions/workflows/${WORKFLOW}/runs?per_page=5`);
  if (!res.ok) { console.error("API runs fallita:", res.status); process.exit(0); }
  const runs = (await res.json()).workflow_runs || [];
  if (!runs.length) { console.log("Nessun run per", WORKFLOW); process.exit(0); }

  const latest = runs[0];
  console.log(`Ultimo run ${latest.id}: status=${latest.status} conclusion=${latest.conclusion} updated=${latest.updated_at}`);

  if (latest.status === "in_progress" || latest.status === "queued") {
    console.log("Bot attivo. Ok."); process.exit(0);
  }

  const ageMin = (Date.now() - new Date(latest.updated_at).getTime()) / 60000;
  const prev = runs[1];
  const twoFails =
    latest.conclusion && latest.conclusion !== "success" &&
    prev && prev.conclusion && prev.conclusion !== "success";

  if (twoFails) {
    await tg(`❌ <b>${name}</b>: gli ultimi due job sono falliti (ultimo: <code>${latest.conclusion}</code>). Non riavvio in automatico per evitare loop di errori. Log:\n${latest.html_url}`);
    process.exit(0);
  }

  if (ageMin < GAP_MIN) {
    console.log(`Job finito da ${ageMin.toFixed(0)} min: nella norma.`); process.exit(0);
  }

  const motivo = latest.conclusion === "success"
    ? "GitHub non ha avviato il job successivo"
    : `l'ultimo job si e' chiuso con esito "${latest.conclusion}"`;
  await tg(`⚠️ <b>${name}</b>: bot fermo da ~${Math.round(ageMin)} min (${motivo}). Provo a riavviarlo.`);

  const disp = await gh(`actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (disp.ok || disp.status === 204) {
    console.log("Riavvio richiesto.");
    await tg(`✅ <b>${name}</b>: riavvio avviato.`);
  } else {
    console.error("Dispatch fallito:", disp.status, await disp.text());
    await tg(`❗ <b>${name}</b>: riavvio automatico fallito (errore ${disp.status}). Vai su GitHub → Actions → "${WORKFLOW}" → Run workflow.`);
  }
})().catch((e) => { console.error("Watchdog errore:", e); process.exit(0); });
