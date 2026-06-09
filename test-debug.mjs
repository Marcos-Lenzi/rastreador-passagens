import { openSmilesSession, searchPageUrl } from './src/smiles.mjs';

const headful = process.env.HEADFUL === '1';
const { browser, page } = await openSmilesSession({ headful });
console.log('sessão aberta');

const q = { origin: 'POA', destination: 'MIA', departureDate: '2026-07-20', returnDate: '2026-08-12' };
const url = searchPageUrl(q, { adults: 1 });

const respPromise = page
  .waitForResponse((r) => r.url().includes('/v1/airlines/search'), { timeout: 90000 })
  .catch(() => null);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// aceita o banner de cookies se aparecer nesta página
const aceitar = page.getByRole('button', { name: 'Aceitar', exact: true });
await aceitar.click({ timeout: 10000 }).then(() => console.log('banner aceito na página de busca')).catch(() => console.log('sem banner'));

// simula presença humana
for (let i = 0; i < 4; i++) {
  await page.mouse.move(300 + Math.random() * 600, 200 + Math.random() * 300, { steps: 8 });
  await page.waitForTimeout(400);
}

const resp = await respPromise;
console.log('resposta da API?', resp ? resp.status() : 'NÃO VEIO');
if (resp && resp.ok()) {
  const data = await resp.json();
  const segs = data.requestedFlightSegmentList || [];
  console.log('voos ida:', segs[0]?.flightList?.length, '| voos volta:', segs[1]?.flightList?.length);
}
await page.screenshot({ path: 'debug-2.png' });
await browser.close();
