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
  Data, hashtags e total de vídeos

## 🏆 Top 5 Oportunidades de Revenda
  Ranking consolidado entre todas as hashtags, ordenado por score

## #hashtagA
  ### Sumário      ← métricas agregadas da hashtag
  ### Vídeos       ← tabela ordenada por score decrescente

## #hashtagB
  ...

## Metodologia do Score
  Explicação dos componentes do score
```

---

## Score de viabilidade (0–100)

O score é calculado de forma **heurística**, sem IA, com três componentes:

### Componente 1 — Views (peso: 50 pts)

Escala logarítmica baseada em `log10(views)`:

$$\text{viewsScore} = \min\!\left(50,\ \frac{\log_{10}(\text{views})}{6} \times 50\right)$$

| Views | Score aproximado |
|---:|---:|
| 1.000.000.000 (1B) | 50 |
| 1.000.000 (1M) | 50 |
| 100.000 (100K) | 33 |
| 10.000 (10K) | 17 |
| 1.000 (1K) | 8 |
| 0 | 0 |

A escala logarítmica evita que um único vídeo com bilhões de views domine o ranking — a diferença entre 1M e 10M vale menos do que entre 1K e 10K.

### Componente 2 — Engagement rate (peso: 30 pts)

$$\text{engScore} = \min\!\left(30,\ \frac{\text{likes}}{\text{views} \times 0{,}05} \times 30\right)$$

| Engagement rate | Score |
|---:|---:|
| ≥ 5% | 30 |
| 2,5% | 15 |
| 1% | 6 |
| 0% | 0 |

Alta taxa de engajamento indica que o produto gerou reação genuína no público, não apenas impressões passivas.

### Componente 3 — Intenção de compra (peso: 20 pts)

Conta keywords de compra encontradas na descrição do vídeo:

| Keywords encontradas | Score |
|---:|---:|
| 2 ou mais | 20 |
| 1 | 10 |
| 0 | 0 |

**Lista de keywords monitoradas:**
`link`, `amazon`, `shop`, `buy`, `compra`, `onde achar`, `link na bio`, `achei no`, `disponível`, `loja`, `store`, `desconto`, `promoção`, `cupom`, `coupon`, `afiliado`, `affiliate`, `code`, `código`, `produto`, `product`, `review`, `unboxing`, `haul`, `find`

---

## Classificação

| Score | Classificação | Interpretação |
|---:|---|---|
| 70 – 100 | 🟢 Alto | Produto com alto potencial — viral, engajado e com intenção de compra clara |
| 40 – 69 | 🟡 Médio | Potencial moderado — analise a descrição e o produto manualmente |
| 0 – 39 | 🔴 Baixo | Baixa tração ou dados insuficientes — não priorizar |

---

## Campos de cada vídeo

| Campo | Tipo | Descrição |
|---|---|---|
| `descricao` | string | Legenda completa do vídeo |
| `url` | string | URL direta para o vídeo no TikTok |
| `views` | string | Views no formato original (`"2.1M"`) |
| `likes` | string | Likes no formato original (`"180K"`) |
| `produto` | string | Primeiros 60 chars da descrição até o primeiro separador |
| `viewsNum` | number | Views normalizado para inteiro (`2100000`) |
| `likesNum` | number | Likes normalizado para inteiro (`180000`) |
| `engRate` | string | Taxa de engajamento formatada (`"8.6%"`) |
| `score` | number | Score de viabilidade 0–100 |
| `viabilidade` | string | Classificação com emoji (`"🟢 Alto"`) |

---

## Limitações conhecidas

- **Vídeos sem views/likes** recebem score 0 automaticamente, pois o componente de engajamento não pode ser calculado. Isso ocorre quando o scraper cai no fallback de DOM, que raramente contém essas métricas.
- O **nome do produto** (`produto`) é extraído da descrição de forma simples — pode conter hashtags ou texto irrelevante em descrições muito curtas.
- O score **não considera** fatores como margem de lucro, disponibilidade do produto ou sazonalidade.
