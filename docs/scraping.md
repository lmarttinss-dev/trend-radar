# Scraping

## Estratégias de extração

O scraper tenta três estratégias em ordem de prioridade. Se uma retornar dados, as seguintes são ignoradas.

### 1. Interceptação de rede (primária)

Registra um listener em `page.on('response', ...)` **antes** de chamar `page.goto()`. Quando o TikTok faz chamadas para sua própria API interna ao carregar a página, o JSON é capturado diretamente.

**Por que é a melhor estratégia:**
- Não depende de renderização de DOM
- Não interage com a página (sem cliques, sem scroll para extração)
- Os dados já chegam estruturados com views e likes exatos
- Minimiza sinais de automação

**Padrões de URL monitorados:**
```
/api/challenge/item_list/
/api/post/item_list/
/api/recommend/item_list/
/api/related/item_list/
```

### 2. Objeto SSR `__UNIVERSAL_DATA_FOR_REHYDRATION__` (secundária)

O servidor do TikTok injeta os dados de renderização inicial nessa variável global do JavaScript. O scraper lê via `page.evaluate()`.

**Caminho dos dados:**
```
window.__UNIVERSAL_DATA_FOR_REHYDRATION__
  └── webapp.challenge-detail
        └── itemList[]
              ├── desc
              ├── author.uniqueId
              ├── id
              └── stats { playCount, diggCount }
```

**Limitação:** só contém os vídeos carregados no SSR (geralmente os primeiros ~10). Não inclui os carregados por scroll posterior.

### 3. DOM scraping (fallback)

Último recurso. Lê diretamente os elementos HTML renderizados. Usa seletores `data-e2e` que são mais estáveis que classes CSS ofuscadas (`.css-abc123`).

**Seletores utilizados:**
```
[data-e2e="challenge-item-list"]   ← container da lista
[data-e2e="challenge-item"]        ← card de cada vídeo
a[href*="/video/"]                 ← link do vídeo
[data-e2e="video-views"]           ← contagem de views
[data-e2e="video-desc"]            ← descrição
```

**Limitação:** mais frágil a mudanças de layout. Views e likes costumam não estar disponíveis nos cards da listagem.

---

## Anti-detecção

### Perfil persistente do Chrome

Usa `launchPersistentContext()` com um diretório fixo (`auth/chrome-profile/`). Isso mantém entre execuções:
- Histórico de navegação
- Cache de assets
- IndexedDB e localStorage
- Cookies (mesmo sem `session.json`)

Um browser com histórico parece muito mais real do que um contexto limpo criado do zero.

### Patches de stealth

Aplicados via `addInitScript()` antes de qualquer navegação:

| Propriedade | Valor simulado |
|---|---|
| `navigator.webdriver` | `false` |
| `navigator.plugins` | Array com 3 plugins reais do Chrome |
| `navigator.languages` | `['pt-BR', 'pt', 'en-US', 'en']` |
| `navigator.hardwareConcurrency` | `8` |
| `navigator.deviceMemory` | `8` |
| `navigator.platform` | `'Win32'` |
| `navigator.permissions.query` | Retorna `granted` para permissões comuns |

### Flags de lançamento do Chromium

```
--disable-blink-features=AutomationControlled
--no-sandbox
--disable-infobars
```

### Delays aleatórios

Todo scroll e toda pausa entre hashtags usa `randomDelay()` com intervalos variáveis, nunca valores fixos.

---

## Login e sessão

O TikTok aplica muito menos verificações em usuários autenticados.

```bash
# Executa uma única vez
node login.js
```

O script abre o browser headed, você faz login normalmente e pressiona ENTER. São salvos:

- `auth/session.json` — cookies de sessão (carregado via `storageState`)
- `auth/chrome-profile/` — perfil completo do Chrome (reutilizado em toda execução)

> **Segurança:** o diretório `auth/` está no `.gitignore` e nunca deve ser versionado.

---

## Diagnóstico de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| 0 vídeos coletados | CAPTCHA ou mudança de layout | Rodar com `HEADLESS=false` e verificar o browser |
| Descrição = nome do usuário | DOM scraping ativo, sem dados de API | Sessão inválida ou IP bloqueado — refazer login |
| Views e likes `—` | Dados não chegaram via API nem SSR | Mesmo diagnóstico acima |
| Erro de timeout | Página não carregou em 30s | Verificar conexão ou aumentar timeout em `scraper.js` |

---

## Mercado Livre

O `scraperML.js` acessa `https://tendencias.mercadolivre.com.br/` e as páginas de categoria para coletar os produtos em tendência.

### Categorias disponíveis

| Chave (`ML_CATEGORIAS`) | Nome exibido | URL |
|---|---|---|
| `beleza` | Beleza e Cuidado Pessoal | `/beleza-cuidado-pessoal` |
| `esportes` | Esportes e Fitness | `/esportes-fitness` |
| `games` | Games | `/games` |
| `eletronicos` | Eletrônicos | `/eletronicos` |
| `celulares` | Celulares e Smartphones | `/celulares-smartphones` |
| `informatica` | Computação | `/computacao` |

### 1. Interceptação de rede (primária)

Registra listener em `page.on('response', ...)` antes de `page.goto()`. Captura respostas JSON da API de tendências do ML quando a página carrega.

**Padrões de URL monitorados:**
```
/trends/
/api/trends
```

**Campos extraídos da resposta:**
```json
{
  "keyword": "nome do produto",
  "url": "https://lista.mercadolivre.com.br/...",
  "trend_type": "HIGHER_GROWTH | MOST_WANTED | MOST_POPULAR"
}
```

**Por que é preferida:** dados estruturados com tipo de tendência exato e URLs de listagem.

### 2. DOM scraping (fallback)

Lê elementos `h2` e links `a[href]` da página de tendências renderizada.

**Seletores utilizados:**
```
h2                    ← nome do produto/tendência
a[href*="mercadolivre"]  ← URL da listagem
```

**Limitação:** não contém `trend_type`, apenas o nome e a posição na página.

### Campos retornados

| Campo | Tipo | Descrição |
|---|---|---|
| `nome` | string | Nome do produto ou tendência |
| `categoria` | string | Chave da categoria (ex: `beleza`) |
| `posicao` | number | Posição no ranking (1 = primeiro) |
| `tipo` | string | `MAIOR_CRESCIMENTO` \| `MAIS_DESEJADA` \| `MAIS_POPULAR` \| `TENDENCIA` |
| `url` | string | URL da listagem no ML |
| `fonte` | string | Sempre `'mercadolivre'` |

### Diagnóstico de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| 0 produtos coletados | API de tendências indisponível | Verificar com `HEADLESS=false` |
| `tipo` = `TENDENCIA` em todos | DOM scraping ativo (API não respondeu) | Normal — dados ainda são coletados |
| Poucos produtos por categoria | Timeout de 12s esgotado antes da resposta | Aumentar timeout em `scraperML.js` |
