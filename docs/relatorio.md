# Relatório de Viabilidade

## Arquivo gerado

Cada execução de `node index.js` salva um arquivo em:

```
reports/relatorio-YYYY-MM-DD.md
```

Se executado mais de uma vez no mesmo dia, o arquivo é sobrescrito. Execuções em dias diferentes criam arquivos separados.

---

## Estrutura do relatório

```
# Trend Radar — Relatório de Viabilidade de Revenda
  Data, modelo LLM, hashtags e totais

## Índice
  Links âncora para cada seção do relatório

## 🚀 Produtos Viáveis para Importação Simplificada   ← apenas se LLM ativo
  Produtos filtrados: regime viável + score LLM ≥ 70
  Inclui coluna de restrições regulatórias (ANATEL, ANVISA, INMETRO, MAPA, DGR)

## 🏆 Top 5 Oportunidades de Revenda
  Ranking consolidado entre todas as fontes, ordenado por score

## #hashtagA
  ### Sumário      ← métricas agregadas da hashtag
  ### Vídeos       ← tabela ordenada por score decrescente

## #hashtagB
  ...

## 📊 Tendências do Mercado Livre   ← apenas se ML_CATEGORIAS coletado
  Produtos agrupados por categoria com score e análise LLM

## Metodologia do Score
  Fórmulas dos componentes, pesos do merge LLM e critérios de importação
```

---

## Score heurístico (0–100)

### Vídeos TikTok

Quatro componentes somados:

| Componente | Peso | Critério |
|---|---:|---|
| Views | 40 pts | Escala logarítmica — 1M views ≈ 40 pts |
| Engagement rate | 25 pts | likes ÷ views — 5%+ = máximo |
| Intenção de compra | 15 pts | Keywords na descrição (amazon, link, haul…) |
| Recência | 20 pts | < 30d = 20 · 30–90d = 15 · 90–180d = 10 · 180–365d = 5 · > 365d = 0 |

#### Views (40 pts)

Escala logarítmica baseada em `log10(views)`:

$$\text{viewsScore} = \min\!\left(40,\ \frac{\log_{10}(\text{views})}{6} \times 40\right)$$

| Views | Score aproximado |
|---:|---:|
| 10.000.000 (10M) | 40 |
| 1.000.000 (1M) | 33 |
| 100.000 (100K) | 27 |
| 10.000 (10K) | 20 |
| 0 | 0 |

#### Engagement rate (25 pts)

$$\text{engScore} = \min\!\left(25,\ \frac{\text{likes}}{\text{views} \times 0{,}05} \times 25\right)$$

| Engagement rate | Score |
|---:|---:|
| ≥ 5% | 25 |
| 2,5% | 12 |
| 1% | 5 |
| 0% | 0 |

#### Intenção de compra (15 pts)

Conta keywords de compra encontradas na descrição:

| Keywords encontradas | Score |
|---:|---:|
| 2 ou mais | 15 |
| 1 | 7 |
| 0 | 0 |

**Keywords monitoradas:**
`link`, `amazon`, `shop`, `buy`, `compra`, `onde achar`, `link na bio`, `achei no`, `disponível`, `loja`, `store`, `desconto`, `promoção`, `cupom`, `coupon`, `afiliado`, `affiliate`, `code`, `código`, `produto`, `product`, `review`, `unboxing`, `haul`, `find`

#### Recência (20 pts)

| Publicado há | Score |
|---|---:|
| < 30 dias | 20 |
| 30–90 dias | 15 |
| 90–180 dias | 10 |
| 180–365 dias | 5 |
| > 365 dias | 0 |

### Produtos Mercado Livre

$$\text{posicaoScore} = \max\!\left(0,\ 100 - (\text{posicao} - 1) \times 10\right)$$

Ajuste por tipo de tendência:

| Tipo | Multiplicador |
|---|---:|
| `MAIOR_CRESCIMENTO` | 1,0 |
| `MAIS_DESEJADA` | 0,9 |
| `MAIS_POPULAR` | 0,8 |

---

## Score combinado com LLM

Quando `LLM_ENABLED=true`, o score final é um merge ponderado:

| Fonte | Peso Heurístico | Peso LLM |
|---|---:|---:|
| TikTok | 65% | 35% |
| Mercado Livre | 35% | 65% |

O LLM tem peso maior para produtos do ML porque a fonte heurística (posição no ranking) é menos discriminante do que o engajamento do TikTok.

---

## Critérios LLM — Importação

### Critério primário: característica do produto

O regime de importação é definido **primeiro** pela natureza do produto, não pelo preço:

**Sempre `nao_viavel`** (independente do preço):

| Produto | Restrição |
|---|---|
| Alimentos, bebidas, suplementos, vitaminas | ANVISA + MAPA |
| Medicamentos, cosméticos farmacêuticos | ANVISA |
| Equipamentos médicos/odontológicos | ANVISA classe II+ |
| Eletrônicos com Wi-Fi, 4G/5G, Bluetooth de potência | ANATEL |
| Produtos com bateria de lítio integrada não removível | DGR (transporte aéreo) |
| Perfumes, aerossóis, líquidos inflamáveis | DGR |
| Brinquedos sem certificação INMETRO disponível | INMETRO |
| Armas, munições, réplicas | — |

**`remessa_ate_50usd`** — Remessa Conforme, isento de imposto:
- Produto único ≤ USD 50 **e** sem nenhuma restrição acima

**`pf_ate_500usd`** — Importação Pessoa Física, tributação 20%:
- Produto entre USD 51–500 **e** sem nenhuma restrição acima

### Penalidade de score

Produtos com `restricao_regulatoria` não vazia recebem **no máximo 20 pts** de `score_llm`, independente de outras características.

---

## Classificação

| Score | Classificação | Interpretação |
|---:|---|---|
| 70 – 100 | 🟢 Alto | Alto potencial — viral, engajado, sem restrições |
| 40 – 69 | 🟡 Médio | Potencial moderado — verificar manualmente |
| 0 – 39 | 🔴 Baixo | Baixa tração, dados insuficientes ou restrição regulatória |

---

## Campos de cada vídeo TikTok

| Campo | Tipo | Descrição |
|---|---|---|
| `descricao` | string | Legenda completa do vídeo |
| `url` | string | URL direta para o vídeo no TikTok |
| `views` | string | Views no formato original (`"2.1M"`) |
| `likes` | string | Likes no formato original (`"180K"`) |
| `produto` | string | Primeiros 60 chars da descrição |
| `viewsNum` | number | Views normalizado para inteiro (`2100000`) |
| `likesNum` | number | Likes normalizado para inteiro (`180000`) |
| `engRate` | string | Taxa de engajamento formatada (`"8.6%"`) |
| `score` | number | Score final combinado 0–100 |
| `viabilidade` | string | Classificação com emoji (`"🟢 Alto"`) |
| `analise` | object | Análise do LLM (ver campos abaixo) |

## Campos da análise LLM (`analise`)

| Campo | Tipo | Descrição |
|---|---|---|
| `regime_importacao` | string | `remessa_ate_50usd` \| `pf_ate_500usd` \| `nao_viavel` |
| `restricao_regulatoria` | string[] | Órgãos/regras aplicáveis (ANATEL, ANVISA…) ou `[]` |
| `fonte_sugerida` | string[] | Plataformas de sourcing recomendadas |
| `ticket_estimado_usd` | string | Range de custo CIF estimado (ex: `"$5–$20"`) |
| `margem_estimada` | string | `alta` \| `media` \| `baixa` |
| `facilidade_logistica` | string | `alta` \| `media` \| `baixa` |
| `riscos` | string[] | Até 3 riscos principais |
| `score_llm` | number | Score LLM 0–100 |
| `justificativa` | string | 1 frase explicando o regime e o score |

---

## Limitações conhecidas

- **Vídeos sem views/likes** recebem score 0, pois o componente de engajamento não pode ser calculado. Ocorre quando o scraper usa o fallback de DOM.
- O **nome do produto** (`produto`) é extraído da descrição de forma simples — pode conter hashtags em descrições curtas.
- O **cache LLM** (`data/llm-cache.json`) persiste entre execuções. Para forçar nova análise de um produto, delete o arquivo ou incremente `PROMPT_VERSION` em `src/llm.js`.
- Produtos do **Mercado Livre** dependem da disponibilidade da API de tendências do site — quando indisponível, cai para DOM scraping com menos dados.
