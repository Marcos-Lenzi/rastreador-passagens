// Consulta preços na Smiles dirigindo o próprio site (o site faz a chamada à
// API e nós interceptamos a resposta — passa pela proteção anti-bot).
import { chromium } from 'playwright';

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
  // channel:'chrome' usa o Google Chrome real instalado na máquina — a
  // identidade do navegador fica 100% consistente para o anti-bot.
  const browser = await chromium.launch({
    headless: !headful,
    channel: process.env.BROWSER_CHANNEL || 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // janela fora da tela: roda "visível" para o anti-bot sem incomodar o usuário
      ...(process.env.OFFSCREEN === '1' ? ['--window-position=-32000,-32000'] : []),
    ],
  });
  const context = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  // Interceptar requisições (page.route) pode quebrar o CORS das chamadas da
  // própria página, então só bloqueamos recursos se BLOCK_ASSETS=1.
  if (process.env.BLOCK_ASSETS === '1') {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'media' || type === 'font') return route.abort();
      return route.continue();
    });
  }

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

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Interage com o formulário de busca como um usuário real. Isso valida a
 * sessão no anti-bot (Akamai) — depois disso os deep-links funcionam.
 * Best-effort: completar a busca não é obrigatório; a interação é o que vale.
 */
export async function warmupSearch(page, { destCode = 'MIA' } = {}) {
  const form = page.locator('#DesktopFlightSearch-form-click');
  await form.waitFor({ timeout: 30000 });

  const origemBox = form.getByRole('textbox', { name: 'Origem' });
  await origemBox.click();
  await origemBox.pressSequentially('Porto Alegre', { delay: 80 });
  await page.waitForTimeout(2500);
  await page.getByText('Salgado Filho', { exact: false }).first().click();
  await page.waitForTimeout(800);

  const destinoBox = form.getByRole('textbox', { name: 'Destino' });
  await destinoBox.click();
  await destinoBox.pressSequentially(destCode, { delay: 100 });
  await page.waitForTimeout(2500);
  await page.locator('li:visible, [role="option"]:visible').filter({ hasText: destCode }).first().click();
  await page.waitForTimeout(800);

  // escolhe datas próximas que já estejam visíveis no calendário (1º dia
  // habilitado de cada mês visível) — o objetivo é interação, não a data em si
  await form.locator('#startDateId').click();
  await page.waitForTimeout(800);
  const enabledDays = page.locator('td[aria-label^="Choose"]:visible, td[aria-label*="Selected"]:visible');
  const count = await enabledDays.count();
  if (count > 1) {
    await enabledDays.nth(Math.min(5, count - 2)).click().catch(() => {});
    await page.waitForTimeout(600);
    const after = page.locator('td[aria-label^="Choose"]:visible');
    const n2 = await after.count();
    if (n2 > 6) await after.nth(6).click().catch(() => {});
    await page.waitForTimeout(600);
  }

  // tenta concluir a busca; se não der, a interação já validou a sessão
  const respPromise = page
    .waitForResponse((r) => r.url().includes('/v1/airlines/search'), { timeout: 60000 })
    .catch(() => null);
  try {
    await form.getByRole('button', { name: 'Buscar voos' }).click({ timeout: 10000 });
  } catch {
    await respPromise;
    return { completed: false };
  }
  const resp = await respPromise;
  return resp ? { completed: true, status: resp.status() } : { completed: false };
}

// Interação rica (mouse, scroll, hover) — mantém a sessão validada no anti-bot
export async function humanize(page, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const action = Math.random();
    try {
      if (action < 0.5) {
        await page.mouse.move(150 + Math.random() * 1000, 100 + Math.random() * 500, { steps: 8 + Math.floor(Math.random() * 12) });
      } else if (action < 0.8) {
        await page.mouse.wheel(0, Math.random() < 0.7 ? 200 + Math.random() * 400 : -(100 + Math.random() * 200));
      } else {
        const links = page.locator('a:visible, button:visible');
        const n = await links.count();
        if (n) await links.nth(Math.floor(Math.random() * n)).hover({ timeout: 1500 }).catch(() => {});
      }
    } catch {
      /* página pode ter navegado no meio — segue o baile */
    }
    await page.waitForTimeout(300 + Math.random() * 900);
  }
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
export async function searchOne(page, query, pax, { timeoutMs = 60000 } = {}) {
  const url = searchPageUrl(query, pax);
  // .catch aqui evita promessa órfã derrubando o processo (unhandled rejection)
  const respPromise = page
    .waitForResponse((r) => r.url().includes('/v1/airlines/search') && r.request().method() === 'GET', {
      timeout: timeoutMs,
    })
    .catch(() => null);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  } catch (e) {
    await respPromise;
    return { ...query, error: 'goto: ' + String(e && e.message ? e.message : e).slice(0, 100) };
  }
  try {
    const resp = await respPromise;
    if (!resp) return { ...query, error: 'timeout esperando a resposta da busca' };
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
 * Roda as buscas em sequência na MESMA página, com interação humanizada antes
 * de cada consulta (mantém a sessão validada). Na falha: re-interage e tenta
 * de novo; se acumular falhas seguidas, volta à home e refaz o warmup.
 */
export async function searchAll(page, queries, pax, { onResult, rewarmAfterFails = 3 } = {}) {
  const results = [];
  let consecutiveFails = 0;
  for (let i = 0; i < queries.length; i++) {
    await humanize(page, 4 + Math.random() * 3);
    let r = await searchOne(page, queries[i], pax, { timeoutMs: 60000 });
    if (r.error) {
      await humanize(page, 10 + Math.random() * 5);
      r = await searchOne(page, queries[i], pax, { timeoutMs: 60000 });
    }
    results.push(r);
    onResult?.(r, i, queries.length);
    if (i === 9 && results.every((x) => x.error))
      throw new Error('as 10 primeiras consultas falharam — abortando (IP/sessão provavelmente bloqueado)');
    consecutiveFails = r.error ? consecutiveFails + 1 : 0;
    if (consecutiveFails >= rewarmAfterFails) {
      console.log(`[smiles] ${consecutiveFails} falhas seguidas — refazendo o warmup…`);
      await page.goto('https://www.smiles.com.br/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.getByRole('button', { name: 'Aceitar', exact: true }).click({ timeout: 8000 }).catch(() => {});
      await warmupSearch(page).catch(() => {});
      consecutiveFails = 0;
    }
  }
  return results;
}
