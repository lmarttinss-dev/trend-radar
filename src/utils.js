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

// Stopwords ignoradas ao extrair keywords de produtos
const STOPWORDS = new Set([
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

module.exports = { getRandomUserAgent, randomDelay, log };
