// Lembrete único no Telegram para reconferir os requisitos de viagem na Copa,
// ~2 semanas antes de cada trecho. Não faz scraping — só envia o checklist e o
// link da ferramenta oficial da Copa. REMINDER_LEG = 'ida' | 'volta'.
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

const copa = 'https://www.copaair.com/en-gs/travel-requirement/';
const leg = (process.env.REMINDER_LEG || 'ida').toLowerCase();

const msgIda =
  '🛫 <b>Faltam ~2 semanas para a IDA (19/08) — reconfira os requisitos</b>\n\n' +
  'Trajeto: Porto Alegre → Panamá (conexão) → EUA\n\n' +
  '✅ O que levar:\n' +
  '• Passaporte válido\n' +
  '• Visto americano (B-2) para entrar nos EUA\n' +
  '• Passagem de continuação (você já tem)\n\n' +
  '💉 Vacina de febre amarela: <b>não era exigida</b> (só conexão na área internacional do Panamá).\n\n' +
  `🔗 <a href="${copa}">Reconferir na ferramenta da Copa</a>\n` +
  '(Origem: Porto Alegre · Destino: sua cidade nos EUA · Nacionalidade/Residência: Brasil · Conexão: Panamá)';

const msgVolta =
  '🛬 <b>Faltam ~2 semanas para a VOLTA (15/09) — reconfira os requisitos</b>\n\n' +
  'Trajeto: EUA → Panamá (pernoite 24h, sai do aeroporto) → Porto Alegre\n\n' +
  '✅ Como você VAI ENTRAR no Panamá, tenha à mão:\n' +
  '• Passaporte válido por no mínimo <b>3 meses</b>\n' +
  '• Comprovante de fundos: ~<b>US$ 500 por pessoa</b> (extrato/carta do banco ou cartão de crédito internacional)\n' +
  '• <b>Reserva do hotel</b> (print da confirmação)\n' +
  '• Passagem de saída (segue para Porto Alegre)\n\n' +
  '💉 Vacina de febre amarela: <b>não era exigida</b> (você chega dos EUA, país sem risco).\n' +
  '🇧🇷 Reentrada no Brasil: sem vacina/visto.\n\n' +
  `🔗 <a href="${copa}">Reconferir na ferramenta da Copa</a>\n` +
  '(Origem: Orlando/EUA · Destino: Panamá · Nacionalidade/Residência: Brasil)';

const ok = await sendTelegram(leg === 'volta' ? msgVolta : msgIda);
console.log(ok ? `lembrete (${leg}) enviado` : `falha ao enviar lembrete (${leg})`);
