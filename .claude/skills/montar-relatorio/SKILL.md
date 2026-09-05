---
name: montar-relatorio
description: Montar páginas/relatórios do Studio Console (Markdown+SQL, View Blocks, fonte semântica) — dialeto, compiladores compartilhados, APIs e verificação nos 3 ambientes. Use ao criar/editar páginas .md de relatório, blocos viewblock ou páginas sobre catálogo semântico.
---

# Montar relatórios no Studio Console

Raiz do app: `studio-console/` (monorepo npm workspaces: `web/` React+Vite, `server/` Express+DuckDB, `shared/` JS puro, `tests/` vitest na RAIZ). Detalhes completos: `README.md` e os guias `GUIA_ARQUITETO.md` / `GUIA_RELATORIOS.md`. As specs normativas (`SPEC_arquitetura_informacao_viewblock.md`, `SPEC_fase3_semantica_nested.md`, `SPEC_fase4_semantica_rica.md`) ficam no workspace de desenvolvimento, um nível acima — não acompanham o repositório publicado; quando não estiverem presentes, o contrato vigente é o CÓDIGO em `shared/` mais os testes.

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

- Cru: `compileViewblock(vb, ctx)` de `shared/viewStyles.js` (11 estilos: tabular, graph.bar/line/bubble, group, freeform, pivot, connectionmap, collabgraph, areamap, nested). Os estilos propagam `label` e `fmt` da métrica para o componente — `tabular`/`group` em `<Column>`, `freeform` em `<BigValue>`; métrica sem `fmt` sai sem o atributo.
- Semântico: `compileCatalogSql(...)` de `shared/semanticCompile.js` + `compileViewblock` — ou, no web, `compileSemanticFromState`/`recompileSemanticVb` de `web/src/wizard/vbState.ts`.
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

`semantic/<m>.yaml`: `fact`, `dimensions` (column/columns+key/bins/map, hierarchy temporal, pii), `metrics` (agg fechado sum/avg/min/max/count/count_distinct; `filters` embutidos; `derived` com aritmética + `total(m[, scope: all])` + `lag/acum/movel`; `semi_additive`), `joins` (declarados, com `cardinality`), `hierarchies` (drill ⤵/⤴ entre dims), `policies` (expose: internal), `description`/`synonyms` (grounding do agente). O SQL sai do compilador com header `-- semantic: <m>@<hash>` — **SQL nunca é escrito à mão nem vem de IA para bloco semântico**. Publish público recusa dims internas/pii (erro, use visibility internal).

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

## Armadilhas do ambiente

- `node`/`npm` fora do PATH em shell novo: prefixar `$PROGRAMFILES/nodejs` (bash) ou `$env:ProgramFiles\nodejs` (PowerShell).
- Porta 3001 ocupada = a API do preview JÁ roda com --watch — use-a, não suba outra (esperar ~1-2s após editar server/).
- Vite órfão na 5173: `taskkill` no PID e `preview_start` de novo.
- Segredos JAMAIS em yaml/página/erro de API — `.secrets.json` (write-only) e `redactSecrets`.
