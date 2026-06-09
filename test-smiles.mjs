// Teste: a API da Smiles responde a chamadas diretas (sem navegador)?
const url = new URL('https://api-air-flightsearch-green.smiles.com.br/v1/airlines/search');
url.search = new URLSearchParams({
  cabin: 'ALL',
  originAirportCode: 'POA',
  destinationAirportCode: 'MIA',
  departureDate: '2026-07-20',
  returnDate: '2026-08-12',
  memberNumber: '',
  adults: '1',
  children: '0',
  infants: '0',
  forceCongener: 'false',
  cookies: '_gid=undefined;',
}).toString();

const res = await fetch(url, {
  headers: {
    accept: 'application/json, text/plain, */*',
    channel: 'WEB',
    'x-api-key': 'aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw',
    referer: 'https://www.smiles.com.br/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  },
});

console.log('HTTP', res.status);
const text = await res.text();
if (res.ok) {
  const data = JSON.parse(text);
  const seg = data.requestedFlightSegmentList?.[0];
  console.log('Voos encontrados (ida):', seg?.flightList?.length ?? 0);
  const cheapest = (seg?.flightList ?? [])
    .map((f) => {
      const fare = (f.fareList ?? []).find((x) => x.type === 'SMILES_CLUB') ?? (f.fareList ?? [])[0];
      return { miles: fare?.miles, money: fare?.money, stops: f.stops, dep: f.departure?.date };
    })
    .sort((a, b) => (a.miles ?? 9e9) - (b.miles ?? 9e9))[0];
  console.log('Mais barato:', JSON.stringify(cheapest));
} else {
  console.log(text.slice(0, 500));
}
