# Arquitetura

## Estrutura de arquivos

```
trend-radar/
├── index.js              # Ponto de entrada: orquestra coleta → análise → LLM → relatório
├── login.js              # Login manual único para salvar sessão
│
├── src/
│   ├── scraper.js        # Navegação e extração de dados do TikTok
│   ├── scraperML.js      # Scraping de tendências do Mercado Livre
│   ├── analyzer.js       # Score heurístico + merge com score LLM
│   ├── llm.js            # Análise de viabilidade de importação via LLM
│   ├── reporter.js       # Geração do relatório .md
│   └── utils.js          # Helpers compartilhados
│
├── auth/
│   ├── session.json      # Cookies salvos pelo login.js (não versionar)
│   └── chrome-profile/   # Perfil persistente do Chromium (não versionar)
│
├── data/
│   └── llm-cache.json    # Cache persistido de análises LLM (não versionar)
│
├── reports/
│   └── relatorio-YYYY-MM-DD.md   # Relatório gerado a cada execução
│
├── .env                  # Variáveis de ambiente com credenciais (não versionar)
├── .env.example          # Template de variáveis de ambiente
└── docs/                 # Esta documentação
```

## Fluxo de dados

```
index.js
  │
  ├─ launchPersistentContext()     ← carrega auth/chrome-profile/ + session.json
  │
  ├─ para cada HASHTAG (TikTok):
  │     scraper.scrapeHashtag()
  │       ├─ Estratégia 1: interceptação de rede  (page.on 'response')
  │       ├─ Estratégia 2: __UNIVERSAL_DATA_FOR_REHYDRATION__
  │       └─ Estratégia 3: DOM scraping (seletores data-e2e)
  │
  ├─ scraperML.scrapeCategoriasML()   ← categorias definidas em ML_CATEGORIAS
  │     └─ para cada categoria:
  │           ├─ Estratégia 1: interceptação de rede (JSON da API de tendências)
  │           └─ Estratégia 2: DOM scraping (h2 + links)
  │
  ├─ analyzer.analyzeAll(tiktokResults)
  │     └─ viewsScore + engagementScore + keywordScore + recênciaScore → score 0–100
  │
  ├─ analyzer.analisarProdutoML(produto)   ← por produto ML
  │     └─ posicaoScore(posicao, tipo) → score 0–100
  │
  ├─ llm.analisarLote([...tiktok, ...ml])   ← se LLM_ENABLED=true
  │     └─ para cada produto único:
  │           ├─ verifica cache (data/llm-cache.json, chave v2::modelo::nome)
  │           ├─ chama Anthropic ou Google conforme LLM_MODEL
  │           └─ retorna { regime_importacao, restricao_regulatoria, score_llm, ... }
  │
  ├─ analyzer.mergeScores(heuristico, llm, fonte)
  │     ├─ TikTok: score = heurístico × 0,65 + llm × 0,35
  │     └─ ML:     score = heurístico × 0,35 + llm × 0,65
  │
  └─ reporter.generateReport(analyzedResults, mlResults, llmEnabled, llmModelo)
        └─ salva reports/relatorio-YYYY-MM-DD.md
```

## Módulos

### `index.js`
Orquestra a execução completa. Lê configuração de variáveis de ambiente, inicializa o browser com perfil persistente, itera sobre hashtags TikTok e categorias ML, aplica análise heurística, chama o LLM em lote e ao final gera o relatório. Inclui loader manual de `.env` (sem dependência de `dotenv`).

### `src/scraper.js`
Responsável por toda interação com o TikTok. Implementa as 3 estratégias de extração e os patches de stealth. Ver [docs/scraping.md](scraping.md) para detalhes.

### `src/scraperML.js`
Scrapa a página de tendências do Mercado Livre (`tendencias.mercadolivre.com.br`). Implementa 2 estratégias em cascata: interceptação de rede e DOM scraping. Retorna produtos com `{ nome, categoria, posicao, tipo, url, fonte: 'mercadolivre' }`. Categorias disponíveis: `beleza`, `esportes`, `games`, `eletronicos`, `celulares`, `informatica`. Ver [docs/scraping.md](scraping.md) para detalhes.

### `src/analyzer.js`
Enriquece vídeos TikTok e produtos ML com score heurístico. Exporta também:
- `mergeScores(heuristico, llm, fonte)` — combina score heurístico com score LLM ponderado pela fonte
- `classify(score)` — converte score numérico em `{ label, emoji }` de viabilidade
- `analisarProdutoML(produto)` — calcula `posicaoScore` para produtos do ML

### `src/llm.js`
Análise de viabilidade de importação via LLM. Suporta dois modelos configuráveis via `LLM_MODEL`:

| Modelo | Provedor | Variável de API |
|---|---|---|
| `claude-haiku-4-5` | Anthropic | `ANTHROPIC_API_KEY` |
| `gemini-2.5-flash` | Google | `GEMINI_API_KEY` |

Para cada produto retorna JSON com: `regime_importacao`, `restricao_regulatoria`, `fonte_sugerida`, `ticket_estimado_usd`, `margem_estimada`, `facilidade_logistica`, `riscos`, `score_llm`, `justificativa`.

Resultados cacheados em `data/llm-cache.json` com chave versionada (`v2::modelo::nome`). Ao alterar o `SYSTEM_PROMPT`, incrementar `PROMPT_VERSION` para invalidar o cache automaticamente.

### `src/reporter.js`
Constrói o relatório `.md` a partir dos dados analisados e salva em `reports/`. Gera automaticamente:
- Índice de navegação com links âncora
- Seção de Importação Simplificada com restrições regulatórias (se LLM ativo)
- Top 5 oportunidades consolidadas
- Seção por hashtag com tabela detalhada
- Seção de Tendências do Mercado Livre (se dados disponíveis)
- Metodologia do score

Ver [docs/relatorio.md](relatorio.md) para a estrutura completa.

### `src/utils.js`
Helpers usados em todo o projeto:

| Função | Descrição |
|---|---|
| `log(msg)` | Console com timestamp `[YYYY-MM-DD HH:MM:SS]` |
| `randomDelay(min, max)` | Promise que resolve após ms aleatório entre min e max |
| `getRandomUserAgent()` | Retorna um User-Agent de desktop realista |
| `extrairKeywordML(produto)` | Gera URL de busca no Mercado Livre a partir do nome do produto |

## Configuração via variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `HEADLESS` | `false` | `true` para rodar sem janela do browser |
| `LIMIT` | `20` | Número máximo de vídeos por hashtag |
| `LLM_ENABLED` | `true` | `false` para desabilitar análise LLM |
| `LLM_MODEL` | `claude-haiku-4-5` | Modelo LLM: `claude-haiku-4-5` ou `gemini-2.5-flash` |
| `ANTHROPIC_API_KEY` | — | Chave da API Anthropic (obrigatória com Claude) |
| `GEMINI_API_KEY` | — | Chave da API Google (obrigatória com Gemini) |
| `ML_CATEGORIAS` | `beleza,esportes,games,eletronicos,celulares` | Categorias do ML a coletar (separadas por vírgula) |

Copie `.env.example` para `.env` e preencha os valores antes de executar.
