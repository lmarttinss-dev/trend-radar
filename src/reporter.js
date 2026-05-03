/**
 * reporter.js
 * Gera relatório .md de viabilidade de revenda a partir dos vídeos analisados.
 * Salva em reports/relatorio-YYYY-MM-DD.md
 */

const fs   = require('fs');
const path = require('path');
const { log } = require('./utils');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

/**
 * Formata número grande com separador de milhar.
 * Ex: 2100000 → "2.100.000"
 */
function fmtNum(n) {
  if (!n || n === 0) return '—';
  return n.toLocaleString('pt-BR');
}

/**
 * Gera a seção de uma hashtag: sumário + tabela de vídeos.
 *
 * @param {string}  hashtag
 * @param {Array}   videos      — vídeos já analisados pelo analyzer
 * @param {boolean} llmEnabled
 * @returns {string}
 */
function buildHashtagSection(hashtag, videos, llmEnabled = false) {
  const lines = [];
  lines.push(`## #${hashtag}\n`);

  if (!videos || videos.length === 0) {
    lines.push('> ⚠️ Nenhum vídeo coletado para esta hashtag.\n');
    return lines.join('\n');
  }

  // ── Sumário ──────────────────────────────────────────────────────────────
  const totalViews  = videos.reduce((s, v) => s + (v.viewsNum || 0), 0);
  const avgViews    = Math.round(totalViews / videos.length);
  const bestVideo   = [...videos].sort((a, b) => b.score - a.score)[0];
  const altoCount   = videos.filter((v) => v.score >= 70).length;
  const medioCount  = videos.filter((v) => v.score >= 40 && v.score < 70).length;
  const baixoCount  = videos.filter((v) => v.score < 40).length;

  lines.push('### Sumário');
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Vídeos coletados | ${videos.length} |`);
  lines.push(`| Média de views | ${fmtNum(avgViews)} |`);
  lines.push(`| 🟢 Alta viabilidade | ${altoCount} vídeo(s) |`);
  lines.push(`| 🟡 Média viabilidade | ${medioCount} vídeo(s) |`);
  lines.push(`| 🔴 Baixa viabilidade | ${baixoCount} vídeo(s) |`);
  lines.push(`| Melhor score | ${bestVideo.score}/100 — ${bestVideo.produto} |`);
  lines.push('');

  // ── Tabela de vídeos (ordenada por score, maior primeiro) ────────────────
  const sorted = [...videos].sort((a, b) => b.score - a.score);

  lines.push('### Vídeos');

  if (llmEnabled) {
    lines.push('| # | Produto / Descrição | Publicado | Views | Likes | Engaj. | Score | LLM | Viabilidade | Link |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|---|---|');
  } else {
    lines.push('| # | Produto / Descrição | Publicado | Views | Likes | Engaj. | Score | Viabilidade | Link |');
    lines.push('|---|---|---|---:|---:|---:|---:|---|---|');
  }

  sorted.forEach((v, i) => {
    const produto = v.produto.replace(/\|/g, '\\|').substring(0, 55);
    const idade = v.idadeDias !== null ? `${v.dataPublicacao} (${v.idadeDias}d)` : v.dataPublicacao;

    if (llmEnabled && v.analise) {
      lines.push(
        `| ${i + 1} | ${produto} | ${idade} | ${fmtNum(v.viewsNum)} | ${fmtNum(v.likesNum)} | ${v.engRate} | ${v.score} | ${v.analise.score_llm} | ${v.viabilidade} | [ver](${v.url}) |`
      );
    } else {
      lines.push(
        `| ${i + 1} | ${produto} | ${idade} | ${fmtNum(v.viewsNum)} | ${fmtNum(v.likesNum)} | ${v.engRate} | ${v.score} | ${v.viabilidade} | [ver](${v.url}) |`
      );
    }
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * Gera seção "Top 5 Oportunidades" consolidada entre todas as hashtags.
 *
 * @param {Object} analyzedResults
 * @returns {string}
 */
function buildTop5Section(analyzedResults) {
  const allVideos = Object.entries(analyzedResults).flatMap(([hashtag, videos]) =>
    videos.map((v) => ({ ...v, hashtag }))
  );

  if (allVideos.length === 0) return '';

  const top5 = [...allVideos]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const lines = [];
  lines.push('## 🏆 Top 5 Oportunidades de Revenda\n');
  lines.push('> Vídeos com maior score consolidado entre todas as hashtags.\n');
  lines.push('| Rank | Produto / Descrição | Hashtag | Publicado | Views | Engaj. | Score | Viabilidade | Link |');
  lines.push('|---:|---|---|---|---:|---:|---:|---|---|');

  top5.forEach((v, i) => {
    const produto = v.produto.replace(/\|/g, '\\|').substring(0, 55);
    const idade = v.idadeDias !== null ? `${v.dataPublicacao} (${v.idadeDias}d)` : v.dataPublicacao;
    lines.push(
      `| ${i + 1} | ${produto} | #${v.hashtag} | ${idade} | ${fmtNum(v.viewsNum)} | ${v.engRate} | ${v.score} | ${v.viabilidade} | [ver](${v.url}) |`
    );
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * Gera seção de importação simplificada — produtos filtrados pelo LLM.
 * Filtro: regime != 'nao_viavel' E score_llm >= 70
 *
 * @param {Object} analyzedResults — vídeos do TikTok analisados
 * @returns {string}
 */
function buildImportacaoSection(analyzedResults) {
  const candidatos = [];

  for (const [hashtag, videos] of Object.entries(analyzedResults || {})) {
    for (const v of videos) {
      if (!v.analise) continue;
      candidatos.push({ ...v, nomeProduto: v.produto, origemLabel: `TikTok #${hashtag}` });
    }
  }

  const viaveis = candidatos
    .filter((p) => p.analise.regime_importacao !== 'nao_viavel' && p.analise.score_llm >= 70)
    .sort((a, b) => b.score - a.score);

  const lines = [];
  lines.push('## 🚀 Produtos Viáveis para Importação Simplificada\n');
  lines.push('> Filtro: regime de importação viável + score LLM ≥ 70. Ordenados por score combinado.\n');

  if (viaveis.length === 0) {
    lines.push('> ⚠️ Nenhum produto atingiu o critério mínimo nesta execução.\n');
    return lines.join('\n');
  }

  lines.push('| # | Produto | Origem | Regime | Restrições | Fontes | Ticket USD | Margem | Logística | Score | Link | Justificativa |');
  lines.push('|---:|---|---|---|---|---|---|---|---|---:|:---:|---|');

  viaveis.forEach((p, i) => {
    const a = p.analise;
    const regime = a.regime_importacao === 'remessa_ate_50usd'
      ? '📦 Remessa ≤ $50'
      : '💼 PF ≤ $500';
    const restricoes = Array.isArray(a.restricao_regulatoria) && a.restricao_regulatoria.length
      ? `⚠️ ${a.restricao_regulatoria.join(', ')}`
      : '✅ Livre';
    const fontes = Array.isArray(a.fonte_sugerida) ? a.fonte_sugerida.join(', ') : '—';
    const nome   = (p.nomeProduto || '—').replace(/\|/g, '\\|').substring(0, 50);
    const just   = (a.justificativa || '—').replace(/\|/g, '\\|').substring(0, 80);
    const link   = p.url ? `[ver](${p.url})` : '—';

    lines.push(
      `| ${i + 1} | ${nome} | ${p.origemLabel} | ${regime} | ${restricoes} | ${fontes} | ${a.ticket_estimado_usd || '—'} | ${a.margem_estimada || '—'} | ${a.facilidade_logistica || '—'} | ${p.score} | ${link} | ${just} |`
    );
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * Gera seção com fornecedores encontrados no Alibaba.
 *
 * @param {Map<string, Array>} alibabaResultados - mapa keyword → fornecedores
 * @returns {string}
 */
function buildAlibabaSection(alibabaResultados) {
  const lines = [];
  lines.push('## 🏭 Fornecedores no Alibaba\n');
  lines.push('> Filtro: Trade Assurance + Verified Supplier. Ordenados por keyword.\n');

  for (const [keyword, fornecedores] of alibabaResultados.entries()) {
    if (!fornecedores || fornecedores.length === 0) continue;

    lines.push(`### ${keyword}\n`);
    lines.push('| Fornecedor | País | Preço Unit. | MOQ | Gold Sup. | Trade Ass. | Verificado | Produto | Link |');
    lines.push('|---|---|---|---|---|:---:|:---:|---|:---:|');

    for (const f of fornecedores) {
      const nome      = (f.nomeFornecedor || '—').replace(/\|/g, '\\|').substring(0, 40);
      const produto   = (f.nomeProduto   || '—').replace(/\|/g, '\\|').substring(0, 45);
      const ta        = f.tradeAssurance ? '✅' : '❌';
      const verificado = f.verificado    ? '✅' : '❌';
      const linkProd  = f.urlProduto     ? `[ver](${f.urlProduto})` : '—';

      lines.push(
        `| ${nome} | ${f.pais || 'China'} | ${f.precoUnitario || '—'} | ${f.moq || '—'} | ${f.anosGoldSupplier || '—'} | ${ta} | ${verificado} | ${produto} | ${linkProd} |`
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Constrói e salva o relatório .md completo.
 *
 * @param {Object}  analyzedResults - Resultado do analyzeAll() (TikTok)
 * @param {boolean} llmEnabled      - Se análise LLM foi executada
 * @returns {Promise<string>} Caminho do arquivo gerado
 */
async function generateReport(analyzedResults, llmEnabled = false, llmModelo = 'claude-haiku-4-5', alibabaResultados = new Map()) {
  const date     = new Date().toISOString().substring(0, 10);
  const datetime = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hashtags = Object.keys(analyzedResults);
  const totalTiktok = Object.values(analyzedResults).reduce((s, v) => s + v.length, 0);
  const totalAlibabaFornecedores = [...alibabaResultados.values()].reduce((s, arr) => s + arr.length, 0);

  const lines = [];

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  lines.push(`# Trend Radar — Relatório de Viabilidade de Revenda`);
  lines.push('');
  lines.push(`**Gerado em:** ${datetime}  `);
  lines.push(`**Hashtags TikTok:** ${hashtags.map((h) => `#${h}`).join(', ')}  `);
  lines.push(`**Vídeos TikTok coletados:** ${totalTiktok}  `);
  lines.push(`**Análise LLM:** ${llmEnabled ? `✅ Habilitada (${llmModelo})` : '⚠️ Desabilitada'}  `);
  lines.push(`**Fornecedores Alibaba:** ${totalAlibabaFornecedores > 0 ? `✅ ${totalAlibabaFornecedores} encontrado(s)` : '—'}  `);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Índice de navegação ───────────────────────────────────────────────────
  lines.push('## Índice\n');
  if (llmEnabled) {
    lines.push('- [🚀 Produtos Viáveis para Importação Simplificada](#-produtos-viáveis-para-importação-simplificada)');
  }
  if (totalAlibabaFornecedores > 0) {
    lines.push('- [🏭 Fornecedores no Alibaba](#-fornecedores-no-alibaba)');
  }
  lines.push('- [🏆 Top 5 Oportunidades de Revenda](#-top-5-oportunidades-de-revenda)');
  for (const hashtag of Object.keys(analyzedResults)) {
    lines.push(`- [#${hashtag}](#${hashtag})`);
  }
  lines.push('- [Metodologia do Score](#metodologia-do-score)');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Seção de importação simplificada (LLM) ────────────────────────────────
  if (llmEnabled) {
    lines.push(buildImportacaoSection(analyzedResults));
    lines.push('---');
    lines.push('');
  }
  // ── Seção de fornecedores Alibaba ────────────────────────────────────
  if (totalAlibabaFornecedores > 0) {
    lines.push(buildAlibabaSection(alibabaResultados));
    lines.push('---');
    lines.push('');
  }
  // ── Top 5 TikTok ──────────────────────────────────────────────────────────
  lines.push(buildTop5Section(analyzedResults));
  lines.push('---');
  lines.push('');

  // ── Seção por hashtag ──────────────────────────────────────────────────
  for (const [hashtag, videos] of Object.entries(analyzedResults)) {
    lines.push(buildHashtagSection(hashtag, videos, llmEnabled));
    lines.push('---');
    lines.push('');
  }


  // ── Metodologia ───────────────────────────────────────────────────────────
  lines.push('## Metodologia do Score\n');
  lines.push('### Score Heurístico — Vídeos TikTok (0–100)\n');
  lines.push('| Componente | Peso | Critério |');
  lines.push('|---|---:|---|');
  lines.push('| Views score | 40 pts | Escala logarítmica — 1M views ≈ 40 pts |');
  lines.push('| Engagement rate | 25 pts | likes ÷ views — 5%+ = máximo |');
  lines.push('| Intenção de compra | 15 pts | Keywords na descrição (amazon, link, haul…) |');
  lines.push('| Recência | 20 pts | < 30d = 20 · 30–90d = 15 · 90–180d = 10 · 180–365d = 5 · > 365d = 0 |');
  lines.push('');

  if (llmEnabled) {
    lines.push('### Score Combinado com LLM\n');
    lines.push('| Fonte | Peso Heurístico | Peso LLM |');
    lines.push('|---|---:|---:|');
    lines.push('| TikTok | 65% | 35% |');
    lines.push('');
    lines.push('### Critérios LLM — Importação\n');
    lines.push('| Regime | Critério |');
    lines.push('|---|---|');
    lines.push('| 📦 Remessa ≤ $50 | Produto único até USD 50 — isento de imposto (programa Remessa Conforme) |');
    lines.push('| 💼 PF ≤ $500 | Importação pessoa física até USD 500 — tributação simplificada 20% |');
    lines.push('| ❌ Inviável | Proibido, perigoso, regulado ou margem inviável |');
    lines.push('');
  }

  lines.push('**Classificação:** 🟢 Alto ≥ 70 pts · 🟡 Médio 40–69 pts · 🔴 Baixo < 40 pts');
  lines.push('');

  // ── Salvar arquivo ────────────────────────────────────────────────────────
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filePath = path.join(REPORTS_DIR, `relatorio-${date}.md`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  return filePath;
}

module.exports = { generateReport };
