---
name: montar-relatorio
description: Montar páginas/relatórios do Studio Console (Markdown+SQL, View Blocks, fonte semântica) — dialeto, compiladores compartilhados, APIs e verificação nos 3 ambientes. Use ao criar/editar páginas .md de relatório, blocos viewblock ou páginas sobre catálogo semântico.
---

# Montar relatórios no Studio Console

Raiz do app: `studio-console/` (monorepo npm workspaces: `web/` React+Vite, `server/` Express+DuckDB, `shared/` JS puro, `tests/` vitest na RAIZ). Detalhes completos: `README.md` e os guias `GUIA_ARQUITETO.md` / `GUIA_RELATORIOS.md`. As specs normativas (`SPEC_arquitetura_informacao_viewblock.md`, `SPEC_fase3_semantica_nested.md`, `SPEC_fase4_semantica_rica.md`, `SPEC_distribuicao_histograma.md`, `SPEC_ranking_ao_longo_do_tempo.md`, `SPEC_escolha_de_grafico.md`) ficam no workspace de desenvolvimento, um nível acima — não acompanham o repositório publicado; quando não estiverem presentes, o contrato vigente é o CÓDIGO em `shared/` mais os testes.

**Modelo de pedido**: `PROMPT.md` (nesta pasta) tem o gabarito do que um pedido de
relatório precisa trazer, o que eu assumo quando falta campo, e como enunciar a
pergunta para que a escolha do gráfico saia do registro de estilos em vez de vir
pronta no pedido.

## Estrutura de um projeto

```
studio-console/projects/<proj>/
  pages/*.md        # as páginas do relatório (index.md = capa)
  queries/*.sql     # SQL externo referenciado no frontmatter
  sources/          # arquivos de dados → viram views no schema proj_<slug>
  semantic/*.yaml   # catálogos semânticos (opcional)
  project.yaml      # fontes materializadas/mounts (NUNCA segredos)
```

## Dialeto da página (compatível Evidence.dev)

````markdown
---
title: Meu Painel
queries:
  - vendas_uf: vendas_uf.sql     # de queries/
---

## Título livre em Markdown

```sql por_unidade
select unidade, count(distinct atendimento_id) as qtd
from comissoes
where cast(year(data::date) as varchar) like '${inputs.ano.value}'
group by 1 order by 2 desc
```

<Dropdown name=ano data={por_unidade_opts} value=value><DropdownOption value="%" valueLabel="Todos"/></Dropdown>
<BarChart data={por_unidade} x=unidade y=qtd title="Atendimentos por unidade"/>
<DataTable data={por_unidade}><Column id=unidade/><Column id=qtd fmt=num0/></DataTable>
<BigValue data={q} value=col fmt=brl/>
````

**Projeto de referência**: `projects/exemplo` (rede fictícia de salões, dados sintéticos)
tem tudo funcionando — páginas artesanais, catálogo `comissoes` com hierarquia/bins/map/pii
e o relatório spec-driven `reports/painel_da_rede.md`. Use-o como fonte de exemplos reais
em vez de inventar nomes.

- Inputs: `Dropdown` (`${inputs.x.value}` + LIKE), `TextInput` (LIKE plano), `Slider` (`>=`), `DateRange` (`between '${inputs.x.start}' and '${inputs.x.end}'`).
- Interpolação em texto: `{query[0].coluna}`, `{params.x}`; páginas dinâmicas: `pages/[param].md`.
- Outros componentes: LineChart, ConnectionMap, CollaborationGraph (2 queries nodes/edges), Repeat (nested), Tabs/Grid/Card/Note/LinkButton/BubbleChart.
- `AreaMap` (coroplético BR, `areaCol` + `value` + `geoId=sigla`) aceita, além do Evidence: `colorPalette={['#eee','#236aa4']}` (degradê; 3+ cores controlam os tons intermediários) e `showLabels=true`, que imprime o valor formatado pt-BR dentro da área — áreas pequenas (DF) recebem o rótulo fora, com linha-guia. Prefira métrica de rótulo CURTO (contagem) com `showLabels`: valores em moeda colidem entre UFs vizinhas.
- O linter de compatibilidade valida no editor (badge "Evidence ✓"); regra `live-scan`: **ATTACH/postgres_scan etc. são PROIBIDOS em página** (erro nos dois publishes) — banco externo entra por view materializada/mount.

## View Blocks — NUNCA escrever o marcador à mão

Bloco reeditável entre `<!-- viewblock v1 {json} -->` … `<!-- /viewblock -->`. O JSON tem forma canônica (1 linha, `>` escapado `>`, segmentos separados por linha em branco) — gerar SEMPRE pelos compiladores de `shared/`:

- Cru: `compileViewblock(vb, ctx)` de `shared/viewStyles.js` (14 estilos: tabular, graph.bar/line/bubble/**range**/**bump**/**histogram**, group, freeform, pivot, connectionmap, collabgraph, areamap, nested). Os estilos propagam `label` e `fmt` da métrica para o componente — `tabular`/`group` em `<Column>`, `freeform` em `<BigValue>`; métrica sem `fmt` sai sem o atributo.
- Cada estilo declara, além de `requires`/`compile`: `question` (a pergunta que ele responde),
  `breaks` (`{quando, use}` — o que INVALIDA o estilo mesmo com o contrato atendido), `fallback`
  e `planHint`. O menu do prompt do planejador é **GERADO** daí por `styleMenuLines()` —
  nunca edite a lista de estilos à mão em `server/routes/agent.js`. Medido: o formato do menu
  importa tanto quanto o conteúdo (`SPEC_escolha_de_grafico.md` §3b).
- Semântico: `compileCatalogSql(...)` de `shared/semanticCompile.js` + `compileViewblock` — ou, no web, `compileSemanticFromState`/`recompileSemanticVb` de `web/src/wizard/vbState.ts`.
- Os estilos que montam o PRÓPRIO SQL (`pivot`, `connectionmap`, `collabgraph`) não embrulham
  o `baseSql` e por isso não herdam o `where` dos `filters`: recebem os predicados já traduzidos
  pelo catálogo em `ctx.filterPreds` (`compileFilterPreds`). Ao escrever um estilo novo desse
  tipo, use `whereOf(vb, ctx)` — sem o `ctx`, o bloco mostra linhas que a spec declarou excluir.
- Reedição: `spliceViewblock(md, vbId, novoBloco)` de `shared/viewblock.js` — troca só o bloco, byte-preservando o resto.

Script node para compilar fora do web (rodar com cwd = `studio-console/` para resolver `yaml`):

```js
import fs from 'node:fs';
import { parse } from 'yaml';
import { compileCatalogSql } from './shared/semanticCompile.js';
const catalog = parse(fs.readFileSync('projects/exemplo/semantic/comissoes.yaml', 'utf8'));
const sql = compileCatalogSql({ catalog, hash: 'dev', metrics: ['faturamento'], dims: [{ dim: 'unidade' }], factColumns: [...] });
```

## Fonte semântica (preferir quando o modelo existe)

`semantic/<m>.yaml`: `fact`, `dimensions` (column/columns+key/bins/map, hierarchy temporal, pii), `metrics` (agg fechado sum/avg/min/max/count/count_distinct **+ dispersão: median/p25/p75/p90/stddev**; `filters` embutidos; `derived` com aritmética + `total(m[, scope: all])` + `lag/acum/movel` **+ `posicao(m, nível)` e `variacao_posicao(m, nível)`**; `semi_additive`), `joins` (declarados, com `cardinality`), `hierarchies` (drill ⤵/⤴ entre dims), `policies` (expose: internal), `description`/`synonyms` (grounding do agente). O SQL sai do compilador com header `-- semantic: <m>@<hash>` — **SQL nunca é escrito à mão nem vem de IA para bloco semântico**. Publish público recusa dims internas/pii (erro, use visibility internal).

## Três formas que o produto aprendeu nesta frente

- **`graph.range`** — marca de intervalo (faixa + centro). 1 dimensão e EXATAMENTE 3 métricas na
  ordem mínimo · centro · máximo (p25/mediana/p75 do catálogo). É a saída do `graph.bar` quando há
  várias observações por grupo: três barras mostram três números e escondem a faixa.
- **`graph.histogram`** — a FORMA da distribuição. 1 métrica, NENHUMA dimensão, `distribution: {bins: N}`
  no bloco (5..100). A métrica só APONTA A COLUNA: a agregação dela não é aplicada, o histograma conta
  linhas do fato pelo valor bruto. SQL vem de `compileDistributionSql` (`shared/semanticCompile.js`),
  o **segundo caminho de compilação** ao lado de `compileCatalogSql` — bifurcação em
  `compileSemanticBlock`, em lugar nenhum mais. Bordas calculadas dentro da query; cauda aparada no
  p99 com a última faixa ABERTA (`339+`), preservando o N.
- **`graph.bump`** — posição no ranking ao longo do tempo. 2 dimensões (uma temporal = eixo, outra
  rankeada) e 1 métrica `posicao(...)` do catálogo; `bump: {top: N}` recorta "esteve no top N em ALGUM
  período", preservando a trajetória inteira. `variacao_posicao` exige DOIS estágios de janela (janela
  aninhada é ilegal em SQL) — o compilador materializa a posição na CTE `posicoes`.

Config de bloco por estilo: `pivot`, `nested`, `distribution`, `bump` — atravessam
`compileSemanticBlock` → marcador → absorção F6, todos pelo mesmo padrão.

## Cinco opções de bloco que valem em qualquer relatório

Todas opcionais; omitir mantém a saída byte-idêntica. Validadas em `shared/reportPlan.js`
contra a seleção do bloco — apontar para o que não está lá é erro, não silêncio.

- **`order: [{by, dir}]`** — o padrão é `order by <1ª métrica> desc` (top-N). `by` é uma
  métrica OU dimensão **do próprio bloco** (o SQL sai pelo alias dela); `dir` é `asc|desc`.
  É o que faz um ranking sair crescente e um eixo categórico sair na ordem natural em vez
  da ordem da contagem. Recusado em `pivot`, `graph.histogram` e `graph.line`, que definem
  a própria ordem (`ORDER_IGNORED_STYLES`).
- **`table: {search?: true, rows?: N}`** — só em `tabular` e `group` (`TABLE_STYLES`).
  `search` liga a busca client-side; `rows` é o TAMANHO DA PÁGINA (o DataTable pagina nos
  3 ambientes, padrão 50). Conjunto fechado de chaves.
- **`reference: [{value|from, axis?, label?}]`** — linha de corte em `graph.bar`, `graph.line`,
  `graph.bubble` e `graph.range` (`REFERENCE_STYLES`). `value` é um literal (limiares que são
  constantes de verdade: 0, 1,0, 80%); `from` nomeia uma **métrica do bloco** e o valor é lido
  na 1ª linha do resultado — é assim que uma mediana vira linha sem ninguém digitá-la.
  **Um PAR vira FAIXA** (`markArea`), não linha: `value: [início, fim]` ou
  `from: [métrica, métrica]`. Sem chave nova, porque `from` já significa "ler de uma métrica" —
  reusá-la como início do intervalo seria ambíguo. Os dois valores têm de ser DIFERENTES e
  delimitar um trecho do eixo que o bloco realmente tem (`[2025, 2025]` é recusado; num eixo
  mensal, 2025 não é posição). Ordem invertida é normalizada.
  `axis: y` (padrão) é o eixo de VALOR, `axis: x` é o de CATEGORIA (posiciona pelo índice da
  categoria, não pela n-ésima barra). `from` só vale em `graph.bar`/`graph.line`, onde o corpo
  filtra a métrica de referência para fora das séries; em bubble e range a POSIÇÃO da métrica
  na lista é o papel dela, então ali a referência é literal.
  **Não invente o valor**: um literal só vale se for constante conhecida e verificável. Meta,
  orçamento ou limiar que não está no dado nem foi dito no pedido vai para `warnings`, não
  para o eixo — e toda referência precisa de `label`, senão é tracejado sem dono.
- **`stack: total|percent`** — só em `group`, e só no cruzamento que vira gráfico. `percent`
  normaliza cada coluna a 100%: é a forma da COMPOSIÇÃO, para quando os totais das categorias
  são incomparáveis (533 mil artigos nas federais contra 6 mil nas municipais) e a comparação
  que o título faz é proporcional. O padrão `total` empilha o valor absoluto e preserva a
  magnitude — prefira-o, e passe a `percent` só quando o título afirmar uma proporção. Em
  `percent` o eixo e o tooltip saem em %, não no `fmt` da métrica.
- **`orientation: vertical|horizontal`** — só em `graph.bar` e `graph.histogram`
  (`ORIENTATION_STYLES`); é o único lugar do produto que emite `swapXY`. Deite quando o
  rótulo da categoria for texto longo (instituição, periódico, editora, área) ou passar de
  ~12 categorias: em pé o rótulo inclina 30° e o eixo corta. No histograma o gatilho é
  ~15 faixas, porque o eixo contíguo **não inclina rótulo** — inclinar sugeriria categorias
  independentes — e o ECharts começa a pular rótulo sim, rótulo não. Deitado, o título do
  eixo troca de lado e a altura do gráfico cresce com o nº de categorias.

As cinco vivem em `BLOCK_OPTIONS` (`shared/viewStyles.js`) e entram no cardápio do agente
a partir dali. **Opção nova se declara lá**, não no prompt: é a mesma regra de fonte única
que vale para `question`, `breaks` e `planHint`.

## `group`: cruzamento de 2 dimensões é BARRA EMPILHADA, não tabela

Com **exatamente 2 dimensões e 1 métrica**, `group` compila para
`<BarChart … series=<2ª dimensão> type=stacked>`: dimensão 1 no eixo, dimensão 2 nas séries,
métrica na altura — mesma convenção de ORDEM do `graph.bubble` e do `graph.range`. Com 3+
dimensões ou 2+ métricas nenhuma barra carrega a seleção e o estilo volta a ser a tabela
ordenada. Duas consequências ao montar:

- não acrescente uma métrica "só para conferir" a um `group` de 2 dimensões: isso o derruba
  de gráfico para tabela sem avisar. Ponha a conferência num bloco `tabular` ao lado.
- a 2ª dimensão são as séries, então mantenha-a curta (~8 categorias). Acima disso a pilha
  vira faixa ilegível e a tabela informa mais.

## Nível obrigatório onde o valor é COMPARADO

Dimensão com `hierarchy` exige `level` em **filtro** e em **argumento** (`globalParams[].from`),
e em `parameter.level` de página parametrizada. Sem o nível, `{dim: tempo, values: ["2024"]}`
compila para `"data" = '2024'` — coluna DATE contra string, que o banco recusa; como argumento vira
um LIKE que nunca casa, errado em silêncio. Exceção: quando a COLUNA da dimensão já é um dos níveis
(`year` com `hierarchy: [year]`), o SQL sai idêntico e o nível é dispensado.

`parameter.level` acompanha o filtro injetado na rota E o índice de valores clicáveis — os dois têm
de casar, senão o índice oferece links que a página não encontra.

## APIs (server na porta 3001, `node --watch` — reinicia sozinho ao editar)

- `GET/PUT /api/projects/:p/file {path, content}` — ler/gravar página (path relativo a pages/)
- `POST /api/query {sql, project}` — rodar SQL no schema do projeto
- `GET /api/projects/:p/sources | /semantic | /models` — fontes/catálogos/models
- `POST /api/projects/:p/publish` (📦 snapshot HTML) e `/publish-app` (☁ Parquet+WASM), body aceita `{visibility: 'public'|'internal'}`

## Relatório completo planejado (F5 — o caminho PREFERIDO para multipágina)

Para gerar um relatório inteiro (várias páginas), NÃO grave página a página: use a
esteira ReportPlan — validação + lint + políticas + sample-run de TODAS as queries +
gravação em DUAS FASES (.tmp → rename; rollback de melhor esforço na promoção):

- `POST /api/projects/:p/agent/report-plan {request, catalog?, audience?, visibility?}` —
  a IA propõe um `ReportPlan` (só nomes do catálogo; contrato em `shared/reportPlan.js`);
  devolve `{plan, errors}` — erros voltam para revisão, nunca são consertados em silêncio.
- `POST /api/projects/:p/agent/report-apply {plan, overwrite?: [paths]}` — revalida,
  compila tudo em memória (`shared/reportCompiler.js` → `compileReport`), roda lint +
  políticas + amostra, devolve `{conflicts}` se páginas existem (nada gravado), grava
  em duas fases com rollback. Um plano pode ser montado À MÃO (sem LLM) e aplicado por
  aqui — é o jeito programático de gerar relatórios corretos (pipeline em
  `server/reportApply.js`, testável direto).
- UI: menu do projeto → Relatórios → "＋ Novo relatório" (Objetivo → Plano → Gerar);
  ajustes finos = reedição ▣/Σ/⚙ dos blocos gerados.
- `compileSemanticBlock` (shared/reportCompiler.js) é a ÚNICA regra de geração de bloco
  semântico — o wizard web delega para ela; nunca duplique.

### Spec-driven (F6) — a fonte da verdade é a spec do relatório

Relatório de verdade vive em `projects/<p>/reports/<slug>.md`: narrativa Markdown + UM
fence ```` ```studio-report ```` com o contrato (ReportPlan + `name` + `prose:` por
página); specs legadas com fence ```` ```yaml ```` seguem aceitas.
Regras ao trabalhar com relatórios:
- Para MUDAR um relatório spec-driven, edite a SPEC (o fence do contrato) e rode o build —
  nunca edite as páginas construídas à mão (isso gera `divergente`, que exige resolução).
- APIs: `GET/PUT /api/projects/:p/reports/:slug` (salvar valida e devolve errors),
  `POST /:slug/build` ({diverged} bloqueia sem force — spec editada passa livre),
  `POST /:slug/absorb` (página vence: blocks voltam; prose só com {prose:true} — sem isso devolve proseDiff p/ confirmação),
  `POST /reports/promote {name, pages}` (páginas com blocos semânticos → spec).
- Reedição via wizard/drill numa página possuída SINCRONIZA a spec sozinha (o PUT de
  página devolve `specSynced`); o PUT é TRANSACIONAL — sync falhou = página desfeita + erro explícito.
- Estado por relatório: ok · pendente (spec à frente — build livre) · divergente
  (página editada — Recompilar × Reabsorver) · desatualizado (catálogo mudou) · quebrado.

## Verificação (obrigatória)

1. Editor: abrir a página (localStorage `studio.file.<proj>` + `/projects/<proj>`), modo Dividido, dados renderizando, lint ✓.
2. Publicar 📦 e ☁ e conferir no navegador (as 3 execuções devem concordar).
3. `npx vitest run` **da raiz** `studio-console/` (nunca de `web/`) + `npx tsc --noEmit` em `web/` se tocou TypeScript.
4. **Componente novo ⇒ registrar em `shared/evidenceLint.js`** (`CONSOLE_COMPONENTS` e, se não
   existir no Evidence core, `CUSTOM_NEEDS_PORT`). Sem isso o badge do editor acusa
   `unknown-component` como ERRO em toda página que o usa — foi o que aconteceu com
   `RangeChart`, despercebido por horas. `tests/lintCobertura.test.js` liga o registro de
   estilos ao linter e quebra quando um estilo emite componente não registrado.

## Armadilhas do ambiente

- `node`/`npm` fora do PATH em shell novo: prefixar `$PROGRAMFILES/nodejs` (bash) ou `$env:ProgramFiles\nodejs` (PowerShell).
- Porta 3001 ocupada = a API do preview JÁ roda com --watch — use-a, não suba outra (esperar ~1-2s após editar server/).
- Vite órfão na 5173: `taskkill` no PID e `preview_start` de novo.
- Segredos JAMAIS em yaml/página/erro de API — `.secrets.json` (write-only) e `redactSecrets`.
