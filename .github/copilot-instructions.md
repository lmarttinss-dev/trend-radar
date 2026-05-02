# Trend Radar — Instruções do Projeto

## Stack e Restrições

- **Node.js puro (JavaScript)**. Não usar TypeScript.
- **Playwright** é a única biblioteca de scraping permitida. Não adicionar Puppeteer, Cheerio, Axios ou similares.
- **Sem APIs oficiais** do TikTok ou de qualquer plataforma sendo raspada.
- **Sem IA** na lógica de coleta ou análise — toda classificação é heurística.

## Arquitetura

```
src/scraper.js   — lógica de scraping (navegação + extração)
src/analyzer.js  — análise heurística de viabilidade (score 0–100)
src/reporter.js  — geração do relatório .md em reports/
src/utils.js     — helpers: log(), randomDelay(), getRandomUserAgent()
index.js         — ponto de entrada: coleta → análise → relatório
login.js         — login manual único para salvar sessão em auth/
```

## Padrões de Código

### Idioma
Comentários, nomes de variáveis, funções e logs em **português** (ou inglês técnico consolidado como `selector`, `timeout`, `payload`).

### Logging
Usar sempre `log()` de `src/utils.js` para saída no console. Nunca usar `console.log` diretamente fora de saídas de dados finais (JSON/relatório).

### Tratamento de erros
Todo bloco de scraping deve ter `try/catch`. Falhas silenciosas são permitidas apenas como fallback entre estratégias — nunca como comportamento final sem aviso.

### Delays
Toda navegação automatizada deve incluir `randomDelay()` entre ações. Nunca usar `setTimeout` fixo.

## Estratégias de Scraping

Todo novo scraper de página deve implementar **3 estratégias em ordem de prioridade**:

1. **Interceptação de rede** — listener em `page.on('response', ...)` iniciado antes de `page.goto()`
2. **Objeto SSR** — leitura de `window.__UNIVERSAL_DATA_FOR_REHYDRATION__` ou equivalente
3. **DOM scraping** — seletores `data-e2e` preferencialmente; nunca classes CSS ofuscadas como `.css-abc123`

Se uma estratégia retornar dados, as seguintes não devem ser executadas.

## Anti-detecção

- `HEADLESS` é `false` por padrão. Para rodar headless, o usuário deve passar `HEADLESS=true` explicitamente.
- Todo novo contexto de browser deve aplicar `applyStealthPatches()` de `src/scraper.js`.
- Usar sempre `launchPersistentContext()` com o perfil em `auth/chrome-profile/`, nunca `browser.newContext()` isolado.

## Segurança

- **Nunca hardcodar credenciais, tokens ou cookies** em código-fonte.
- Sessões ficam em `auth/` — este diretório está no `.gitignore`.
- Variáveis de configuração sensíveis devem vir de `process.env`.

## Relatório

Toda execução de coleta deve:
1. Chamar `analyzeAll()` nos resultados
2. Chamar `generateReport()` e logar o caminho do arquivo gerado
3. Salvar o `.md` em `reports/relatorio-YYYY-MM-DD.md`

Nunca finalizar `index.js` sem gerar o relatório, mesmo que a coleta retorne 0 vídeos.

## Comandos

```bash
node login.js          # login manual único (popula auth/)
node index.js          # execução padrão
HEADLESS=true node index.js
LIMIT=10 node index.js
```
