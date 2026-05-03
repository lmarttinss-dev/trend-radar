/**
 * utils.js
 * Funções auxiliares para o scraper do TikTok.
 */

// Lista de User-Agents realistas de browsers desktop modernos
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

/**
 * Retorna um User-Agent aleatório da lista.
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Aguarda um tempo aleatório entre min e max milissegundos.
 * Essencial para simular comportamento humano e evitar bloqueios.
 */
function randomDelay(min = 1000, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log simples com timestamp no console.
 */
function log(message) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${message}`);
}

// Stopwords ignoradas ao extrair keywords para busca no Mercado Livre
const STOPWORDS_ML = new Set([
  // Inglês comum
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','must','shall',
  'can','this','that','these','those','i','you','he','she','it','we','they',
  'me','him','her','us','them','my','your','his','its','our','their',
  'what','which','who','when','where','why','how','all','each','every','both',
  'few','more','most','other','some','such','no','not','only','so','than',
  'too','very','just','but','and','or','in','on','at','to','for','of','with',
  'by','from','up','about','into','out','off','over','under','then','one',
  'don','doesn','isn','aren','wasn','weren','won','let','get','got',
  // Ruído TikTok / e-commerce
  'amazon','link','bio','haul','shop','find','finds','check','comment','follow',
  'see','linked','foryou','fyp','trending','viral','run','ruin','day','seen',
  'new','best','favorite','favorites','dont','go','use','buy','here','now',
  'video','videos','look','like','love','need','want','omg','wow','ever',
  'goodthing','goodthingstoshare','houseware','tiktokmademebuyit','amazonfinds',
  'amazongadget','amazongadgets','amazonfavorites','amazonfind','amazonfaves',
  'product','products','item','items','review','reviews','must','small','big',
  'cute','cool','nice','great','amazing','perfect','please','share','tag',
  'save','repost','click','swipe','tap','run','how','why','every',
  'beautiful','easy','unique','cute','cool','nice','great','amazing',
]);

// Dicionário de tradução EN → PT-BR para termos comuns de produtos
const TRADUCOES_ML = {
  // Cozinha
  kitchen: 'cozinha', gadget: 'gadget', gadgets: 'gadgets',
  chopper: 'picador', slicer: 'fatiador', peeler: 'descascador',
  holder: 'suporte', organizer: 'organizador', rack: 'rack',
  container: 'pote', bowl: 'tigela', cup: 'copo', mug: 'caneca',
  bottle: 'garrafa', jar: 'pote', pan: 'frigideira', pot: 'panela',
  knife: 'faca', blender: 'liquidificador', grater: 'ralador',
  strainer: 'coador', spatula: 'espátula', tongs: 'pegador',
  // Eletrônicos
  charger: 'carregador', wireless: 'sem-fio', cable: 'cabo',
  speaker: 'caixa de som', headphone: 'fone de ouvido',
  earphone: 'fone de ouvido', keyboard: 'teclado', mouse: 'mouse',
  lamp: 'luminária', light: 'luz', fan: 'ventilador',
  camera: 'câmera', screen: 'tela', monitor: 'monitor',
  // Beleza / saúde
  brush: 'pincel', mirror: 'espelho', massager: 'massageador',
  roller: 'rolo', serum: 'sérum', mask: 'máscara',
  trimmer: 'aparador', razor: 'barbeador', nail: 'unhas',
  // Casa / decoração
  candle: 'vela', warmer: 'aquecedor', diffuser: 'difusor',
  shelf: 'prateleira', hook: 'gancho', hanger: 'cabide',
  curtain: 'cortina', pillow: 'travesseiro', blanket: 'cobertor',
  mat: 'tapete', rug: 'tapete', frame: 'moldura',
  // Vestuário / acessórios
  shoe: 'sapato', shoes: 'sapatos', bag: 'bolsa', wallet: 'carteira',
  watch: 'relógio', ring: 'anel', necklace: 'colar', bracelet: 'pulseira',
  hat: 'boné', glasses: 'óculos', socks: 'meias', gloves: 'luvas',
  cover: 'capa', case: 'case',
  // Pets
  pet: 'pet', dog: 'cachorro', cat: 'gato',
  collar: 'coleira', leash: 'guia', feeder: 'comedouro',
  // Automóvel
  tire: 'pneu', car: 'carro', seat: 'assento',
  // Fitness
  yoga: 'yoga', mat: 'tapete', dumbbell: 'halter',
  resistance: 'resistência', band: 'elástico',
  // Termos genéricos de produto
  infuser: 'infusor', dispenser: 'dispenser', pump: 'bomba',
  magnetic: 'magnético', rotating: 'rotativo', foldable: 'dobrável',
  portable: 'portátil', electric: 'elétrico', automatic: 'automático',
  waterproof: 'impermeável', reusable: 'reutilizável',
  multifunctional: 'multifuncional', adjustable: 'ajustável',
  invisible: 'invisível', flat: 'plano', drying: 'secagem',
  utensil: 'utensílio', vegetable: 'vegetal', water: 'água',
  space: 'espaço', milkshake: 'milkshake', umbrella: 'guarda-chuva',
  tea: 'chá', mighty: 'potente', produce: 'hortifruti',
  machine: 'máquina', beautiful: 'bonito', clean: 'limpeza',
  protects: 'proteção', protection: 'proteção', spray: 'spray',
  unique: 'exclusivo', durable: 'durável', mini: 'mini',
  stainless: 'inox', steel: 'aço', wooden: 'madeira', wood: 'madeira',
  silicone: 'silicone', plastic: 'plástico', glass: 'vidro',
};

/**
 * Traduz um token EN → PT-BR via dicionário local.
 * Fallback quando a LibreTranslate não está disponível.
 */
function traduzirToken(token) {
  const chave = token.replace(/-/g, '');
  return TRADUCOES_ML[chave] || TRADUCOES_ML[token] || token;
}

/**
 * Traduz um trecho de texto EN→PT-BR via MyMemory (gratuito, sem chave).
 * Limite da tier gratuita: 500 requisições/dia por IP.
 *
 * @param {string} texto
 * @returns {Promise<string|null>} Texto traduzido ou null em caso de falha
 */
async function traduzirTexto(texto) {
  try {
    const params = new URLSearchParams({ q: texto, langpair: 'en|pt-BR' });
    const resp = await fetch(`https://api.mymemory.translated.net/get?${params}`, {
      signal: AbortSignal.timeout(6000),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.responseStatus !== 200) return null;
    return data?.responseData?.translatedText || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extrai keywords significativas de uma descrição de vídeo, traduz para
 * pt-BR via LibreTranslate (com fallback para dicionário local) e retorna
 * a URL de busca no Mercado Livre.
 *
 * @param {string} descricao - Descrição/legenda do vídeo
 * @returns {Promise<string>} URL de busca no ML, ou string vazia se sem keywords
 */
async function extrairKeywordML(descricao) {
  if (!descricao || typeof descricao !== 'string') return '';

  const tokens = descricao
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !STOPWORDS_ML.has(p) && !/^\d+$/.test(p))
    .slice(0, 4);

  if (tokens.length === 0) return '';

  const fraseEn = tokens.join(' ');

  // Tenta traduzir via LibreTranslate
  const traduzido = await traduzirTexto(fraseEn);

  let slug;
  if (traduzido) {
    // Normaliza o resultado: minúsculas, remove pontuação residual, hifeniza
    slug = traduzido
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
  } else {
    // Fallback: dicionário local
    slug = tokens.map(traduzirToken).join('-');
  }

  return `https://lista.mercadolivre.com.br/${encodeURIComponent(slug)}`;
}

module.exports = { getRandomUserAgent, randomDelay, log, extrairKeywordML };
