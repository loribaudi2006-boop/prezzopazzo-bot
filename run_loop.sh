#!/usr/bin/env bash
set -uo pipefail

DURATION_SECONDS=${DURATION_SECONDS:-21000}          # ~5h50m
COMMIT_INTERVAL_SECONDS=${COMMIT_INTERVAL_SECONDS:-600}

echo "Avvio PrezzoPazzoBot per ${DURATION_SECONDS}s..."

DURATION_SECONDS=$DURATION_SECONDS node bot_loop.js &
BOT_PID=$!

DURATION_SECONDS=$DURATION_SECONDS node scan_loop.js &
SCAN_PID=$!

commit_data() {
  if ! git diff --quiet -- data/ || ! git diff --cached --quiet -- data/; then
    git add data/
    git -c user.email="bot@prezzopazzo" -c user.name="PrezzoPazzoBot" commit -m "sync stato bot" >/dev/null 2>&1
    git push >/dev/null 2>&1 || echo "push fallito, riprovo al prossimo ciclo"
  fi
}

END_TIME=$((SECONDS + DURATION_SECONDS))
while [ $SECONDS -lt $END_TIME ]; do
  sleep "$COMMIT_INTERVAL_SECONDS"
  commit_data
  # se entrambi i processi sono morti, esci subito
  kill -0 $BOT_PID 2>/dev/null || kill -0 $SCAN_PID 2>/dev/null || break
done

wait $BOT_PID 2>/dev/null
wait $SCAN_PID 2>/dev/null
commit_data
echo "Ciclo terminato."
