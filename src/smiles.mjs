// Consulta preços na Smiles dirigindo o próprio site (o site faz a chamada à
// API e nós interceptamos a resposta — passa pela proteção anti-bot).
import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const epochBRT = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 3); // meia-noite de Brasília
};

export function searchPageUrl({ origin, destination, departureDate, returnDate }, pax = {}) {
  return (
    'https://www.smiles.com.br/mfe/emissao-passagem/?' +
    new URLSearchParams({
      adults: String(pax.adults ?? 1),
      cabin: 'ALL',
      children: String(pax.children ?? 0),
      departureDate: String(epochBRT(departureDate)),
      infants: String(pax.infants ?? 0),
      isElegible: 'false',
      isFlexibleDateChecked: 'false',
      ...(returnDate ? { returnDate: String(epochBRT(returnDate)) } : {}),
      searchType: 'g3',
      segments: '1',
      tripType: returnDate ? '1' : '2',
      originAirport: origin,
      originCity: '',
      originCountry: '',
      originAirportIsAny: 'false',
      destinationAirport: destination,
      destinCity: '',
      destinCountry: '',
      destinAirportIsAny: 'false',
      'novo-resultado-voos': 'true',
    })
  );
}

export async function openSmilesSession({ headful = false } = {}) {
  const browser = await chromium.launch({
    headless: !headful,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  // corta peso desnecessário, mas mantém todos os scripts (o sensor anti-bot precisa rodar)
  await page.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    if (/google-analytics|googletagmanager|doubleclick|facebook|hotjar|clarity|salesforce|chaordic|dynamicyield/i.test(url))
      return route.abort();
    return route.continue();
  });

  await page.goto('https://www.smiles.com.br/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page
    .getByRole('button', { name: 'Aceitar' })
    .click({ timeout: 8000 })
    .catch(() => {});
  // movimentos de mouse ajudam o sensor anti-bot a validar a sessão
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(200 + Math.random() * 800, 150 + Math.random() * 400, { steps: 10 });
    await page.waitForTimeout(300 + Math.random() * 400);
  }
  return { browser, context, page };
}

function summarizeSegment(seg) {
  const best = {};
  for (const f of seg.flightList || []) {
    for (const fare of f.fareList || []) {
      const miles = fare.miles || 0;
      const money = fare.money || 0;
      if (!miles && !money) continue;
      const rec = {
        miles,
        money,
        tax: parseFloat(fare.g3?.costTax || '0') || 0,
        stops: f.stops,
        durationH: (f.duration?.hours ?? 0) + (f.duration?.minutes ?? 0) / 60,
        dep: f.departure?.date,
        arr: f.arrival?.date,
        airline: f.airline?.code,
      };
      const cur = best[fare.type];
      const keyVal = (r) => (r.miles ? r.miles : Infinity) * 1e6 + r.money * 100 + r.tax;
      const cmp = fare.type === 'MONEY' ? (a, b) => a.money - b.money : (a, b) => keyVal(a) - keyVal(b);
      if (!cur || cmp(rec, cur) < 0) best[fare.type] = rec;
    }
  }
  return best;
}

/**
 * Executa uma busca navegando até a página de resultados do site e
 * interceptando a resposta da API que o próprio site dispara.
 */
export async function searchOne(page, query, pax, { timeoutMs = 75000 } = {}) {
  const url = searchPageUrl(query, pax);
  try {
    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/v1/airlines/search') && r.request().method() === 'GET',
      { timeout: timeoutMs }
    );
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const resp = await respPromise;
    if (!resp.ok()) return { ...query, error: 'HTTP ' + resp.status() };
    const data = await resp.json();
    const segs = data.requestedFlightSegmentList || [];
    return {
      ...query,
      outbound: segs[0] ? summarizeSegment(segs[0]) : null,
      inbound: segs[1] ? summarizeSegment(segs[1]) : null,
    };
  } catch (e) {
    return { ...query, error: String(e && e.message ? e.message : e).slice(0, 120) };
  }
}

/**
 * Roda uma lista de buscas em sequência, abrindo uma aba nova a cada N
 * consultas (o SPA da Smiles às vezes para de disparar buscas na mesma aba).
 */
export async function searchAll(context, queries, pax, { onResult, pauseMs = 2000, pageEvery = 1 } = {}) {
  const results = [];
  let page = null;
  for (let i = 0; i < queries.length; i++) {
    if (!page || i % pageEvery === 0) {
      if (page) await page.close().catch(() => {});
      page = await context.newPage();
    }
    const r = await searchOne(page, queries[i], pax);
    results.push(r);
    onResult?.(r, i, queries.length);
    await page.waitForTimeout(pauseMs + Math.random() * 1000);
  }
  if (page) await page.close().catch(() => {});
  return results;
}
