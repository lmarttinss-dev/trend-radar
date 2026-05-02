/**
 * reporter.js
 * Gera relatório .md de viabilidade de revenda a partir dos vídeos analisados.
 * Salva em reports/relatorio-YYYY-MM-DD.md
 */

const fs   = require('fs');
const path = require('path');

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
 * @param {string} hashtag
 * @param {Array}  videos  — vídeos já analisados pelo analyzer
 * @returns {string}
 */
function buildHashtagSection(hashtag, videos) {
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
  lines.push('| # | Produto / Descrição | Publicado | Views | Likes | Engaj. | Score | Viabilidade | Link |');
  lines.push('|---|---|---|---:|---:|---:|---:|---|---|');

  sorted.forEach((v, i) => {
    const produto = v.produto.replace(/\|/g, '\\|').substring(0, 55);
    const idade = v.idadeDias !== null ? `${v.dataPublicacao} (${v.idadeDias}d)` : v.dataPublicacao;
    lines.push(
      `| ${i + 1} | ${produto} | ${idade} | ${fmtNum(v.viewsNum)} | ${fmtNum(v.likesNum)} | ${v.engRate} | ${v.score} | ${v.viabilidade} | [ver](${v.url}) |`
    );
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
 * Constrói e salva o relatório .md completo.
 *
 * @param {Object} analyzedResults - Resultado do analyzeAll()
 * @returns {string} Caminho do arquivo gerado
 */
function generateReport(analyzedResults) {
  const date     = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
  const datetime = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hashtags = Object.keys(analyzedResults);
  const total    = Object.values(analyzedResults).reduce((s, v) => s + v.length, 0);

  const lines = [];

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  lines.push(`# Trend Radar — Relatório de Viabilidade de Revenda`);
  lines.push('');
  lines.push(`**Gerado em:** ${datetime}  `);
  lines.push(`**Hashtags analisadas:** ${hashtags.map((h) => `#${h}`).join(', ')}  `);
  lines.push(`**Total de vídeos coletados:** ${total}  `);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Top 5 ─────────────────────────────────────────────────────────────────
  lines.push(buildTop5Section(analyzedResults));
  lines.push('---');
  lines.push('');

  // ── Seção por hashtag ─────────────────────────────────────────────────────
  for (const [hashtag, videos] of Object.entries(analyzedResults)) {
    lines.push(buildHashtagSection(hashtag, videos));
    lines.push('---');
    lines.push('');
  }

  // ── Metodologia ───────────────────────────────────────────────────────────
  lines.push('## Metodologia do Score\n');
  lines.push('O score (0–100) é calculado de forma heurística, sem IA:\n');
  lines.push('| Componente | Peso | Critério |');
  lines.push('|---|---:|---|');
  lines.push('| Views score | 40 pts | Escala logarítmica — 1M views ≈ 40 pts |');
  lines.push('| Engagement rate | 25 pts | likes ÷ views — 5%+ = máximo |');
  lines.push('| Intenção de compra | 15 pts | Keywords na descrição (amazon, link, haul…) |');
  lines.push('| Recência | 20 pts | < 30d = 20 · 30–90d = 15 · 90–180d = 10 · 180–365d = 5 · > 365d = 0 |');
  lines.push('');
  lines.push('**Classificação:** 🟢 Alto ≥ 70 pts · 🟡 Médio 40–69 pts · 🔴 Baixo < 40 pts');
  lines.push('');

  // ── Salvar arquivo ────────────────────────────────────────────────────────
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filePath = path.join(REPORTS_DIR, `relatorio-${date}.md`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  return filePath;
}

module.exports = { generateReport };
