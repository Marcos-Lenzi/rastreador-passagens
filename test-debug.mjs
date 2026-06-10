import { openSmilesSession, warmupSearch, searchOne } from './src/smiles.mjs';

const { browser, page } = await openSmilesSession({ headful: true });
console.log('>>> sessão aberta');
const warm = await warmupSearch(page).catch((e) => ({ completed: false, error: e.message }));
console.log('>>> warmup:', JSON.stringify(warm).slice(0, 80));

// interação rica: move, para, scroll, hover — como uma pessoa lendo a página
async function humanize(page, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const action = Math.random();
    if (action < 0.5) {
      await page.mouse.move(150 + Math.random() * 1000, 100 + Math.random() * 500, { steps: 8 + Math.floor(Math.random() * 12) });
    } else if (action < 0.8) {
      await page.mouse.wheel(0, Math.random() < 0.7 ? 200 + Math.random() * 400 : -(100 + Math.random() * 200));
    } else {
      const links = page.locator('a:visible, button:visible');
      const n = await links.count().catch(() => 0);
      if (n) await links.nth(Math.floor(Math.random() * n)).hover({ timeout: 1500 }).catch(() => {});
    }
    await page.waitForTimeout(300 + Math.random() * 900);
  }
}

const tests = [
  { origin: 'POA', destination: 'MIA', departureDate: '2026-07-24', returnDate: '2026-08-16' },
  { origin: 'POA', destination: 'MCO', departureDate: '2026-07-26', returnDate: '2026-08-18' },
  { origin: 'POA', destination: 'ATL', departureDate: '2026-08-12', returnDate: '2026-09-04' },
  { origin: 'POA', destination: 'MIA', departureDate: '2026-09-16', returnDate: '2026-10-09' },
  { origin: 'POA', destination: 'ORD', departureDate: '2026-09-20', returnDate: '2026-10-13' },
  { origin: 'POA', destination: 'MCO', departureDate: '2026-10-10', returnDate: '2026-11-02' },
];

let ok = 0, fail = 0;
for (const q of tests) {
  await humanize(page, 6 + Math.random() * 4);
  let r = await searchOne(page, q, { adults: 1 }, { timeoutMs: 90000 });
  if (r.error) {
    console.log(`>>> ${q.destination} ${q.departureDate}: falhou 1ª (${r.error.slice(0, 40)}), re-interagindo e tentando de novo…`);
    await humanize(page, 15);
    r = await searchOne(page, q, { adults: 1 }, { timeoutMs: 90000 });
  }
  if (r.error) { fail++; console.log(`>>> ${q.destination} ${q.departureDate}: ERRO ${r.error.slice(0, 60)}`); }
  else {
    ok++;
    const o = r.outbound ?? {};
    const best = o.SMILES ? o.SMILES.miles.toLocaleString() + ' mi' : 'R$ ' + o.MONEY?.money;
    console.log(`>>> ${q.destination} ${q.departureDate}: OK (ida ${best})`);
  }
}
console.log(`>>> RESULTADO: ${ok} ok, ${fail} falhas`);
await browser.close();
