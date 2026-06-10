// Rastreador de passagens POA → EUA (Smiles: milhas, milhas+dinheiro e dinheiro)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSmilesSession, warmupSearch, searchAll, searchPageUrl } from './smiles.mjs';
import { sendTelegram } from './telegram.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// carrega .env local (token do Telegram etc.) sem dependências externas
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const statePath = path.join(root, 'data', 'state.json');
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { bestEver: {}, lastAlerted: {}, lastDigestDate: null };

const fmtMiles = (n) => n.toLocaleString('pt-BR');
const fmtBRL = (n) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (iso) => iso.split('-').reverse().join('/');

function* dateRange(startIso, endIso, stepDays = 1) {
  const d = new Date(startIso + 'T12:00:00Z');
  const end = new Date(endIso + 'T12:00:00Z');
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + stepDays);
  }
}
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// custo estimado em R$ para ranquear modalidades diferentes entre si
const mileCost = cfg.estimatedMileCostPer1000BRL / 1000;
const costBRL = (rec) => (rec ? rec.miles * mileCost + rec.money + rec.tax : Infinity);

function buildQueries() {
  const onlyRoute = process.env.SCAN_ROUTE; // ex.: POA-MIA (para testes)
  const limit = process.env.SCAN_LIMIT ? parseInt(process.env.SCAN_LIMIT, 10) : Infinity;
  const queries = [];
  for (const r of cfg.routes) {
    if (onlyRoute && `${r.origin}-${r.destination}` !== onlyRoute) continue;
    let n = 0;
    for (const dep of dateRange(cfg.departureWindow.start, cfg.departureWindow.end, cfg.scanStepDays ?? 2)) {
      if (n++ >= limit) break;
      queries.push({
        origin: r.origin,
        destination: r.destination,
        departureDate: dep,
        returnDate: addDays(dep, cfg.returnOffsetDays),
      });
    }
  }
  return queries;
}

// Junta os resultados em mapas por rota/direção/data e monta os melhores combos
function buildCombos(results) {
  const routes = {};
  for (const res of results) {
    if (!res || res.error) continue;
    const key = `${res.origin}-${res.destination}`;
    routes[key] ??= { out: {}, inb: {} };
    if (res.outbound && Object.keys(res.outbound).length) routes[key].out[res.departureDate] = res.outbound;
    if (res.inbound && Object.keys(res.inbound).length) routes[key].inb[res.returnDate] = res.inbound;
  }

  const categories = {
    SMILES: 'Só milhas',
    SMILES_CLUB: 'Milhas Clube Smiles',
    SMILES_MONEY: 'Milhas + dinheiro',
    MONEY: 'Só dinheiro',
  };

  const combos = {};
  for (const [routeKey, { out, inb }] of Object.entries(routes)) {
    combos[routeKey] = {};
    for (const cat of Object.keys(categories)) {
      let best = null;
      for (const [depDate, fares] of Object.entries(out)) {
        const o = fares[cat];
        if (!o) continue;
        for (let len = cfg.tripLengthDays.min; len <= cfg.tripLengthDays.max; len++) {
          const retDate = addDays(depDate, len);
          const i = inb[retDate]?.[cat];
          if (!i) continue;
          const cand = {
            cat,
            label: categories[cat],
            depDate,
            retDate,
            miles: o.miles + i.miles,
            money: o.money + i.money,
            tax: o.tax + i.tax,
            out: o,
            inb: i,
          };
          cand.estBRL = costBRL(o) + costBRL(i);
          if (!best || cand.estBRL < best.estBRL) best = cand;
        }
      }
      if (best) combos[routeKey][cat] = best;
    }
  }
  return combos;
}

function comboLine(c) {
  const parts = [];
  if (c.miles) parts.push(`<b>${fmtMiles(c.miles)} milhas</b>`);
  if (c.money) parts.push(`<b>${fmtBRL(c.money)}</b>`);
  if (c.tax) parts.push(`+ ${fmtBRL(c.tax)} taxas`);
  return parts.join(' + ').replace('</b> + +', '</b> +');
}

function comboDetails(c) {
  const leg = (r) => {
    const det = [];
    if (r.miles) det.push(fmtMiles(r.miles) + ' mi');
    if (r.money) det.push(fmtBRL(r.money));
    det.push(r.stops === 0 ? 'direto' : `${r.stops} parada${r.stops > 1 ? 's' : ''}`);
    return det.join(', ');
  };
  return `   ↗ Ida ${fmtDate(c.depDate)} (${leg(c.out)})\n   ↘ Volta ${fmtDate(c.retDate)} (${leg(c.inb)})`;
}

function checkAlertsAndDigest(combos, scanStats) {
  const a = cfg.alerts;
  const now = new Date().toISOString();
  const alerts = [];

  for (const [routeKey, cats] of Object.entries(combos)) {
    const route = cfg.routes.find((r) => `${r.origin}-${r.destination}` === routeKey);
    for (const [cat, combo] of Object.entries(cats)) {
      const key = `${routeKey}|${cat}`;
      const metric = cat === 'MONEY' ? combo.money : combo.miles;
      const prevBest = state.bestEver[key];

      const threshold =
        cat === 'MONEY' ? a.maxCashRoundTrip : cat === 'SMILES_CLUB' ? a.maxClubMilesRoundTrip : cat === 'SMILES' ? a.maxMilesRoundTrip : null;
      const underThreshold = threshold != null && metric <= threshold;
      const isImprovement = prevBest && metric <= prevBest.metric * a.improvementFactor;
      const isFirstSeen = !prevBest;

      if (!prevBest || metric < prevBest.metric) {
        state.bestEver[key] = { metric, estBRL: combo.estBRL, depDate: combo.depDate, retDate: combo.retDate, at: now };
      }

      if (underThreshold || isImprovement) {
        const last = state.lastAlerted[key];
        const improvedSinceLastAlert = !last || metric <= last.metric * a.improvementFactor;
        const staleAlert = last && (Date.now() - new Date(last.at).getTime()) / 864e5 >= a.realertAfterDays;
        if (improvedSinceLastAlert || (underThreshold && staleAlert)) {
          state.lastAlerted[key] = { metric, at: now };
          alerts.push({ routeKey, route, combo, isFirstSeen });
        }
      }
    }
  }

  // resumo diário (no primeiro run após 08:00 de Brasília)
  const brtNow = new Date(Date.now() - 3 * 3600e3);
  const brtDate = brtNow.toISOString().slice(0, 10);
  const digestDue = state.lastDigestDate !== brtDate && brtNow.getUTCHours() >= 8;

  return { alerts, digestDue, brtDate, scanStats };
}

function alertMessage({ route, combo }) {
  const url = searchPageUrl(
    { origin: route.origin, destination: route.destination, departureDate: combo.depDate, returnDate: combo.retDate },
    cfg.passengers
  );
  return (
    `🚨 <b>OPORTUNIDADE — ${route.label}</b>\n\n` +
    `💺 ${combo.label} (ida e volta, por pessoa):\n` +
    `${comboLine(combo)}\n` +
    `${comboDetails(combo)}\n\n` +
    `🔗 <a href="${url}">Abrir essa busca na Smiles</a>`
  );
}

function digestMessage(combos) {
  let msg = `📋 <b>Resumo diário — melhores preços atuais</b>\n(ida e volta, por pessoa, viagens de ${cfg.tripLengthDays.min} a ${cfg.tripLengthDays.max} dias)\n`;
  for (const [routeKey, cats] of Object.entries(combos)) {
    const route = cfg.routes.find((r) => `${r.origin}-${r.destination}` === routeKey);
    msg += `\n✈️ <b>${route?.label ?? routeKey}</b>\n`;
    const order = ['SMILES_CLUB', 'SMILES', 'SMILES_MONEY', 'MONEY'];
    for (const cat of order) {
      const c = cats[cat];
      if (!c) continue;
      msg += `• ${c.label}: ${comboLine(c)} (${fmtDate(c.depDate)} → ${fmtDate(c.retDate)})\n`;
    }
  }
  return msg;
}

async function main() {
  const queries = buildQueries();
  console.log(`Consultas a fazer: ${queries.length}`);
  const headful = process.env.HEADFUL === '1';
  const { browser, page } = await openSmilesSession({ headful });
  try {
    // primeira busca pelo formulário, como usuário real — valida a sessão no anti-bot
    const warm = await warmupSearch(page).catch((e) => ({ completed: false, error: String(e.message).slice(0, 120) }));
    console.log('Warmup:', warm.completed ? `ok (HTTP ${warm.status})` : `incompleto${warm.error ? ' — ' + warm.error : ''} (a interação já conta)`);

    let done = 0;
    let results = await searchAll(page, queries, cfg.passengers, {
      onResult: (r, i, total) => {
        done++;
        const tag = r.error ? `ERRO ${r.error}` : 'ok';
        if (r.error || done % 10 === 0) console.log(`[${done}/${total}] ${r.origin}-${r.destination} ${r.departureDate}: ${tag}`);
      },
    });

    // re-tenta uma vez as que falharam
    const failedQueries = results.filter((r) => r.error).map(({ error, outbound, inbound, ...q }) => q);
    if (failedQueries.length && failedQueries.length < results.length) {
      console.log(`Re-tentando ${failedQueries.length} consultas que falharam…`);
      const retry = await searchAll(page, failedQueries, cfg.passengers, {});
      const byKey = new Map(retry.map((r) => [`${r.origin}-${r.destination}-${r.departureDate}`, r]));
      results = results.map((r) => (r.error ? byKey.get(`${r.origin}-${r.destination}-${r.departureDate}`) ?? r : r));
    }

    const okCount = results.filter((r) => !r.error).length;
    console.log(`Total: ${okCount}/${results.length} consultas com sucesso`);
    if (okCount === 0) {
      await sendTelegram('⚠️ Rastreador de passagens: todas as consultas à Smiles falharam neste ciclo. Pode ser bloqueio temporário ou mudança no site.');
      throw new Error('Nenhuma consulta teve sucesso');
    }

    const combos = buildCombos(results);
    const { alerts, digestDue, brtDate } = checkAlertsAndDigest(combos, { okCount, total: results.length });

    for (const alert of alerts) {
      console.log('ALERTA:', alert.routeKey, alert.combo.cat, alert.combo.miles || alert.combo.money);
      await sendTelegram(alertMessage(alert));
    }

    if (digestDue || process.env.FORCE_DIGEST === '1') {
      await sendTelegram(digestMessage(combos));
      state.lastDigestDate = brtDate;
    }

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`Pronto. ${alerts.length} alerta(s) enviado(s).`);
  } finally {
    await browser.close();
  }
}

main().catch(async (e) => {
  console.error(e);
  await sendTelegram('⚠️ Rastreador de passagens: a varredura falhou — ' + String(e.message).slice(0, 200)).catch(() => {});
  process.exit(1);
});
