/**
 * login.js
 * Abre o TikTok em um browser real (headed) para você fazer login manualmente.
 * Salva sessão (cookies) em auth/session.json E popula o perfil persistente
 * em auth/chrome-profile — ambos usados pelo index.js nas próximas execuções.
 *
 * Execute UMA VEZ:
 *   node login.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { getRandomUserAgent, log } = require('./src/utils');

const SESSION_PATH  = path.join(__dirname, 'auth', 'session.json');
const USER_DATA_DIR = path.join(__dirname, 'auth', 'chrome-profile');

async function main() {
  log('Iniciando browser para login manual no TikTok...');
  log('Faça login normalmente. O script aguarda você terminar.');
  log('Quando estiver na tela inicial do TikTok após o login, pressione ENTER no terminal.\n');

  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  // Usa perfil persistente para que o login fique gravado no Chrome Profile
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    userAgent: getRandomUserAgent(),
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768',
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });

  log('Browser aberto. Faça login no TikTok e depois pressione ENTER aqui...');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', () => resolve());
  });

  // Salva cookies em session.json como backup
  await context.storageState({ path: SESSION_PATH });
  log(`Sessão (cookies) salva em: ${SESSION_PATH}`);
  log(`Perfil Chrome salvo em: ${USER_DATA_DIR}`);

  await context.close();
  log('\nPronto! Agora rode: node index.js');
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
