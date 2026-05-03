/**
 * scraperML.js
 * Coleta tendências de produtos do Mercado Livre em tendencias.mercadolivre.com.br.
 *
 * Implementa 2 estratégias em cascata, seguindo o padrão do scraper.js:
 *   1. Interceptação de rede — captura respostas JSON da API interna do ML
 *   2. DOM scraping        — fallback via seletores estáveis (headings, links)
 *
 * Retorna array de objetos:
 *   { nome, categoria, posicao, tipo, url, fonte: 'mercadolivre' }
 */

const { randomDelay, log } = require('./utils');

// URL base das tendências por categoria
const BASE_URL = 'https://lista.mercadolivre.com.br';
const TRENDS_ROOT = 'https://tendencias.mercadolivre.com.br';

// Mapeamento slug → nome legível e URL de categoria
const CATEGORIAS_MAP = {
  beleza:     { nome: 'Beleza e Cuidado Pessoal',  url: `${BASE_URL}/beleza-cuidado-pessoal/` },
  esportes:   { nome: 'Esportes e Fitness',         url: `${BASE_URL}/esportes-fitness/` },
  games:      { nome: 'Games',                      url: `${BASE_URL}/games/` },
  eletronicos: { nome: 'Eletrônicos, Áudio e Vídeo', url: `${BASE_URL}/eletronicos-audio-video/` },
  celulares:  { nome: 'Celulares e Telefones',      url: `${BASE_URL}/celulares-telefones/` },
  informatica: { nome: 'Informática',               url: `${BASE_URL}/informatica/` },
};

// Padrões de URL da API interna do ML que retornam JSON de tendências
const API_PATTERNS = [
  /\/trends\/v\d+\//,
  /\/search\/api\/frontend/,
  /\/trending/,
  /\/highlights/,
];

// Tipos de tendência mapeados pelos componentes da página
const TIPOS_COMPONENTE = {
  'HIGHER_GROWTH': 'MAIOR_CRESCIMENTO',
  'MOST_WANTED':   'MAIS_DESEJADA',
  'MOST_POPULAR':  'MAIS_POPULAR',
};

/**
 * Tenta extrair produtos de uma resposta JSON interceptada da API do ML.
 *
 * @param {Object} json
 * @param {string} categoria
 * @returns {Array|null} array de produtos ou null se estrutura não reconhecida
 */
function extrairDeJson(json, categoria) {
  try {
    const resultados = [];

    // Estrutura da API de tendências: { components: [{ type, results: [{title, permalink}] }] }
    const components = json?.components || json?.data?.components || json?.results;
    if (!Array.isArray(components)) return null;

    for (const comp of components) {
      const tipo = TIPOS_COMPONENTE[comp.type] || comp.type || 'DESCONHECIDO';
      const items = comp.results || comp.items || comp.data || [];

      if (!Array.isArray(items)) continue;

      items.forEach((item, idx) => {
        const nome = item.title || item.keyword || item.name;
        const url  = item.permalink || item.url || item.target;
        if (!nome) return;

        resultados.push({
          nome:      nome.trim(),
          categoria: CATEGORIAS_MAP[categoria]?.nome || categoria,
          posicao:   idx + 1,
          tipo,
          url:       url || `${BASE_URL}/${encodeURIComponent(nome.toLowerCase().replace(/\s+/g, '-'))}#trend`,
          fonte:     'mercadolivre',
        });
      });
    }

    return resultados.length > 0 ? resultados : null;
  } catch {
    return null;
  }
}

/**
 * Estratégia 1: Interceptação de rede.
 * Escuta respostas JSON da API interna antes de navegar.
 *
 * @param {import('playwright').Page} page
 * @param {string} categoria
 * @returns {Promise<Array>}
 */
async function estrategiaRede(page, categoria) {
  return new Promise((resolve) => {
    const produtos = [];
    let resolvido = false;

    const timer = setTimeout(() => {
      if (!resolvido) {
        resolvido = true;
        resolve(produtos.length > 0 ? produtos : null);
      }
    }, 12000);

    page.on('response', async (response) => {
      if (resolvido) return;

      const url = response.url();
      const ehApiML = API_PATTERNS.some((re) => re.test(url));
      if (!ehApiML) return;

      try {
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;

        const json = await response.json();
        const extraidos = extrairDeJson(json, categoria);

        if (extraidos && extraidos.length > 0) {
          produtos.push(...extraidos);
        }
      } catch {
        // resposta não parseable — ignora
      }
    });

    // Resolve após coleta de rede (ouvinte remove-se ao resolver)
    setTimeout(() => {
      if (!resolvido && produtos.length > 0) {
        clearTimeout(timer);
        resolvido = true;
        resolve(produtos);
      }
    }, 8000);
  });
}

/**
 * Estratégia 2: DOM scraping.
 * Extrai headings e links das seções de tendências da página.
 *
 * @param {import('playwright').Page} page
 * @param {string} categoria
 * @returns {Promise<Array>}
 */
async function estrategiaDom(page, categoria) {
  try {
    await page.waitForSelector('h2, h3', { timeout: 8000 });
  } catch {
    return [];
  }

  return page.evaluate((params) => {
    const { categoriaNome, tipos } = params;
    const produtos = [];

    // Mapeamento de texto de cabeçalho para tipo
    const TITULO_TIPO = {
      'buscas que mais cresceram': 'MAIOR_CRESCIMENTO',
      'buscas mais desejadas':     'MAIS_DESEJADA',
      'tendências mais populares': 'MAIS_POPULAR',
    };

    // Localiza cada seção de tendência pelo texto do h2
    document.querySelectorAll('h2, h3').forEach((heading) => {
      const textoH = heading.textContent.toLowerCase().trim();
      let tipo = null;

      for (const [chave, valor] of Object.entries(TITULO_TIPO)) {
        if (textoH.includes(chave)) {
          tipo = valor;
          break;
        }
      }

      if (!tipo) return;

      // Encontra o contêiner pai da seção e coleta todos os links de produto
      const secao = heading.closest('section, [role="region"], div[class]');
      if (!secao) return;

      const links = secao.querySelectorAll('a[href]');
      let posicao = 1;

      links.forEach((link) => {
        const href = link.href;
        // Filtra apenas links de listagem de produto (não navegação)
        if (!href.includes('lista.mercadolivre') && !href.includes('#trend')) return;

        // Tenta obter nome do produto via heading filho ou texto do link
        const h3 = link.querySelector('h3, [level="3"]');
        const nome = (h3 || link).textContent.trim();

        if (!nome || nome.length < 3) return;
        // Evita duplicatas
        if (produtos.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) return;

        produtos.push({
          nome,
          categoria: categoriaNome,
          posicao:   posicao++,
          tipo,
          url:       href,
          fonte:     'mercadolivre',
        });
      });
    });

    return produtos;
  }, {
    categoriaNome: CATEGORIAS_MAP[categoria]?.nome || categoria,
    tipos: TIPOS_COMPONENTE,
  });
}

/**
 * Coleta tendências de uma única categoria do Mercado Livre.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} categoria - chave do CATEGORIAS_MAP
 * @returns {Promise<Array>}
 */
async function scrapeCategoria(context, categoria) {
  const info = CATEGORIAS_MAP[categoria];
  if (!info) {
    log(`scraperML: categoria desconhecida "${categoria}" — ignorando`);
    return [];
  }

  const page = await context.newPage();
  const produtos = [];

  try {
    log(`scraperML: coletando "${info.nome}"...`);

    // Estratégia 1: inicia listener ANTES de navegar
    const promessaRede = estrategiaRede(page, categoria);

    await page.goto(info.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 3500);

    const dadosRede = await promessaRede;

    if (dadosRede && dadosRede.length > 0) {
      log(`scraperML: Estratégia REDE — ${dadosRede.length} produtos em "${info.nome}"`);
      produtos.push(...dadosRede);
    } else {
      // Estratégia 2: DOM scraping como fallback
      log(`scraperML: Rede sem dados — tentando DOM em "${info.nome}"`);
      const dadosDom = await estrategiaDom(page, categoria);

      if (dadosDom.length > 0) {
        log(`scraperML: Estratégia DOM — ${dadosDom.length} produtos em "${info.nome}"`);
        produtos.push(...dadosDom);
      } else {
        log(`scraperML: Nenhum dado obtido para "${info.nome}"`);
      }
    }
  } catch (err) {
    log(`scraperML: Erro em "${info.nome}" — ${err.message}`);
  } finally {
    await page.close();
  }

  return produtos;
}

/**
 * Coleta tendências de múltiplas categorias do Mercado Livre.
 * Aplica delay entre cada categoria para não parecer bot.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string[]} categorias - array de chaves do CATEGORIAS_MAP
 * @returns {Promise<Array>} todos os produtos coletados
 */
async function scrapeCategoriasML(context, categorias) {
  const todos = [];

  for (let i = 0; i < categorias.length; i++) {
    const categoria = categorias[i].trim();
    const resultados = await scrapeCategoria(context, categoria);
    todos.push(...resultados);

    if (i < categorias.length - 1) {
      await randomDelay(3000, 5000);
    }
  }

  log(`scraperML: total coletado — ${todos.length} produtos em ${categorias.length} categorias`);
  return todos;
}

module.exports = { scrapeCategoriasML, CATEGORIAS_MAP };
