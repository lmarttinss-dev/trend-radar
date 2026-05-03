/**
 * analyzer.js
 * Análise heurística de viabilidade de revenda para cada vídeo coletado.
 * Score 0–100 sem uso de IA — baseado em views, engajamento, intenção de compra e recência.
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
 * Calcula score de views (0–40).
 * Usa escala logarítmica: 1M views → ~40pts, 100K → ~27pts, 10K → ~13pts.
 *
 * @param {number} views
 * @returns {number}
 */
function viewsScore(views) {
  if (views <= 0) return 0;
  const score = (Math.log10(views) / 6) * 40;
  return Math.min(40, Math.max(0, Math.round(score)));
}

/**
 * Calcula score de engajamento (0–25).
 * Engagement rate = likes / views. Acima de 5% é excelente.
 *
 * @param {number} likes
 * @param {number} views
 * @returns {number}
 */
function engagementScore(likes, views) {
  if (views <= 0 || likes <= 0) return 0;
  const rate = likes / views;
  const score = Math.min(1, rate / 0.05) * 25;
  return Math.max(0, Math.round(score));
}

/**
 * Calcula score de intenção de compra (0–15).
 * Conta quantas keywords de compra aparecem na descrição.
 *
 * @param {string} descricao
 * @returns {number}
 */
function keywordScore(descricao) {
  if (!descricao) return 0;
  const lower = descricao.toLowerCase();
  const hits = PURCHASE_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  if (hits === 0) return 0;
  if (hits === 1) return 8;
  return 15;
}

/**
 * Calcula score de recência (0–20).
 * Vídeos recentes têm maior potencial — produtos antigos tendem a estar saturados.
 *
 * Tabela de penalidade:
 *   < 30 dias   → 20 pts (sem penalidade)
 *   30–90 dias  → 15 pts
 *   90–180 dias → 10 pts
 *   180–365 dias→  5 pts
 *   > 365 dias  →  0 pts
 *   sem data    → 10 pts (neutro)
 *
 * @param {number|null} createTime - Unix timestamp em segundos
 * @returns {{ score: number, idadeDias: number|null }}
 */
function recencyScore(createTime) {
  if (!createTime) return { score: 10, idadeDias: null };

  const agora = Date.now();
  const idadeDias = Math.floor((agora - createTime * 1000) / (1000 * 60 * 60 * 24));

  let score;
  if (idadeDias < 30)        score = 20;
  else if (idadeDias < 90)   score = 15;
  else if (idadeDias < 180)  score = 10;
  else if (idadeDias < 365)  score =  5;
  else                       score =  0;

  return { score, idadeDias };
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
  const { score: rScore, idadeDias } = recencyScore(video.createTime ?? null);
  const total  = vScore + eScore + kScore + rScore;

  const { label, emoji } = classify(total);

  const engRate = viewsNum > 0 ? ((likesNum / viewsNum) * 100).toFixed(1) : '—';

  // Formata a data de publicação para exibição
  let dataPublicacao = '—';
  if (video.createTime) {
    dataPublicacao = new Date(video.createTime * 1000)
      .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  return {
    ...video,
    produto:         extractProduct(video.descricao),
    viewsNum,
    likesNum,
    engRate:         engRate === '—' ? '—' : `${engRate}%`,
    idadeDias,
    dataPublicacao,
    score:           total,
    viabilidade:     `${emoji} ${label}`,
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

/**
 * Calcula score posicional para produtos do Mercado Livre (0–100).
 * Substitui o score de views/engajamento, pois produtos ML não têm essas métricas.
 *
 * Tabela de pontos base por tipo:
 *   MAIOR_CRESCIMENTO posição 1–3  → 80–100 pts
 *   MAIOR_CRESCIMENTO posição 4–10 → 60–79 pts
 *   MAIS_DESEJADA     posição 1–5  → 60–80 pts
 *   MAIS_DESEJADA     posição 6–10 → 45–59 pts
 *   MAIS_POPULAR      posição 1–10 → 40–65 pts
 *   Qualquer tipo     posição > 10 → penalidade de 15%
 *
 * @param {number} posicao
 * @param {string} tipo - "MAIOR_CRESCIMENTO" | "MAIS_DESEJADA" | "MAIS_POPULAR"
 * @returns {number}
 */
function posicaoScore(posicao, tipo) {
  let base;

  if (tipo === 'MAIOR_CRESCIMENTO') {
    if (posicao <= 3)  base = 100 - (posicao - 1) * 10; // 100, 90, 80
    else if (posicao <= 10) base = 79 - (posicao - 4) * 3; // 79…58
    else base = 50;
  } else if (tipo === 'MAIS_DESEJADA') {
    if (posicao <= 5)  base = 80 - (posicao - 1) * 5; // 80, 75, 70, 65, 60
    else if (posicao <= 10) base = 59 - (posicao - 6) * 3; // 59…47
    else base = 40;
  } else {
    // MAIS_POPULAR e desconhecidos
    if (posicao <= 10) base = 65 - (posicao - 1) * 3; // 65…38
    else base = 35;
  }

  // Penalidade de 15% para posições > 10
  if (posicao > 10) base = Math.round(base * 0.85);

  return Math.min(100, Math.max(0, base));
}

/**
 * Calcula score final combinando heurística e score LLM.
 *
 * Pesos por fonte:
 *   'tiktok'       → 65% heurístico + 35% LLM  (dados ricos de engajamento)
 *   'mercadolivre' → 35% posicional + 65% LLM  (dados de posição apenas)
 *
 * @param {number} heuristicScore - score do analyzer heurístico (0–100)
 * @param {number} llmScore       - score_llm retornado pelo LLM (0–100)
 * @param {string} fonte          - 'tiktok' | 'mercadolivre'
 * @returns {number} score combinado arredondado
 */
function mergeScores(heuristicScore, llmScore, fonte) {
  if (fonte === 'mercadolivre') {
    return Math.round(heuristicScore * 0.35 + llmScore * 0.65);
  }
  // tiktok ou qualquer outra fonte
  return Math.round(heuristicScore * 0.65 + llmScore * 0.35);
}

/**
 * Analisa um produto do Mercado Livre (sem views/likes) e retorna objeto enriquecido.
 * Usa posicaoScore em vez de viewsScore/engagementScore.
 *
 * @param {Object} produto - { nome, categoria, posicao, tipo, url, fonte }
 * @returns {Object}
 */
function analisarProdutoML(produto) {
  const hScore = posicaoScore(produto.posicao || 99, produto.tipo || 'MAIS_POPULAR');
  const { label, emoji } = classify(hScore);

  return {
    ...produto,
    produto:      produto.nome,
    viewsNum:     0,
    likesNum:     0,
    engRate:      '—',
    idadeDias:    null,
    dataPublicacao: '—',
    scoreHeuristico: hScore,
    score:        hScore,       // será substituído por mergeScores após LLM
    viabilidade:  `${emoji} ${label}`,
  };
}

module.exports = { analyzeAll, analyzeVideo, analisarProdutoML, posicaoScore, mergeScores, parseMetric, classify };
