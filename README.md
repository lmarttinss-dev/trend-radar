# Trend Radar

Scraper de vídeos virais do TikTok com análise heurística de viabilidade de revenda de produtos.

Coleta vídeos de hashtags como `#tiktokmademebuyit` e `#amazonfinds`, calcula um **score 0–100** baseado em views, engajamento e intenção de compra, e gera um **relatório `.md`** com ranking e tabelas.

---

## Requisitos

- Node.js 18+
- Chromium (instalado via Playwright)

## Instalação

```bash
npm install
npx playwright install chromium
```

## Primeiros passos

### 1. Login (uma vez só)

```bash
node login.js
```

Abre o browser, você faz login no TikTok normalmente e pressiona ENTER. A sessão é salva em `auth/` e reutilizada automaticamente nas próximas execuções — evita CAPTCHA.

### 2. Executar

```bash
node index.js
```

### Opções

```bash
HEADLESS=true node index.js    # sem janela do browser
LIMIT=10 node index.js         # máximo de 10 vídeos por hashtag
```

---

## Saída

**Console:**
```
[2026-05-02 02:40:11] API interceptada: tiktok.com/api/challenge/item_list... (20 itens)
[2026-05-02 02:40:11] Estratégia REDE: 20 vídeos capturados.

📌 #amazonfinds — 20 vídeos coletados
──────────────────────────────────────────────────────────
  [1] 🟢 Alto (score: 100) — https://www.tiktok.com/@jessicaaaawadis/video/...
       Produto   : Run to Amazon !! Link in bio
       Views     : 51.400.000  |  Engajamento: 5.8%
```

**Relatório:** `reports/relatorio-2026-05-02.md`

| Rank | Produto | Hashtag | Views | Engaj. | Score | Viabilidade |
|---:|---|---|---:|---:|---:|---|
| 1 | Run to Amazon !! Link in bio | #amazonfinds | 51.400.000 | 5.8% | 100 | 🟢 Alto |
| 2 | Don't let a flat tire ruin your day! | #amazonfinds | 31.000.000 | 8.7% | 100 | 🟢 Alto |
| 3 | Organizing pots and pans | #amazonfinds | 31.100.000 | 6.1% | 100 | 🟢 Alto |

---

## Score de viabilidade

| Componente | Peso | Critério |
|---|---:|---|
| Views | 50 pts | Escala logarítmica — 1M views ≈ 50 pts |
| Engagement rate | 30 pts | likes ÷ views — 5%+ = máximo |
| Intenção de compra | 20 pts | Keywords na descrição: `amazon`, `link`, `haul`, `buy`… |

**Classificação:** 🟢 Alto ≥ 70 · 🟡 Médio 40–69 · 🔴 Baixo < 40

---

## Estrutura do projeto

```
├── index.js          # Ponto de entrada
├── login.js          # Login manual para salvar sessão
├── src/
│   ├── scraper.js    # Coleta de dados (3 estratégias com fallback)
│   ├── analyzer.js   # Score heurístico de viabilidade
│   ├── reporter.js   # Geração do relatório .md
│   └── utils.js      # log(), randomDelay(), getRandomUserAgent()
├── auth/             # Sessão e perfil do Chrome (não versionar)
├── reports/          # Relatórios gerados
└── docs/             # Documentação detalhada
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Fluxo de dados e descrição de cada módulo |
| [docs/scraping.md](docs/scraping.md) | Estratégias de coleta, stealth e diagnóstico |
| [docs/relatorio.md](docs/relatorio.md) | Fórmula do score e formato do relatório |

## Restrições

- Sem APIs oficiais do TikTok
- Sem bibliotecas de scraping além do Playwright
- Sem IA — análise 100% heurística
