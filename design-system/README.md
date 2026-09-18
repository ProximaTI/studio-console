# Design system — Studio Console

Pacote **gerado** por `npm run design:export` em 2026-09-17. Não edite estes
arquivos: mude a fonte e exporte de novo.

| Arquivo | Para quê |
| --- | --- |
| `tokens.css` | CSS custom properties prontas — qualquer página/app web |
| `tokens.json` | os mesmos valores em dados — build, Figma, outra stack |
| `preview.html` | folha de amostras: abra no navegador, troque preset e modo |

## Duas famílias de token

- **Marca** (mode, background, backgroundDark, card, cardDark, primary, primaryDark, chartPalette, chartPaletteDark): muda por cliente/projeto.
- **Estrutural** (--radius-card, --radius-ctrl, --radius-pill, --shadow-frame, --rowpad, --ui, --mono): raios, sombra, espaçamento e
  fontes. **Não** são sobrescrevíveis — é o que faz todo relatório parecer o
  mesmo produto mesmo com marcas diferentes.

Presets disponíveis: `govbr`.

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

Os SVGs são marca, não código: não versionam. Com acesso à rede interna:

```bash
node scripts/fetch_brand_assets.mjs
```

Na página, `<img>` (e não `![](…)`) é o que permite tamanho — vários logos,
o da CAPES entre eles, só têm `viewBox` e sem largura esticariam a coluna
inteira:

```html
<img src="/brand/capes.svg" alt="CAPES" width=190/>
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
As cores de série de gráfico estão em `tokens.json`
(`presets.govbr.series.light` e `.dark`) — há paleta por modo porque a clara
do gov.br cai para ~1,1:1 sobre superfície escura.

## Procedência dos valores

O preset `govbr` usa tokens reais do `@govbr-ds/core` 3.7.0 (MIT); o nome do
token de origem está no comentário de cada linha em `shared/designTokens.js`.
A paleta de séries clara vem da `@psc/ui` (biblioteca Vue/GovBR da CAPES),
porque o core do GovBR-DS não define paleta de séries; a escura são os passos
claros das mesmas famílias de cor do core.
