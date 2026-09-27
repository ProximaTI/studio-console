# Design system — Studio Console

Pacote **gerado** por `npm run design:export` em 2026-09-23. Não edite estes
arquivos: mude a fonte e exporte de novo.

| Arquivo | Para quê |
| --- | --- |
| `tokens.css` | CSS custom properties prontas — qualquer página/app web |
| `tokens.json` | os mesmos valores em dados — build, Figma, outra stack |
| `preview.html` | folha de amostras: abra no navegador, troque preset e modo |

## Duas famílias de token

- **Marca** — muda por cliente/projeto, e é o conjunto **fechado** que um
  `theme:` pode declarar: mode, background, backgroundDark, card, cardDark, primary, primaryDark, chartPalette, chartPaletteDark, sequentialPalette, sequentialPaletteDark, kpiPalette, kpiPaletteDark.
- **Estrutural** (--radius-card, --radius-ctrl, --radius-pill, --shadow-frame, --rowpad, --ui, --mono): raios, sombra, espaçamento e
  fontes. **Não** são sobrescrevíveis — é o que faz todo relatório parecer o
  mesmo produto mesmo com marcas diferentes.

Presets disponíveis: `govbr`, `painel-apc`.

### Três famílias de cor, três trabalhos

Uma lista de cores não serve às outras duas, e trocá-las entre si é erro de
leitura, não de gosto:

| Família | Para quê | O que a ordem diz |
| --- | --- | --- |
| `chartPalette`, `chartPaletteDark` | séries e fatias: marcas que precisam ser distinguidas **entre si** | nada — é ordem de entrada |
| `sequentialPalette`, `sequentialPaletteDark` | degradê do coroplético: magnitude de **uma** métrica | tudo — do valor baixo ao alto |
| `kpiPalette`, `kpiPaletteDark` | tingimento da **superfície** do cartão de indicador | amarra cada tom a uma métrica; a cor não codifica valor |

O degradê **não** cai de um modo para o outro, ao contrário da categórica: a
ponta baixa é quase branca e desapareceria sobre o mapa escuro. Sem degradê
declarado para o modo, ele deriva da cor de marca — o que o coroplético sempre
fez. O tingimento sem par escuro deixa o cartão **liso** no escuro: perder o
tom é melhor que inventar um.

Cada tom de `kpiPalette` vira `--kpi-1`, `--kpi-2`… na ordem declarada.
Tema que não tinge não gera essas variáveis. E o tingimento é superfície de
**texto**: o validador recusa um tom que não sustente 4,5:1 com `--text`.

## Reusar em OUTRO relatório desta console

Uma linha no `project.yaml` do projeto — nada de copiar hex:

```yaml
theme:
  preset: govbr
```

O preset é a BASE; qualquer token de marca declarado ao lado dele ajusta o que
se quiser:

```yaml
theme:
  preset: govbr
  chartPalette: ["#AD5000","#217B00","#0069D0"]   # só as séries mudam
```

Regras que o validador aplica ao salvar: token fora do conjunto de marca é
**erro**, e primário ilegível sobre o cartão é **recusado** (mínimo 3:1).
O modo claro/escuro **não** vem do preset — segue o global em Settings.

### Logotipos

Os SVGs são marca, não código: **não versionam, e não estão neste repositório**
— nem eles nem o script que os baixa, que depende da rede interna de quem os
licencia. Nada aqui precisa deles: os tokens e o `tokens.css` funcionam
sozinhos.

Para usar logotipos próprios, ponha os SVGs em `web/public/brand/` da sua
instalação e referencie-os pela raiz. Na página, use `<img>` e **não**
`![](…)`: é o que permite definir largura, e um SVG que só declara `viewBox`
(o caso de muitos logotipos institucionais) esticaria a coluna inteira sem ela.

```html
<img src="/brand/minha-marca.svg" alt="Minha Marca" width=190/>
```

No publish a imagem é embutida como data URI, então o 📦 continua sendo um
arquivo só e o ☁ não depende de caminho.

## Reusar FORA da console

```html
<link rel="stylesheet" href="tokens.css">
<html data-preset="govbr" data-mode="light">
```

Depois é só consumir as variáveis: `background: var(--bg)`,
`color: var(--text)`, `border-color: var(--line)`, `color: var(--primary)`.
As três famílias de cor saem **resolvidas por modo** em `tokens.json`, em
`presets.<nome>.series`, `.sequential` e `.kpi`, cada uma com `light` e
`dark` — há paleta por modo porque a de séries do gov.br cai para ~1,1:1 sobre
superfície escura.

## Procedência dos valores

O preset `govbr` usa tokens reais do `@govbr-ds/core` 3.7.0 (MIT); o nome do
token de origem está no comentário de cada linha em `shared/designTokens.js`.
A paleta de séries clara vem da `@psc/ui` (biblioteca Vue/GovBR da CAPES),
porque o core do GovBR-DS não define paleta de séries; a escura são os passos
claros das mesmas famílias de cor do core.

O preset `painel-apc` é o `govbr` inteiro mais o degradê do mapa e o
tingimento dos cartões, medidos do **relatório publicado** Painel APC (estilos
computados dos visuais e amostragem de pixel do fundo, em 23/09/2026). As duas
leituras já concordavam nas duas cores institucionais: o azul escuro da tarja
do rodapé e o azul dos ícones do cabeçalho são, hex a hex, o
`--background-dark` e o `--interactive-light` do core.

Esses valores **não** são tokens do core, e é por isso que moram num preset
próprio em vez de entrar no `govbr`: o degradê é aproximado (o mapa é WebGL,
não se lê do DOM) e o passo do meio dele é o acento padrão do Power BI, não uma
cor de governo. Quem quer o gov.br puro usa `govbr`; quem quer parecer o
Painel APC usa `painel-apc`.

O que **não** veio junto: a tipografia (Segoe UI e DIN), o raio de 7px e as
sombras dos painéis são **estruturais**, e o estrutural desta console não muda
por marca — herdá-los faria todo relatório parecer um relatório do Power BI. Os
pictogramas dos cartões e as marcas institucionais estão rasterizados no fundo
do relatório de origem e não foram exportados: use os kits oficiais.
