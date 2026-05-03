/**
 * scraperAlibaba.js
 * Busca fornecedores no Alibaba filtrados por Trade Assurance e Verified Supplier.
 *
 * Implementa 3 estratégias em cascata:
 *   1. Interceptação de rede — captura JSON da API interna do Alibaba
 *   2. Objeto SSR            — leitura de window.__DATA__ ou equivalente
 *   3. DOM scraping          — seletores data-* estáveis
 *
 * Retorna array de objetos:
 *   { nomeFornecedor, urlFornecedor, urlProduto, nomeProduto,
 *     precoUnitario, moq, anosGoldSupplier, taxaResposta,
 *     tradeAssurance, verificado, pais, keyword }
 */

const fs   = require('fs');
const path = require('path');
const { randomDelay, log, keywordParaAlibaba } = require('./utils');

const CACHE_PATH    = path.join(__dirname, '..', 'data', 'alibaba-cache.json');
const CACHE_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 dias

// URL de busca com filtros Trade Assurance + Verified Supplier
const SEARCH_URL = (keyword) =>
  `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(keyword)}&isBuyer=y&filter=main:::tradeAssurance,verification:::verified`;

// Padrões de URL da API interna do Alibaba que retornam JSON de produtos
const API_PATTERNS = [
  /offerlist-api/,
  /\/search\/api\//,
  /ams\.alibaba\.com/,
  /\/api\/search\?/,
  /offer\/list/,
];

// ─── Cache ────────────────────────────────────────────────────────────────────

function carregarCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    if (!fs.existsSync(CACHE_PATH)) {
      fs.writeFileSync(CACHE_PATH, '{}', 'utf8');
      return {};
    }
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function salvarCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    log(`alibaba: erro ao salvar cache — ${err.message}`);
  }
}

/**
 * Verifica se entrada de cache ainda é válida (dentro do TTL de 7 dias).
 *
 * @param {Object} entrada
 * @returns {boolean}
 */
function cacheValido(entrada) {
  if (!entrada || !entrada.cachedAt) return false;
  return Date.now() - entrada.cachedAt < CACHE_TTL_MS;
}

// ─── Normalização de fornecedor ───────────────────────────────────────────────

/**
 * Normaliza um objeto bruto de fornecedor para o shape padrão.
 *
 * @param {Object} raw
 * @param {string} keyword
 * @returns {Object}
 */
function normalizarFornecedor(raw, keyword) {
  return {
    nomeFornecedor:   raw.companyName || raw.supplierName || raw.company || '—',
    urlFornecedor:    raw.companyUrl  || raw.supplierUrl  || raw.storeUrl || '',
    urlProduto:       raw.productUrl  || raw.detailUrl    || raw.offerUrl  || '',
    nomeProduto:      raw.subject     || raw.title        || raw.productName || '—',
    precoUnitario:    raw.price       || raw.priceRange   || '—',
    moq:              raw.minOrderQuantity || raw.moq     || '—',
    anosGoldSupplier: raw.tradeYear   || raw.yearGold     || raw.supplierYear || '—',
    taxaResposta:     raw.replyRate   || raw.responseRate || '—',
    tradeAssurance:   raw.tradeAssurance !== false,
    verificado:       raw.isVerified  || raw.verified     || false,
    pais:             raw.country     || raw.supplierCountry || 'China',
    keyword,
  };
}

// ─── Estratégia 1: Interceptação de rede ──────────────────────────────────────

/**
 * Captura respostas JSON da API interna do Alibaba via listener de rede.
 *
 * @param {import('playwright').Page} page
 * @param {string} keyword
 * @param {number} limite
 * @returns {Promise<Array|null>}
 */
async function estrategiaRede(page, keyword, limite) {
  return new Promise(async (resolve) => {
    const fornecedores = [];
    let resolvido = false;

    const timer = setTimeout(() => {
      if (!resolvido) { resolvido = true; resolve(null); }
    }, 15000);

    page.on('response', async (response) => {
      if (resolvido) return;

      const url = response.url();
      const ehApiAlibaba = API_PATTERNS.some((p) => p.test(url));
      if (!ehApiAlibaba) return;

      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('application/json')) return;

      try {
        const json = await response.json();
        const items = extrairItensDeJson(json);
        if (!items || items.length === 0) return;

        for (const item of items.slice(0, limite)) {
          fornecedores.push(normalizarFornecedor(item, keyword));
        }

        if (fornecedores.length >= limite) {
          clearTimeout(timer);
          resolvido = true;
          resolve(fornecedores.slice(0, limite));
        }
      } catch (_) {
        // resposta não era JSON utilizável
      }
    });

    try {
      await page.goto(SEARCH_URL(keyword), { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Scroll suave para acionar carregamento lazy
      await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
      await randomDelay(3000, 5000);

      if (!resolvido) {
        clearTimeout(timer);
        resolvido = true;
        resolve(fornecedores.length > 0 ? fornecedores : null);
      }
    } catch (err) {
      clearTimeout(timer);
      if (!resolvido) { resolvido = true; resolve(null); }
    }
  });
}

/**
 * Tenta extrair lista de ofertas/fornecedores de uma resposta JSON.
 *
 * @param {Object} json
 * @returns {Array|null}
 */
function extrairItensDeJson(json) {
  // Estruturas conhecidas da API do Alibaba
  const candidatos = [
    json?.data?.offerList,
    json?.data?.items,
    json?.data?.result?.items,
    json?.result?.offerList,
    json?.offerList,
    json?.items,
    json?.data,
  ];

  for (const c of candidatos) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return null;
}

// ─── Estratégia 2: Objeto SSR ─────────────────────────────────────────────────

/**
 * Lê dados de produto injetados pelo servidor no objeto window global.
 *
 * @param {import('playwright').Page} page
 * @param {string} keyword
 * @param {number} limite
 * @returns {Promise<Array|null>}
 */
async function estrategiaSSR(page, keyword, limite) {
  try {
    const items = await page.evaluate(() => {
      // Candidatos conhecidos de SSR do Alibaba
      const candidatos = [
        window.__DATA__,
        window.__alibaba_data__,
        window.pageData,
        window.offerListData,
      ];

      for (const c of candidatos) {
        const lista =
          c?.data?.offerList ||
          c?.offerList       ||
          c?.data?.items     ||
          c?.items;
        if (Array.isArray(lista) && lista.length > 0) return lista;
      }
      return null;
    });

    if (!items || items.length === 0) return null;

    return items.slice(0, limite).map((item) => normalizarFornecedor(item, keyword));
  } catch {
    return null;
  }
}

// ─── Estratégia 3: DOM scraping ───────────────────────────────────────────────

/**
 * Extrai fornecedores diretamente do DOM usando seletores data-* estáveis.
 *
 * @param {import('playwright').Page} page
 * @param {string} keyword
 * @param {number} limite
 * @returns {Promise<Array|null>}
 */
async function estrategiaDom(page, keyword, limite) {
  try {
    // Aguarda cards de produto carregarem
    await page.waitForSelector('[data-anim-id], .organic-offer-wrapper, .list-no-v2-main', {
      timeout: 10000,
    }).catch(() => null);

    const fornecedores = await page.evaluate((lim) => {
      const resultados = [];

      // Seletores de card de produto — priorizando data-* sobre classes ofuscadas
      const cards = Array.from(
        document.querySelectorAll(
          '[data-anim-id], .organic-offer-wrapper, .J-offer-wrapper, .list-no-v2-main .item-wrap'
        )
      ).slice(0, lim * 2); // pega mais para filtrar Trade Assurance

      for (const card of cards) {
        if (resultados.length >= lim) break;

        // Trade Assurance — ícone ou badge específico
        const temTA = !!(
          card.querySelector('[class*="trade-assurance"]') ||
          card.querySelector('[data-role="trade-assurance"]') ||
          card.querySelector('img[alt*="Trade Assurance"]') ||
          card.querySelector('[class*="tradeAssurance"]')
        );

        // Verified Supplier — badge de verificação
        const verificado = !!(
          card.querySelector('[class*="verified"]') ||
          card.querySelector('[data-role="verified"]') ||
          card.querySelector('[class*="verify"]')
        );

        // Nome do produto
        const nomeProduto =
          card.querySelector('[data-anim-id] h2')?.innerText ||
          card.querySelector('.elements-title-normal__port')?.innerText ||
          card.querySelector('[class*="product-title"]')?.innerText ||
          card.querySelector('h2')?.innerText || '—';

        // URL do produto
        const linkProduto =
          card.querySelector('a[href*="/product-detail/"]')?.href ||
          card.querySelector('a[href*="detail.1688"]')?.href ||
          card.querySelector('a.organic-offer-wrapper')?.href || '';

        // Preço
        const preco =
          card.querySelector('[class*="price-range"]')?.innerText ||
          card.querySelector('[class*="price"]')?.innerText || '—';

        // MOQ
        const moq =
          card.querySelector('[class*="moq"]')?.innerText ||
          card.querySelector('[class*="min-order"]')?.innerText || '—';

        // Nome da empresa
        const empresa =
          card.querySelector('[class*="company-name"]')?.innerText ||
          card.querySelector('[data-company-name]')?.getAttribute('data-company-name') ||
          card.querySelector('[class*="supplier-name"]')?.innerText || '—';

        // URL da empresa
        const urlEmpresa =
          card.querySelector('a[href*="alibaba.com/company"]')?.href ||
          card.querySelector('[class*="company-name"] a')?.href || '';

        // Anos de Gold Supplier
        const anos =
          card.querySelector('[class*="gold-"]')?.innerText ||
          card.querySelector('[class*="year"]')?.innerText || '—';

        // País
        const pais =
          card.querySelector('[class*="country"]')?.innerText ||
          card.querySelector('[data-country]')?.getAttribute('data-country') || 'China';

        resultados.push({
          nomeProduto: nomeProduto.trim(),
          urlProduto:  linkProduto,
          precoUnitario: preco.trim(),
          moq:           moq.trim(),
          nomeFornecedor: empresa.trim(),
          urlFornecedor:  urlEmpresa,
          anosGoldSupplier: anos.replace(/[^0-9YRS\s]/g, '').trim() || '—',
          taxaResposta:  '—',
          tradeAssurance: temTA,
          verificado,
          pais: pais.trim(),
        });
      }

      return resultados;
    }, limite);

    if (!fornecedores || fornecedores.length === 0) return null;

    // Adiciona keyword e garante shape padrão
    return fornecedores.map((f) => ({ ...f, keyword }));
  } catch (err) {
    log(`alibaba: dom — ${err.message}`);
    return null;
  }
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Busca fornecedores no Alibaba para uma keyword específica.
 * Tenta as 3 estratégias em ordem até obter resultados.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} keyword      - termo de busca em inglês
 * @param {number} limite       - máximo de fornecedores a retornar
 * @returns {Promise<Array>}    - array de fornecedores normalizados
 */
async function buscarFornecedores(context, keyword, limite = 3) {
  const cache = carregarCache();
  const chave = `${keyword.toLowerCase().trim()}::${limite}`;

  if (cache[chave] && cacheValido(cache[chave])) {
    log(`alibaba: cache hit — "${keyword}"`);
    return cache[chave].dados;
  }

  log(`alibaba: buscando "${keyword}" (limite: ${limite})...`);

  const page = await context.newPage();
  let resultado = null;

  try {
    // Estratégia 1 — interceptação de rede
    log(`alibaba: estratégia 1 (rede) — "${keyword}"`);
    resultado = await estrategiaRede(page, keyword, limite);

    // Estratégia 2 — objeto SSR
    if (!resultado || resultado.length === 0) {
      log(`alibaba: estratégia 2 (SSR) — "${keyword}"`);
      resultado = await estrategiaSSR(page, keyword, limite);
    }

    // Estratégia 3 — DOM scraping
    if (!resultado || resultado.length === 0) {
      log(`alibaba: estratégia 3 (DOM) — "${keyword}"`);
      resultado = await estrategiaDom(page, keyword, limite);
    }

    if (!resultado || resultado.length === 0) {
      log(`alibaba: nenhum fornecedor encontrado para "${keyword}"`);
      resultado = [];
    } else {
      log(`alibaba: ${resultado.length} fornecedor(es) encontrado(s) para "${keyword}"`);
    }
  } catch (err) {
    log(`alibaba: erro ao buscar "${keyword}" — ${err.message}`);
    resultado = [];
  } finally {
    await page.close().catch(() => null);
  }

  // Persiste no cache mesmo se vazio (evita re-tentativas desnecessárias)
  cache[chave] = { cachedAt: Date.now(), dados: resultado };
  salvarCache(cache);

  return resultado;
}

/**
 * Busca fornecedores para uma lista de produtos viáveis.
 * Aplica delay entre buscas para evitar bloqueio.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {Array}  produtos   - array de { nomeProduto, keyword }
 * @param {number} limite     - máximo de fornecedores por produto
 * @returns {Promise<Map<string, Array>>} mapa keyword → fornecedores
 */
async function buscarFornecedoresParaProdutos(context, produtos, limite = 3) {
  const mapa = new Map();

  // Deduplica por keyword
  const vistos  = new Set();
  const unicos  = [];

  for (const p of produtos) {
    const kw = (p.keyword || p.nomeProduto || '').trim();
    if (!kw || vistos.has(kw.toLowerCase())) continue;
    vistos.add(kw.toLowerCase());
    unicos.push({ ...p, keyword: kw });
  }

  log(`alibaba: ${unicos.length} keywords únicas para busca (${produtos.length - unicos.length} duplicatas ignoradas)`);

  for (let i = 0; i < unicos.length; i++) {
    const { keyword } = unicos[i];

    const fornecedores = await buscarFornecedores(context, keyword, limite);
    mapa.set(keyword.toLowerCase(), fornecedores);

    if (i < unicos.length - 1) {
      await randomDelay(4000, 8000);
    }
  }

  return mapa;
}

module.exports = { buscarFornecedores, buscarFornecedoresParaProdutos };
