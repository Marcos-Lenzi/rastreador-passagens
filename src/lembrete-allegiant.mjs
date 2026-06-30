// Lembrete recorrente no Telegram para checar o preço da Allegiant (SFB ⇄ SBN).
// Não faz scraping (o site da Allegiant é protegido por Cloudflare) — apenas
// envia o link pronto do Google Flights, que cobre a Allegiant e tem alerta nativo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendTelegram } from './telegram.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const link =
  'https://www.google.com/travel/flights?q=flights%20from%20SFB%20to%20SBN%20on%202026-08-20%20returning%202026-09-14';

const msg =
  '✈️ <b>Hora de checar o preço — Allegiant Sanford (SFB) → South Bend (SBN)</b>\n\n' +
  '🗓️ Ida: quinta, 20/08\n' +
  '🗓️ Volta: 12, 13 ou 14/09 (flexível)\n\n' +
  `🔗 <a href="${link}">Abrir no Google Flights</a>\n\n` +
  '💡 Dicas:\n' +
  '• Use a <b>grade de datas</b> para comparar 12, 13 e 14/09 e achar a volta mais barata.\n' +
  '• Ative <b>"Acompanhar preços"</b> no Google para receber e-mail quando mudar.\n' +
  '• Referência: ida ~R$ 485 e ida+volta a partir de ~R$ 603 por pessoa (sem escalas).';

const ok = await sendTelegram(msg);
console.log(ok ? 'lembrete enviado' : 'falha ao enviar lembrete');
