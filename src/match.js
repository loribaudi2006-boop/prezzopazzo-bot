'use strict';

// Decide se un certo "deal" analizzato va notificato a un certo subscriber.
function shouldNotify(deal, sub, cfg) {
  if (!deal || deal.isProduct === false) return false;
  if (sub.paused) return false;
  if (!sub.categories.includes(deal.category)) return false;

  const sev = deal.severity;
  const pct = deal.discountPct;
  const isError = sev === 'errore' || sev === 'errore_clamoroso';

  if (sub.threshold === 'tutto') {
    if (isError || sev === 'forte') return true;
    return pct != null && pct >= cfg.tuttoMinDiscount;
  }
  // "clamorosi"
  if (isError) return true;
  return pct != null && pct >= cfg.hugeErrorDiscount;
}

function isSilent(deal) {
  return !(deal.severity === 'errore' || deal.severity === 'errore_clamoroso');
}

module.exports = { shouldNotify, isSilent };
