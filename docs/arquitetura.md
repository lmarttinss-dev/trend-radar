# Arquitetura

## Estrutura de arquivos

```
trend-radar/
├── index.js              # Ponto de entrada: orquestra coleta → análise → relatório
├── login.js              # Login manual único para salvar sessão
│
├── src/
│   ├── scraper.js        # Navegação e extração de dados do TikTok
│   ├── analyzer.js       # Score heurístico de viabilidade (0–100)
│   ├── reporter.js       # Geração do relatório .md
│   └── utils.js          # Helpers compartilhados
│
├── auth/
│   ├── session.json      # Cookies salvos pelo login.js (não versionar)
│   └── chrome-profile/   # Perfil persistente do Chromium (não versionar)
│
├── reports/
│   └── relatorio-YYYY-MM-DD.md   # Relatório gerado a cada execução
│
└── docs/                 # Esta documentação
```

## Fluxo de dados

```
index.js
  │
  ├─ launchPersistentContext()     ← carrega auth/chrome-profile/ + session.json
  │
  ├─ para cada HASHTAG:
  │     scraper.scrapeHashtag()
  │       ├─ Estratégia 1: interceptação de rede  (page.on 'response')
  │       ├─ Estratégia 2: __UNIVERSAL_DATA_FOR_REHYDRATION__
  │       └─ Estratégia 3: DOM scraping (seletores data-e2e)
  │
  ├─ analyzer.analyzeAll(allResults)
  │     └─ para cada vídeo: viewsScore + engagementScore + keywordScore → score 0–100
  │
  └─ reporter.generateReport(analyzedResults)
        └─ salva reports/relatorio-YYYY-MM-DD.md
```

## Módulos

### `index.js`
Orquestra a execução completa. Lê configuração de variáveis de ambiente (`HEADLESS`, `LIMIT`), inicializa o browser com perfil persistente, itera sobre as hashtags e ao final chama o analyzer e o reporter.

### `src/scraper.js`
Responsável por toda interação com o browser. Implementa as 3 estratégias de extração e os patches de stealth. Ver [docs/scraping.md](scraping.md) para detalhes.

### `src/analyzer.js`
Recebe o array bruto de vídeos e enriquece cada objeto com `score`, `viabilidade`, `engRate` e `produto`. Não faz I/O — é uma função pura sobre os dados. Ver [docs/relatorio.md](relatorio.md) para a fórmula do score.

### `src/reporter.js`
Constrói o relatório `.md` a partir dos dados analisados e salva em `reports/`. Cria o diretório automaticamente se não existir.

### `src/utils.js`
Três helpers usados em todo o projeto:

| Função | Descrição |
|---|---|
| `log(msg)` | Console com timestamp `[YYYY-MM-DD HH:MM:SS]` |
| `randomDelay(min, max)` | Promise que resolve após ms aleatório entre min e max |
| `getRandomUserAgent()` | Retorna um User-Agent de desktop realista |

## Configuração via variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `HEADLESS` | `false` | `true` para rodar sem janela do browser |
| `LIMIT` | `20` | Número máximo de vídeos por hashtag |
