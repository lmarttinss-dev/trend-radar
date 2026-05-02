/**
 * scraper.js
 * Lógica principal de scraping de vídeos virais em páginas de hashtag do TikTok.
 *
 * Estratégias (em ordem de prioridade):
 *  1. Interceptação de rede — captura as respostas JSON da API interna do TikTok
 *     enquanto a página carrega. Mais confiável e menos sujeito a bot detection.
 *  2. __UNIVERSAL_DATA_FOR_REHYDRATION__ — objeto JS injetado pelo servidor.
 *  3. Scraping direto do DOM com seletores data-e2e como último recurso.
 */

const { randomDelay, log } = require('./utils');

// Máximo de scroll downs por página antes de parar
const MAX_SCROLLS = 8;

// Timeout padrão para aguardar elementos (ms)
const DEFAULT_TIMEOUT = 15000;

// Padrões de URL das APIs internas do TikTok que retornam listas de vídeos
const API_PATTERNS = [
  /tiktok\.com\/api\/challenge\/item_list/,
  /tiktok\.com\/api\/post\/item_list/,
  /tiktok\.com\/api\/recommend\/item_list/,
  /tiktok\.com\/api\/related\/item_list/,
];

// Seletores DOM do TikTok — data-e2e são mais estáveis que classes CSS ofuscadas
const SELECTORS = {
  videoList: '[data-e2e="challenge-item-list"]',
  videoItem: '[data-e2e="challenge-item"]',
  videoLink: 'a[href*="/video/"]',
  viewCount: '[data-e2e="video-views"], .video-count',
  description: '[data-e2e="video-desc"], .video-meta-caption',
};

/**
 * Injeta scripts no contexto da página para disfarçar o webdriver.
 * TikTok usa múltiplas heurísticas de detecção — cobrimos as principais aqui.
 */
async function applyStealthPatches(context) {
  await context.addInitScript(() => {
    // 1. Remove a flag que delata Playwright/Puppeteer
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // 2. Simula plugins instalados (browsers reais sempre têm)
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          { name: 'Chrome PDF Plugin' },
          { name: 'Chrome PDF Viewer' },
          { name: 'Native Client' },
        ];
        arr.item = (i) => arr[i];
        arr.namedItem = (n) => arr.find((p) => p.name === n);
        arr.refresh = () => {};
        return arr;
      },
    });

    // 3. Idiomas reais
    Object.defineProperty(navigator, 'languages', {
      get: () => ['pt-BR', 'pt', 'en-US', 'en'],
    });

    // 4. Hardware concurrency realista (não 1 como em headless)
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

    // 5. DeviceMemory realista
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // 6. Plataforma consistente
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

    // 7. Remove variáveis de automação do Chrome
    const keys = [
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      '__playwright',
      '__pw_manual',
    ];
    keys.forEach((k) => { try { delete window[k]; } catch (_) {} });

    // 8. Oculta flag de automação do Chrome DevTools Protocol
    if (window.chrome) {
      window.chrome.runtime = window.chrome.runtime || {};
    }

    // 9. Faz permissionQuery retornar 'granted' ao invés de 'prompt'
    //    (headless costuma retornar 'denied', o que é um sinal de bot)
    const origQuery = window.navigator.permissions?.query?.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: 'denied' })
          : origQuery(params);
    }
  });
}

/**
 * Detecta se a página exibe um desafio de CAPTCHA e, se sim, pausa
 * a execução aguardando o usuário resolver manualmente no browser.
 * Após o usuário pressionar ENTER, retorna e a extração continua normalmente.
 *
 * @param {import('playwright').Page} page
 */
async function waitForCaptchaIfNeeded(page) {
  const isCaptcha = await page.evaluate(() => {
    const body = document.body?.innerText?.toLowerCase() || '';
    const title = document.title?.toLowerCase() || '';
    return (
      // Seletores de CAPTCHA conhecidos do TikTok
      !!document.querySelector('[id*="captcha"], [class*="captcha"], [class*="verify"]') ||
      body.includes('verify') ||
      body.includes('captcha') ||
      body.includes('robot') ||
      title.includes('verify')
    );
  });

  if (!isCaptcha) return;

  log('⚠️  CAPTCHA detectado! Resolva o desafio no browser e pressione ENTER aqui para continuar...');

  // Pausa até o usuário pressionar ENTER no terminal
  await new Promise((resolve) => {
    const onData = () => {
      process.stdin.removeListener('data', onData);
      // Volta ao modo não-interativo sem fechar o stream
      if (process.stdin.isPaused()) process.stdin.resume();
      resolve();
    };
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', onData);
  });

  log('Continuando após CAPTCHA...');
  // Aguarda a página estabilizar após o CAPTCHA ser resolvido
  await randomDelay(2000, 3000);
}

/**
 * ESTRATÉGIA 1 — Interceptação de rede.
 *
 * Registra um listener nas respostas HTTP da página. Quando o TikTok faz
 * chamadas para sua própria API (ex: /api/challenge/item_list/), capturamos
 * o JSON antes mesmo de qualquer renderização de DOM.
 *
 * Vantagem: não depende de seletores CSS nem de JS no contexto da página,
 * o que reduz drasticamente os sinais de automação.
 *
 * @param {import('playwright').Page} page
 * @param {number} limit
 * @returns {Promise<Array>} Resolve quando tiver vídeos ou ao timeout
 */
function collectFromNetwork(page, limit) {
  return new Promise((resolve) => {
    const collected = [];
    let resolved = false;

    // Timeout de segurança: se a API não responder em 20s, resolve vazio
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve([]); }
    }, 20000);

    page.on('response', async (response) => {
      if (resolved) return;

      const url = response.url();
      const isApiCall = API_PATTERNS.some((re) => re.test(url));
      if (!isApiCall) return;

      // Só processa respostas JSON com sucesso
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;
      if (!response.ok()) return;

      try {
        const body = await response.json();

        // TikTok retorna { itemList: [...] } ou { items: [...] }
        const items = body?.itemList || body?.items || [];
        if (!Array.isArray(items) || items.length === 0) return;

        log(`API interceptada: ${url.substring(0, 80)}... (${items.length} itens)`);

        for (const item of items) {
          if (collected.length >= limit) break;
          collected.push({
            descricao: item?.desc || '',
            url: `https://www.tiktok.com/@${item?.author?.uniqueId}/video/${item?.id}`,
            views: String(item?.stats?.playCount ?? item?.stats?.vvCount ?? ''),
            likes: String(item?.stats?.diggCount ?? ''),
            createTime: item?.createTime ?? null,
          });
        }

        // Resolve assim que atingir o limite ou a primeira resposta de API
        if (collected.length > 0 && !resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(collected);
        }
      } catch (_) {
        // Body não é JSON válido — ignora
      }
    });
  });
}

/**
 * ESTRATÉGIA 2 — Objeto JS __UNIVERSAL_DATA_FOR_REHYDRATION__ (SSR).
 *
 * TikTok injeta dados do servidor nessa variável global.
 * Mais estável que DOM, mais lento que interceptação de rede.
 */
async function extractFromPageData(page) {
  try {
    const videos = await page.evaluate(() => {
      // TikTok injeta dados SSR nesta variável global
      const raw = window.__UNIVERSAL_DATA_FOR_REHYDRATION__;
      if (!raw) return null;

      // Caminho dos dados na página de challenge/hashtag
      const challengeData =
        raw['webapp.challenge-detail'] ||
        raw['__DEFAULT_SCOPE__']?.['webapp.challenge-detail'];

      if (!challengeData) return null;

      // Lista de itens de vídeo dentro do challenge
      const itemList =
        challengeData?.itemList ||
        challengeData?.challengeInfo?.itemList;

      if (!Array.isArray(itemList) || itemList.length === 0) return null;

      return itemList.map((item) => ({
        descricao: item?.desc || item?.contents?.[0]?.desc || '',
        url: `https://www.tiktok.com/@${item?.author?.uniqueId}/video/${item?.id}`,
        views: String(item?.stats?.playCount ?? item?.stats?.vvCount ?? ''),
        likes: String(item?.stats?.diggCount ?? ''),
        createTime: item?.createTime ?? null,
      }));
    });

    return videos;
  } catch (err) {
    // Silently fail — o fallback DOM vai ser tentado
    return null;
  }
}

/**
 * Faz scroll gradual na página para carregar mais vídeos (lazy loading).
 *
 * @param {import('playwright').Page} page
 * @param {number} scrollCount - Número de scrolls a executar
 */
async function scrollToLoadMore(page, scrollCount = MAX_SCROLLS) {
  log(`Iniciando scroll (${scrollCount}x) para carregar mais vídeos...`);
  for (let i = 0; i < scrollCount; i++) {
    await page.evaluate(() => {
      window.scrollBy({ top: window.innerHeight * 1.5, behavior: 'smooth' });
    });
    // Delay humano entre scrolls: 1.5s a 2.5s
    await randomDelay(1500, 2500);
  }
}

/**
 * Extrai dados dos vídeos diretamente do DOM — fallback quando
 * __UNIVERSAL_DATA_FOR_REHYDRATION__ não está disponível.
 *
 * @param {import('playwright').Page} page
 * @param {number} limit - Máximo de vídeos a retornar
 * @returns {Array}
 */
async function extractFromDOM(page, limit) {
  return await page.evaluate(({ selectors, limit }) => {
    const results = [];

    // Tenta pegar os cards pelo seletor data-e2e primeiro
    let cards = Array.from(document.querySelectorAll(selectors.videoItem));

    // Fallback: qualquer link que aponte para um vídeo
    if (cards.length === 0) {
      const links = Array.from(document.querySelectorAll(selectors.videoLink));
      // Sobe ao elemento pai do link para ter mais contexto de dados
      cards = links.map((a) => a.closest('li, article, div[class]') || a.parentElement);
    }

    for (const card of cards.slice(0, limit)) {
      if (!card) continue;

      // ----- URL -----
      const linkEl = card.querySelector('a[href*="/video/"]');
      const url = linkEl ? linkEl.href : '';
      if (!url) continue; // Sem URL, não vale a pena incluir

      // ----- Descrição -----
      const descEl =
        card.querySelector('[data-e2e="video-desc"]') ||
        card.querySelector('.video-meta-caption') ||
        card.querySelector('p') ||
        card.querySelector('span[class]');
      const descricao = descEl ? descEl.textContent.trim() : '';

      // ----- Views -----
      const viewEl =
        card.querySelector('[data-e2e="video-views"]') ||
        card.querySelector('.video-count') ||
        card.querySelector('strong');
      const views = viewEl ? viewEl.textContent.trim() : '';

      // ----- Likes -----
      // Likes geralmente só ficam visíveis dentro do vídeo,
      // mas tentamos capturar se houver elemento disponível
      const likeEls = card.querySelectorAll('strong');
      const likes = likeEls.length > 1 ? likeEls[1].textContent.trim() : '';

      results.push({ descricao, url, views, likes });
    }

    return results;
  }, { selectors: SELECTORS, limit });
}

/**
 * Scraping completo de uma página de hashtag do TikTok.
 * Tenta 3 estratégias em ordem, da mais robusta para a mais frágil.
 *
 * @param {import('playwright').BrowserContext} context - Contexto do browser
 * @param {string} hashtag - Ex: "tiktokmademebuyit"
 * @param {number} limit - Máximo de vídeos
 * @returns {Promise<Array>} Lista de vídeos com dados estruturados
 */
async function scrapeHashtag(context, hashtag, limit = 20) {
  const url = `https://www.tiktok.com/tag/${hashtag}`;
  const page = await context.newPage();

  try {
    log(`Acessando: ${url}`);

    // Inicia o listener de rede ANTES de navegar para não perder respostas
    const networkPromise = collectFromNetwork(page, limit);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Verifica se há CAPTCHA e pausa para resolução manual se necessário
    await waitForCaptchaIfNeeded(page);

    // Delay inicial para deixar o JS da página rodar e disparar as chamadas de API
    await randomDelay(2000, 3500);

    // --- Estratégia 1: Interceptação de rede (mais confiável) ---
    log('Aguardando chamadas de API internas do TikTok...');
    const networkVideos = await networkPromise;

    if (networkVideos.length > 0) {
      log(`Estratégia REDE: ${networkVideos.length} vídeos capturados.`);

      // Scroll para tentar acionar mais chamadas de API e atingir o limite
      if (networkVideos.length < limit) {
        log('Fazendo scroll para carregar mais vídeos via API...');
        await scrollToLoadMore(page, Math.min(MAX_SCROLLS, 4));
      }

      return networkVideos.slice(0, limit);
    }

    // --- Estratégia 2: Objeto JS SSR ---
    log('Tentando extração via __UNIVERSAL_DATA_FOR_REHYDRATION__...');
    let videos = await extractFromPageData(page);

    if (videos && videos.length > 0) {
      log(`Estratégia SSR: ${videos.length} vídeos encontrados.`);
      return videos.slice(0, limit);
    }

    // --- Estratégia 3: DOM scraping ---
    log('Fallback: extraindo via DOM...');

    try {
      await page.waitForSelector(
        `${SELECTORS.videoList}, ${SELECTORS.videoItem}, ${SELECTORS.videoLink}`,
        { timeout: DEFAULT_TIMEOUT }
      );
    } catch {
      log('Aviso: seletor DOM não encontrado. Possível CAPTCHA ou mudança de layout.');
    }

    await scrollToLoadMore(page, MAX_SCROLLS);
    videos = await extractFromDOM(page, limit);
    log(`Estratégia DOM: ${videos.length} vídeos encontrados.`);

    return videos;
  } catch (err) {
    log(`Erro ao scraping de #${hashtag}: ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}

module.exports = { scrapeHashtag, applyStealthPatches };
