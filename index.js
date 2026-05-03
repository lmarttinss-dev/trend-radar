/**
 * index.js
 * Ponto de entrada do scraper de vídeos virais do TikTok.
 *
 * Uso:
 *   node index.js
 *
 * Configuração rápida:
 *   HEADLESS=true node index.js   → roda sem janela do browser
 *   LIMIT=10 node index.js        → limita a 10 vídeos por hashtag
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Carrega variáveis do arquivo .env (se existir) sem dependência de dotenv
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8')
    .split('\n')
    .forEach((linha) => {
      const l = linha.trim();
      if (!l || l.startsWith('#')) return;
      const idx = l.indexOf('=');
      if (idx === -1) return;
      const chave = l.substring(0, idx).trim();
      const valor = l.substring(idx + 1).trim();
      if (chave && !(chave in process.env)) process.env[chave] = valor;
    });
}
const { getRandomUserAgent, randomDelay, log, keywordParaAlibaba } = require('./src/utils');
const { scrapeHashtag, applyStealthPatches } = require('./src/scraper');
const { analyzeAll, mergeScores, classify } = require('./src/analyzer');
const { analisarLote, obterAnalise } = require('./src/llm');
const { buscarFornecedoresParaProdutos } = require('./src/scraperAlibaba');
const { generateReport } = require('./src/reporter');

const SESSION_PATH  = path.join(__dirname, 'auth', 'session.json');
// Perfil persistente: mantém histórico, cache e IndexedDB entre execuções,
// o que faz o browser parecer muito mais real para o TikTok.
const USER_DATA_DIR = path.join(__dirname, 'auth', 'chrome-profile');

// ─── Configurações ────────────────────────────────────────────────────────────

// Hashtags alvo — adicione ou remova conforme necessário
const HASHTAGS = ['tiktokmademebuyit', 'amazonfinds'];

// Número máximo de vídeos por hashtag
const LIMIT = parseInt(process.env.LIMIT ?? '20', 10);

// false = abre janela do browser (recomendado para evitar bloqueio)
// true  = roda em background (mais rápido, mais chance de bloqueio)
const HEADLESS = process.env.HEADLESS === 'true';

// Habilita análise LLM (requer ANTHROPIC_API_KEY no ambiente)
const LLM_ENABLED = process.env.LLM_ENABLED !== 'false';
const LLM_MODEL   = (process.env.LLM_MODEL || 'claude-haiku-4-5').trim();

// Habilita busca de fornecedores no Alibaba (Trade Assurance + Verified)
const ALIBABA_ENABLED = process.env.ALIBABA_ENABLED !== 'false';
const ALIBABA_LIMITE  = parseInt(process.env.ALIBABA_LIMITE ?? '3', 10);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('=== Trend Radar — TikTok Scraper ===');
  log(`Hashtags: ${HASHTAGS.map((h) => `#${h}`).join(', ')}`);
  log(`Limite: ${LIMIT} vídeos por hashtag | Headless: ${HEADLESS} | LLM: ${LLM_ENABLED}${LLM_ENABLED ? ` (${LLM_MODEL})` : ''} | Alibaba: ${ALIBABA_ENABLED}`);
  log('');

  const userAgent = getRandomUserAgent();
  log(`User-Agent: ${userAgent}`);

  // Verifica se existe sessão salva pelo login.js
  const hasSession = fs.existsSync(SESSION_PATH);
  if (hasSession) {
    log('Sessão encontrada em auth/session.json — usando cookies do login.');
  } else {
    log('Aviso: sem sessão salva. Para evitar CAPTCHA, rode: node login.js');
  }

  // Usa launchPersistentContext quando disponível: mantém histórico, cache e
  // IndexedDB do Chrome entre execuções, tornando o browser indistinguível
  // de um usuário real que visita o TikTok regularmente.
  let browser;
  let context;

  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    userAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    permissions: ['geolocation'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ],
    // Carrega cookies de sessão do login.js se existirem
    ...(hasSession ? { storageState: SESSION_PATH } : {}),
  });

  // Aplica patches de stealth antes de qualquer navegação
  await applyStealthPatches(context);

  const allResults = {};

  for (const hashtag of HASHTAGS) {
    log(`\n── Iniciando coleta: #${hashtag} ──`);

    const videos = await scrapeHashtag(context, hashtag, LIMIT);
    allResults[hashtag] = videos;

    log(`Coletados ${videos.length} vídeos para #${hashtag}`);

    // Pausa entre hashtags para não parecer um bot agressivo
    if (HASHTAGS.indexOf(hashtag) < HASHTAGS.length - 1) {
      const pause = 4000 + Math.random() * 3000;
      log(`Aguardando ${(pause / 1000).toFixed(1)}s antes da próxima hashtag...`);
      await randomDelay(4000, 7000);
    }
  }

  await context.close();

  // ─── Análise heurística (TikTok) ──────────────────────────────────────────
  log('\nAnalisando viabilidade de revenda...');
  const analyzedResults = analyzeAll(allResults);

  // ─── Análise LLM ──────────────────────────────────────────────────────────
  let llmMap = new Map();

  if (LLM_ENABLED) {
    log('\nIniciando análise LLM (Claude Haiku 4.5)...');

    // Consolida produtos TikTok para análise em lote
    const todosProdutos = Object.values(analyzedResults).flat().map((v) => ({
      nome:      v.produto,
      categoria: 'TikTok Virais',
      fonte:     'tiktok',
    })).filter((p) => p.nome && p.nome !== '—');

    llmMap = await analisarLote(todosProdutos);

    // Aplica merge de scores nos vídeos do TikTok
    for (const videos of Object.values(analyzedResults)) {
      for (const v of videos) {
        const analise = obterAnalise(llmMap, v.produto);
        v.scoreHeuristico = v.score;
        v.score    = mergeScores(v.score, analise.score_llm);
        v.analise  = analise;
        const { label, emoji } = classify(v.score);
        v.viabilidade = `${emoji} ${label}`;
      }
    }

  }

  // ─── Busca fornecedores no Alibaba ────────────────────────────────────────
  let alibabaResultados = new Map();

  if (ALIBABA_ENABLED) {
    log('\nIniciando busca de fornecedores no Alibaba...');

    // Re-abre o browser para o Alibaba (contexto isolado do TikTok/ML)
    const alibabaContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: HEADLESS,
      userAgent: getRandomUserAgent(),
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/Sao_Paulo',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
    });
    await applyStealthPatches(alibabaContext);

    // Monta lista de produtos viáveis com suas keywords em inglês
    const produtosViaveis = [
      ...Object.values(analyzedResults).flat()
        .filter((v) => v.analise && v.analise.regime_importacao !== 'nao_viavel' && v.score >= 70)
        .map((v) => ({ nomeProduto: v.produto, keyword: keywordParaAlibaba(v.produto) })),
    ].filter((p) => p.keyword.length > 0);

    log(`alibaba: ${produtosViaveis.length} produto(s) viável(is) para pesquisa de fornecedores`);

    if (produtosViaveis.length > 0) {
      alibabaResultados = await buscarFornecedoresParaProdutos(alibabaContext, produtosViaveis, ALIBABA_LIMITE);
    }

    await alibabaContext.close().catch(() => null);
    log(`alibaba: busca concluída — ${alibabaResultados.size} keyword(s) processada(s)`);
  }

  const reportPath = await generateReport(analyzedResults, LLM_ENABLED, LLM_MODEL, alibabaResultados);
  log(`Relatório salvo em: ${reportPath}`);

  // ─── Saída no console ──────────────────────────────────────────────────────
  console.log('\n');
  log('=== RESULTADO FINAL ===\n');
  for (const [hashtag, videos] of Object.entries(analyzedResults)) {
    console.log(`\n📌 #${hashtag} — ${videos.length} vídeos coletados`);
    console.log('─'.repeat(60));

    if (videos.length === 0) {
      console.log(
        '  ⚠️  Nenhum vídeo coletado. Possíveis causas:\n' +
        '     • TikTok exibiu CAPTCHA ou desafio de bot\n' +
        '     • Seletores desatualizados (estrutura do DOM mudou)\n' +
        '     • Bloqueio por IP/UA — tente HEADLESS=false\n'
      );
      continue;
    }

    videos.forEach((v, i) => {
      console.log(`\n  [${i + 1}] ${v.viabilidade} (score: ${v.score}) — ${v.url}`);
      if (v.produto)  console.log(`       Produto   : ${v.produto.substring(0, 80)}`);
      if (v.views)    console.log(`       Views     : ${v.views}  |  Engajamento: ${v.engRate}`);
      if (v.likes)    console.log(`       Likes     : ${v.likes}`);
      if (v.analise)  console.log(`       Importação: ${v.analise.regime_importacao} | Score LLM: ${v.analise.score_llm} | ${v.analise.justificativa}`);
    });
  }

  // Saída JSON completa (pode ser redirecionada para arquivo)
  console.log('\n\n=== JSON OUTPUT ===\n');
  console.log(JSON.stringify({ tiktok: analyzedResults }, null, 2));
}

main().catch((err) => {
  log(`Erro fatal: ${err.message}`);
  process.exit(1);
});
