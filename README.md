# PrezzoPazzoBot

Bot Telegram che segnala **errori di prezzo** e **maxi-sconti su Amazon.it**.

## Come funziona

1. `scan_loop.js` legge ogni ~90 s le **anteprime web pubbliche** (`t.me/s/<canale>`) di alcuni canali Telegram di offerte (nessun login, nessun userbot: sono pagine pubbliche ufficiali).
2. Per ogni nuovo messaggio con un prodotto Amazon, **Gemini** (`gemini-flash-lite`, chiavi in rotazione) estrae: categoria, titolo chiaro e breve in italiano, prezzo attuale/originale, sconto %, e un livello di gravità (`normale` / `forte` / `errore` / `errore_clamoroso`).
3. La notifica viene inviata a ogni iscritto in base alle sue **categorie** e alla sua **soglia** (`clamorosi` = solo errori grossi, `tutto` = tutte le occasioni). Gli errori di prezzo arrivano con notifica sonora.
4. `bot_loop.js` gestisce i comandi in chat: `/categorie`, `/soglia`, `/stato`, `/pausa`, `/riprendi`, `/help`.

## Fonte dati

Canali in `config.json` → `channels`. Fonte modulare: per aggiungerne uno basta metterne l'handle pubblico in quella lista.

## Hosting

GitHub Actions: un job (`bot.yml`, `run_loop.sh`) gira ~5h50m e si concatena; `watchdog.yml` lo rilancia se GitHub salta il cron. Lo stato (`data/*.json`) viene committato ogni 10 min.

### Secret richiesti

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`

## Uso locale

```bash
cp .env.example .env   # e compila
npm run scan:once -- --dry   # prova la pipeline senza inviare
npm run bot                  # ascolta i comandi
npm run scan                 # scansione continua
```
