# ✈️ Rastreador de Passagens — POA → EUA

Monitora automaticamente os preços da **Smiles** (GOL) para Porto Alegre → Miami,
Orlando, Chicago e Atlanta, em todas as modalidades — **só milhas, milhas Clube
Smiles, milhas + dinheiro e só dinheiro** — e avisa no **Telegram** quando
aparece uma oportunidade.

## Como funciona

1. A cada execução (4× ao dia via GitHub Actions), um navegador automatizado
   (Playwright + Chrome) abre o site da Smiles, interage com o formulário de
   busca como um usuário real (isso valida a sessão no anti-bot) e então varre
   as datas configuradas interceptando as respostas da API que o próprio site
   dispara.
2. As idas são varridas de 2 em 2 dias entre 20/07/2026 e 30/10/2026, com volta
   pareada (+23 dias). Os melhores combos ida+volta com duração de 20–27 dias
   são montados combinando os preços por trecho.
3. Cada combo é comparado com o histórico (`data/state.json`) e com os tetos do
   `config.json`. Melhorou ou ficou abaixo do teto → **alerta no Telegram**.
   Além disso, um **resumo diário** é enviado na primeira execução após as 08h.

## Configuração

Edite o `config.json` para mudar rotas, janela de datas, duração da viagem ou
os tetos de alerta:

| Campo | Significado |
|---|---|
| `routes` | Pares origem/destino monitorados |
| `departureWindow` | Janela de datas de ida |
| `tripLengthDays` | Duração mínima/máxima da viagem |
| `scanStepDays` | Varre a cada N dias (2 = dias alternados) |
| `alerts.maxMilesRoundTrip` | Teto de milhas (ida+volta, por pessoa) para alertar |
| `alerts.maxCashRoundTrip` | Teto em R$ (ida+volta, por pessoa) para alertar |

## Segredos necessários (GitHub → Settings → Secrets → Actions)

- `TELEGRAM_BOT_TOKEN` — token do bot criado no @BotFather
- `TELEGRAM_CHAT_ID` — seu chat id (fale com o bot e veja em `getUpdates`)

## Rodar localmente

```powershell
npm install
npx playwright install chrome
$env:HEADFUL='1'                  # janela visível (headless não passa no anti-bot)
$env:SCAN_LIMIT='3'               # opcional: limita datas por rota (teste)
$env:SCAN_ROUTE='POA-MIA'         # opcional: só uma rota (teste)
$env:FORCE_DIGEST='1'             # opcional: força o resumo no Telegram
node src/scan.mjs
```

## Avisos

- Uso pessoal e de baixa frequência. O site da Smiles pode mudar e quebrar o
  rastreador — se os alertas pararem, verifique a aba Actions.
- Preços por pessoa; taxas de embarque indicadas separadamente quando houver.
