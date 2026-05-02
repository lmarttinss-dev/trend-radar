/**
 * analyzer.js
 * Análise heurística de viabilidade de revenda para cada vídeo coletado.
 * Score 0–100 sem uso de IA — baseado em views, engajamento e intenção de compra.
 */

// Palavras-chave que indicam intenção de compra / produto à venda
const PURCHASE_KEYWORDS = [
  'link', 'amazon', 'shop', 'buy', 'compra', 'onde achar', 'link na bio',
  'achei no', 'disponível', 'loja', 'store', 'desconto', 'promoção',
  'cupom', 'coupon', 'afiliado', 'affiliate', 'code', 'código',
  'produto', 'product', 'review', 'unboxing', 'haul', 'find',
];

/**
 * Converte strings de métricas do TikTok para número inteiro.
 * Exemplos: "2.1M" → 2100000 | "180K" → 180000 | "1,234" → 1234 | "12345" → 12345
 *
 * @param {string} value
 * @returns {number}
 */
function parseMetric(value) {
  if (!value || value === '') return 0;

  const clean = String(value).replace(/,/g, '').trim().toUpperCase();

  if (clean.endsWith('M')) return Math.round(parseFloat(clean) * 1_000_000);
  if (clean.endsWith('K')) return Math.round(parseFloat(clean) * 1_000);
  if (clean.endsWith('B')) return Math.round(parseFloat(clean) * 1_000_000_000);

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.round(num);
}

/**
 * Calcula score de views (0–50).
 * Usa escala logarítmica: 1M views → ~50pts, 100K → ~35pts, 10K → ~20pts.
 *
 * @param {number} views
 * @returns {number}
 */
function viewsScore(views) {
  if (views <= 0) return 0;
  // log10(1M) = 6 → 50pts; log10(1K) = 3 → 25pts; capped em 50
  const score = (Math.log10(views) / 6) * 50;
  return Math.min(50, Math.max(0, Math.round(score)));
}

/**
 * Calcula score de engajamento (0–30).
 * Engagement rate = likes / views. Acima de 5% é excelente.
 *
 * @param {number} likes
 * @param {number} views
 * @returns {number}
 */
function engagementScore(likes, views) {
  if (views <= 0 || likes <= 0) return 0;
  const rate = likes / views; // ex: 0.08 = 8%
  // 5%+ → 30pts; escala linear até 5%, zero abaixo de 0.1%
  const score = Math.min(1, rate / 0.05) * 30;
  return Math.max(0, Math.round(score));
}

/**
 * Calcula score de intenção de compra (0–20).
 * Conta quantas keywords de compra aparecem na descrição.
 *
 * @param {string} descricao
 * @returns {number}
 */
function keywordScore(descricao) {
  if (!descricao) return 0;
  const lower = descricao.toLowerCase();
  const hits = PURCHASE_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  // 1 keyword → 10pts; 2+ → 20pts
  if (hits === 0) return 0;
  if (hits === 1) return 10;
  return 20;
}

/**
 * Retorna classificação textual baseada no score.
 *
 * @param {number} score
 * @returns {{ label: string, emoji: string }}
 */
function classify(score) {
  if (score >= 70) return { label: 'Alto', emoji: '🟢' };
  if (score >= 40) return { label: 'Médio', emoji: '🟡' };
  return { label: 'Baixo', emoji: '🔴' };
}

/**
 * Tenta extrair um nome de produto curto da descrição.
 * Usa as primeiras 60 chars até o primeiro separador (|, #, @, /).
 *
 * @param {string} descricao
 * @returns {string}
 */
function extractProduct(descricao) {
  if (!descricao) return '—';
  // Remove emojis e caracteres especiais de controle
  const clean = descricao.replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();
  // Corta no primeiro separador comum ou no limite de 60 chars
  const match = clean.match(/^([^|#@/\\]{4,60})/);
  return match ? match[1].trim() : clean.substring(0, 60);
}

/**
 * Analisa um único vídeo e retorna o objeto enriquecido com score e viabilidade.
 *
 * @param {Object} video - { descricao, url, views, likes }
 * @returns {Object} video enriquecido
 */
function analyzeVideo(video) {
  const viewsNum  = parseMetric(video.views);
  const likesNum  = parseMetric(video.likes);

  const vScore = viewsScore(viewsNum);
  const eScore = engagementScore(likesNum, viewsNum);
  const kScore = keywordScore(video.descricao);
  const total  = vScore + eScore + kScore;

  const { label, emoji } = classify(total);

  const engRate = viewsNum > 0 ? ((likesNum / viewsNum) * 100).toFixed(1) : '—';

  return {
    ...video,
    produto:      extractProduct(video.descricao),
    viewsNum,
    likesNum,
    engRate:      engRate === '—' ? '—' : `${engRate}%`,
    score:        total,
    viabilidade:  `${emoji} ${label}`,
  };
}

/**
 * Analisa todos os resultados do scraper.
 *
 * @param {Object} allResults - { hashtagName: [videos...] }
 * @returns {Object} mesma estrutura com vídeos enriquecidos
 */
function analyzeAll(allResults) {
  const analyzed = {};
  for (const [hashtag, videos] of Object.entries(allResults)) {
    analyzed[hashtag] = videos.map(analyzeVideo);
  }
  return analyzed;
}

module.exports = { analyzeAll, analyzeVideo, parseMetric };
