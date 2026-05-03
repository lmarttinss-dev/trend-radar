/**
 * llm.js
 * Análise de viabilidade de importação via LLM configurável.
 *
 * Modelos suportados (variável LLM_MODEL):
 *   claude-haiku-4-5  → Anthropic (requer ANTHROPIC_API_KEY)
 *   gemini-2.5-flash  → Google    (requer GEMINI_API_KEY)
 *
 * Para cada produto, o LLM retorna:
 *   - regime_importacao : "remessa_ate_50usd" | "pf_ate_500usd" | "nao_viavel"
 *   - fonte_sugerida    : array de plataformas (AliExpress, Alibaba, Shopee…)
 *   - ticket_estimado_usd: range estimado em USD (ex: "$5–$15")
 *   - margem_estimada   : "baixa" | "media" | "alta"
 *   - facilidade_logistica: "alta" | "media" | "baixa"
 *   - riscos            : array de strings
 *   - score_llm         : 0–100
 *   - justificativa     : string (1 frase)
 *
 * Cache persistido em data/llm-cache.json (chave inclui nome do modelo).
 */

const fs   = require('fs');
const path = require('path');
const { randomDelay, log } = require('./utils');

const CACHE_PATH     = path.join(__dirname, '..', 'data', 'llm-cache.json');
const MAX_TOKENS     = 512;
const PROMPT_VERSION = 'v2'; // incrementar ao alterar SYSTEM_PROMPT para invalidar cache

// Modelos suportados → provedor
const MODELOS_SUPORTADOS = {
  'claude-haiku-4-5': 'anthropic',
  'gemini-2.5-flash': 'google',
};

/**
 * Retorna o modelo configurado via LLM_MODEL (padrão: claude-haiku-4-5).
 * Valida contra a lista de suportados.
 *
 * @returns {string}
 */
function resolverModelo() {
  const modelo = (process.env.LLM_MODEL || 'claude-haiku-4-5').trim();
  if (!MODELOS_SUPORTADOS[modelo]) {
    log(`llm: modelo "${modelo}" não suportado. Use: ${Object.keys(MODELOS_SUPORTADOS).join(' | ')}`);
    log('llm: usando claude-haiku-4-5 como fallback');
    return 'claude-haiku-4-5';
  }
  return modelo;
}

/**
 * Retorna o provedor ('anthropic' | 'google') para o modelo dado.
 *
 * @param {string} modelo
 * @returns {string}
 */
function resolverProvedor(modelo) {
  return MODELOS_SUPORTADOS[modelo] || 'anthropic';
}

// Score padrão retornado quando o LLM falha ou está desabilitado
const ANALISE_FALLBACK = {
  regime_importacao:     'nao_viavel',
  restricao_regulatoria: [],
  fonte_sugerida:        [],
  ticket_estimado_usd:   '—',
  margem_estimada:       'baixa',
  facilidade_logistica:  'baixa',
  riscos:                ['Análise indisponível'],
  score_llm:             0,
  justificativa:         'Análise LLM não disponível.',
};

const SYSTEM_PROMPT = `Você é especialista em importação brasileira e revenda online. Avalie produtos virais para importação simplificada no Brasil.

Responda SOMENTE com JSON válido, sem markdown, sem explicações fora do JSON.

## CRITÉRIO PRIMÁRIO — Característica do produto

Classifique "regime_importacao" considerando PRIMEIRO as restrições físicas e regulatórias do produto:

SEMPRE "nao_viavel" independente do preço:
- Alimentos, bebidas, suplementos alimentares, vitaminas → exige ANVISA + MAPA
- Medicamentos, cosméticos com fórmulas farmacêuticas → ANVISA
- Equipamentos médicos ou odontológicos → ANVISA classe II+
- Armas, munições, réplicas, fogos de artifício
- Eletrônicos com transmissão sem fio (Wi-Fi, 4G/5G, rádio, Bluetooth de potência) → homologação ANATEL obrigatória
- Produtos com bateria de lítio integrada não removível → restrição severa de transporte aéreo (DGR)
- Perfumes, aerossóis, líquidos inflamáveis → DGR
- Brinquedos com certificação INMETRO obrigatória não disponível no fabricante

"remessa_ate_50usd" (Remessa Conforme — isento de imposto):
- Produto único ≤ USD 50 E sem nenhuma das restrições acima
- Exemplos viáveis: utensílios de cozinha, organizadores, acessórios sem eletrônica embarcada, gadgets mecânicos

"pf_ate_500usd" (Importação Pessoa Física — tributação 20%):
- Produto entre USD 51–500 E sem nenhuma das restrições acima
- Margem após imposto ainda justifica revenda

## CAMPOS OBRIGATÓRIOS

- "regime_importacao": "remessa_ate_50usd" | "pf_ate_500usd" | "nao_viavel"
- "restricao_regulatoria": array com órgãos/regras aplicáveis ou []. Use: ANVISA, ANATEL, INMETRO, MAPA, DGR
- "fonte_sugerida": array de plataformas de sourcing (ex: ["AliExpress", "Shopee"])
- "ticket_estimado_usd": string com range CIF estimado (ex: "$3–$12")
- "margem_estimada": "alta" (>60%) | "media" (30–60%) | "baixa" (<30%)
- "facilidade_logistica": "alta" (leve, compacto, sem restrição) | "media" | "baixa" (frágil, volumoso, bateria, regulado)
- "riscos": array com até 3 riscos principais
- "score_llm": inteiro 0–100. Produtos com restricao_regulatoria não vazia devem receber no máximo 20 pts
- "justificativa": 1 frase explicando o regime escolhido e o score`;

/**
 * Carrega o cache do disco.
 * Cria arquivo vazio se não existir.
 *
 * @returns {Object}
 */
function carregarCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    if (!fs.existsSync(CACHE_PATH)) {
      fs.writeFileSync(CACHE_PATH, '{}', 'utf8');
      return {};
    }
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Persiste o cache no disco.
 *
 * @param {Object} cache
 */
function salvarCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    log(`llm: erro ao salvar cache — ${err.message}`);
  }
}

/**
 * Normaliza o nome do produto para uso como chave de cache.
 *
 * @param {string} nome
 * @returns {string}
 */
function normalizarChave(nome) {
  return nome.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Chama a API da Anthropic e retorna o texto bruto da resposta.
 *
 * @param {string} apiKey
 * @param {string} modelo
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function chamarAnthropic(apiKey, modelo, userPrompt) {
  const { Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const mensagem = await client.messages.create({
    model:      modelo,
    max_tokens: MAX_TOKENS,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  return mensagem.content[0]?.text || '';
}

/**
 * Chama a API do Google Gemini e retorna o texto bruto da resposta.
 *
 * @param {string} apiKey
 * @param {string} modelo
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function chamarGemini(apiKey, modelo, userPrompt) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const resposta = await ai.models.generateContent({
    model:    modelo,
    contents: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
  });

  return resposta.text || '';
}

/**
 * Extrai o primeiro objeto JSON bem-formado de uma string.
 * Robusto contra texto antes/depois do JSON e markdown ao redor.
 *
 * @param {string} texto
 * @returns {Object|null}
 */
function extrairPrimeiroJSON(texto) {
  const inicio = texto.indexOf('{');
  if (inicio === -1) return null;

  let profundidade = 0;
  let emString     = false;
  let escape       = false;

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];

    if (escape) { escape = false; continue; }
    if (c === '\\' && emString) { escape = true; continue; }
    if (c === '"') { emString = !emString; continue; }
    if (emString) continue;

    if (c === '{') profundidade++;
    else if (c === '}') {
      profundidade--;
      if (profundidade === 0) {
        try {
          return JSON.parse(texto.slice(inicio, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Analisa um único produto via o LLM configurado.
 * Verifica cache antes de chamar a API.
 * A chave do cache inclui o nome do modelo para evitar mistura entre provedores.
 *
 * @param {string} provedor   - 'anthropic' | 'google'
 * @param {string} apiKey
 * @param {string} modelo
 * @param {Object} cache      - cache mutável (modificado in-place)
 * @param {string} nome
 * @param {string} categoria
 * @returns {Promise<Object>}
 */
async function analisarProduto(provedor, apiKey, modelo, cache, nome, categoria) {
  const chave = `${PROMPT_VERSION}::${modelo}::${normalizarChave(nome)}`;

  if (cache[chave]) {
    log(`llm: cache hit — "${nome}" [${modelo}]`);
    return cache[chave];
  }

  const userPrompt = `Produto: "${nome}"\nCategoria: "${categoria}"\n\nAvalie a viabilidade de importação e revenda no Brasil.`;

  try {
    let texto;
    if (provedor === 'google') {
      texto = await chamarGemini(apiKey, modelo, userPrompt);
    } else {
      texto = await chamarAnthropic(apiKey, modelo, userPrompt);
    }

    // Extrai o primeiro objeto JSON balanceado da resposta
    // (o LLM pode incluir texto antes/depois do JSON ou múltiplos blocos)
    const analise = extrairPrimeiroJSON(texto);
    if (!analise) throw new Error('Resposta sem JSON válido');

    // Valida campos obrigatórios
    const camposObrigatorios = ['regime_importacao', 'score_llm', 'justificativa'];
    for (const campo of camposObrigatorios) {
      if (analise[campo] === undefined) throw new Error(`Campo "${campo}" ausente`);
    }

    // Garante score dentro do range
    analise.score_llm = Math.min(100, Math.max(0, Math.round(Number(analise.score_llm) || 0)));

    cache[chave] = analise;
    salvarCache(cache);

    return analise;
  } catch (err) {
    log(`llm: erro ao analisar "${nome}" [${modelo}] — ${err.message}`);
    return { ...ANALISE_FALLBACK };
  }
}

/**
 * Analisa um lote de produtos, respeitando rate limit com delays entre chamadas.
 * Produtos já em cache não geram chamada à API.
 *
 * @param {string[]} produtos - array de objetos { nome, categoria }
 * @returns {Promise<Map<string, Object>>} mapa chave_normalizada → análise
 */
async function analisarLote(produtos) {
  const modelo   = resolverModelo();
  const provedor = resolverProvedor(modelo);

  // Resolve chave de API conforme o provedor
  const apiKey = provedor === 'google'
    ? process.env.GEMINI_API_KEY
    : process.env.ANTHROPIC_API_KEY;

  const varNome = provedor === 'google' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';

  if (!apiKey) {
    log(`llm: ${varNome} não definida — análise LLM desabilitada`);
    const mapa = new Map();
    produtos.forEach((p) => mapa.set(normalizarChave(p.nome), { ...ANALISE_FALLBACK }));
    return mapa;
  }

  // Verifica se o SDK necessário está instalado
  const sdkNome = provedor === 'google' ? '@google/genai' : '@anthropic-ai/sdk';
  try {
    require(sdkNome);
  } catch {
    log(`llm: ${sdkNome} não instalado — rode: npm install ${sdkNome}`);
    const mapa = new Map();
    produtos.forEach((p) => mapa.set(normalizarChave(p.nome), { ...ANALISE_FALLBACK }));
    return mapa;
  }

  log(`llm: usando modelo ${modelo} (${provedor})`);

  const cache = carregarCache();
  const mapa  = new Map();

  // Deduplica por nome normalizado
  const unicos = [];
  const vistos = new Set();
  for (const p of produtos) {
    const chave = normalizarChave(p.nome);
    if (!vistos.has(chave)) {
      vistos.add(chave);
      unicos.push(p);
    }
  }

  log(`llm: analisando ${unicos.length} produtos únicos (${produtos.length - unicos.length} duplicatas ignoradas)...`);

  for (let i = 0; i < unicos.length; i++) {
    const { nome, categoria } = unicos[i];
    const chave = normalizarChave(nome);

    const analise = await analisarProduto(provedor, apiKey, modelo, cache, nome, categoria);
    const chaveCache = `${modelo}::${chave}`;
    mapa.set(chave, analise);

    // Delay entre chamadas para respeitar rate limit (exceto último)
    if (i < unicos.length - 1 && !cache[chaveCache]) {
      await randomDelay(500, 1200);
    }
  }

  log(`llm: análise concluída — ${mapa.size} produtos no mapa`);
  return mapa;
}

/**
 * Retorna a análise LLM de um produto pelo nome.
 * Retorna fallback se não encontrado no mapa.
 *
 * @param {Map<string, Object>} llmMap
 * @param {string} nome
 * @returns {Object}
 */
function obterAnalise(llmMap, nome) {
  return llmMap.get(normalizarChave(nome)) || { ...ANALISE_FALLBACK };
}

module.exports = { analisarLote, obterAnalise, normalizarChave, ANALISE_FALLBACK };
