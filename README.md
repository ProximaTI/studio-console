# Studio Console

Console local para construir **data products** com **Markdown + SQL** sobre **DuckDB** —
gráficos ao vivo, wizard guiado, camada semântica opcional e dois modos de publicação,
rodando offline na sua máquina. O dialeto é o do **Evidence.dev** (portabilidade), mas o
produto é independente: o runtime próprio e os publishes funcionam sem Evidence.

> **Começando?** Escolha entre o [guia detalhado](GUIA_RELATORIOS.md) e o [roteiro de 5 minutos](GUIA_RELATORIOS_5_MINUTOS.md).

**O projeto é a unidade de trabalho.** Páginas, fontes de dados, queries, models e o
catálogo semântico vivem *dentro* do projeto (isolados por schema DuckDB — upload num
projeto não aparece em outro). O nível global tem só a lista de projetos, o registro de
**Conexões** e Settings.

---

## Instalação e uso

```bash
cd studio-console
npm install
npm run dev
```

- API + DuckDB: http://localhost:3001 · Console: http://localhost:5173
- Requisito: **Node.js 18+**. Testes: `npm test` (Vitest, 163 testes dos módulos puros).

Primeiro contato: abra o **Rascunho** (projeto scratch — explore à vontade e depois
**Promova** para um projeto nomeado), suba um CSV em **Dados › Fontes** e clique em
**▣ Novo relatório**.

## Os dois níveis

**Global** — lista de projetos (abrir/criar/importar; card do Rascunho com
Promover/Descartar), menu **⇌ Conexões** (registro global de bancos, espaço do arquiteto)
e **⚙ Settings** (tema, agente IA).

**Projeto aberto** — sidebar com três espaços:

| Espaço | O que tem |
|---|---|
| **▤ Páginas** | Editor (Notebook / Dividido / Fonte), árvore de `.md` + aba 🧮 queries, badge do linter Evidence, publishes 📦/☁ |
| **⛁ Dados** | Abas **Fontes** (3 tipos, staleness, ↻), **SQL Console** (editor + ✨ Builder visual), **Models** e **Semântica** (catálogos YAML) |
| **▣ Novo relatório** | Wizard de 4 passos que gera um **View Block** reeditável |

Layout em disco (espelha o Evidence on-premise):

```
projects/<nome>/
  pages/         # .md (inclui subpastas e páginas parametrizadas [param].md)
  sources/       # arquivos de dados + parquets materializados + *.sql (views derivadas)
  queries/       # .sql reutilizáveis (frontmatter `queries:`)
  semantic/      # catálogos <modelo>.yaml (opcional)
  models/        # models salvos (.json)
  project.yaml   # fontes/mounts/deploy — versionável, SEM segredos
  .secrets.json  # segredos do projeto (gitignored; write-only pela API)
```

## View Block — o bloco reeditável

O wizard **▣ Novo relatório** (Fonte → Seleção → Argumentos → Apresentação) gera um bloco
delimitado por marcadores em comentário HTML:

````markdown
<!-- viewblock v1 {"id":"vb_ab12cd","source":{...},"dims":[...],"metrics":[...],"style":"graph.bar",...} -->

```sql vb_ab12cd
select unidade, count(distinct atendimento_id) as atendimentos from comissoes ... group by 1
```

<BarChart data={vb_ab12cd} x=unidade y=atendimentos/>

<!-- /viewblock -->
````

- No notebook o bloco aparece com **moldura violeta e células read-only**; os botões
  **▣** (Apresentação), **Σ** (Seleção) e **⚙** (Argumentos) reabrem o passo do wizard
  pré-carregado e regravam **só o bloco** (trocar Graph→Tabular = diff de 2 linhas).
  **Desacoplar** remove os marcadores e o conteúdo vira texto livre.
- O `.md` continua 100% dialeto Evidence — comentários são ignorados no deploy.
- Bloco escrito à mão não tem marcadores: o recurso é opt-in.

**Passos do wizard**:

1. **Fonte** — fontes do projeto, queries salvas e models (viram CTE) ou um **modelo
   semântico** (ver abaixo).
2. **Seleção** — canvas visual (dimensões, medidas Σ com agregação, filtros ⏷); joins
   auto-inferidos para fontes cruas, **só os declarados** para fonte semântica.
3. **Argumentos** — declare `{nome, tipo, origem, default}`; o tipo gera o input **e** o
   predicado: `enum→Dropdown` (LIKE, "Todos"=%), `texto→TextInput`, `número→Slider` (≥),
   `data→DateRange` (BETWEEN). Nada de editar SQL à mão.
4. **Apresentação** — galeria vinda do **registro de estilos**, habilitada por contrato:
   Tabular · Graph barras/linha · Group · Freeform (BigValues) · **Pivot** (colunas
   congeladas + "Outros"; filtros mudam valores, nunca o layout) · ConnectionMap e
   CollaborationGraph (**mapeamento papel→coluna**; o grafo usa 2 queries nodes+edges) ·
   Mapa (Brasil por UF) · **Nested** (pai→filhos, **1 query particionada** — nunca N+1;
   trocar o estilo-filho não re-executa a query).

## Camada semântica (opcional, governança por adoção)

Na aba **Dados › Semântica**, o arquiteto declara `semantic/<modelo>.yaml`:

```yaml
model: comissoes
fact: comissoes
dimensions:
  unidade: { column: unidade, label: "Unidade" }
  servico: { column: servico, label: "Serviço" }
  tempo:   { column: data, hierarchy: [ano, trimestre, mes] }
  cliente: { column: cliente, label: "Cliente", pii: true }
metrics:
  atendimentos:    { agg: count_distinct, column: atendimento_id, label: "Atendimentos", fmt: num0 }
  faturamento:     { agg: sum, column: valor, label: "Faturamento", fmt: brl }
  pct_faturamento: { derived: "faturamento / total(faturamento)", fmt: pct1 }
policies:
  cliente: { expose: internal }
```

- **Validação no save** com erros por caminho (`metrics.x.agg: ...`); modelo válido vira
  fonte no Passo 1 — o analista escolhe métricas/dimensões **com rótulo e formato prontos**,
  sem escrever SQL.
- **Compilador determinístico** (mesma seleção ⇒ SQL byte-idêntico) com proveniência
  (`-- semantic: comissoes@<hash>` no SQL). `derived` aceita aritmética entre métricas +
  `total(m)` (janela sobre o conjunto **filtrado** — % soma 100% no que se vê) e
  `total(m, scope: all)` (universo). Hierarquias expandem nível (coluna do fato se
  existir, senão derivada). Dimensão sem join declarado ⇒ erro apontando o join.
- **✨ Gerar rascunho do modelo**: a heurística do builder roda uma vez e emite YAML
  para revisão.
- **Políticas**: dimensão `pii`/`expose: internal` é **recusada no publish público**
  (erro, nunca omissão); publique como interno para painéis autenticados.
- **Agente groundado**: sobre fonte semântica, a IA escolhe do catálogo; proposta fora
  dele é rejeitada. SQL jamais vem da IA.

### Semântica rica (F4)

- **Validação profunda no save**: com a fonte registrada, colunas do YAML são conferidas
  contra o schema real — erro com caminho e sugestão (`"comissaoo" não existe… coluna
  próxima: comissao`).
- **Grounding**: `description`/`synonyms` em modelo/métrica/dimensão entram no prompt do
  agente ("receita" → `faturamento`).
- **Métricas filtradas**: `filters: [{dim, level?, values}]` na métrica compila para
  agregação condicional (`sum(case when ano=2025 then valor end)`) — um scan, compõe com os
  filtros da página por AND.
- **Inteligência temporal** no `derived`: `lag(m, n, nivel)` (YoY/MoM), `acum(m, nivel)`
  (YTD/acumulado) e `movel(m, n)` (média móvel) — janelas sobre a base agregada; exige o
  nível temporal na seleção (erro claro se faltar).
- **Dimensões calculadas**: `bins` (faixas numéricas) e `map` (de-para) — sem CASE livre;
  herdam política da coluna-fonte (sem vazamento por derivação).
- **Guardas de correção**: `cardinality` nos joins (1→N + soma = erro de fan-out) e
  `semi_additive` (saldo não soma ao longo do tempo — erro educativo).
- **Hierarquias + drill**: `hierarchies: {geografia: [regiao, uf, unidade]}` liga os gestos ⤵/⤴ na
  moldura do bloco semântico no editor — descer filtra pelo valor escolhido e troca o
  eixo pelo nível mais fino (breadcrumb visível); a exploração fica no buffer e
  **salvar a página fixa o drill**.
- **✨ Sugerir relações**: sondas nos DADOS (dependência funcional + cardinalidade)
  propõem hierarquias e cardinalidades com evidência ("uf → regiao: 0 violações em
  1.338 linhas") — você ratifica item a item; nada entra no YAML sem aceite. Funciona
  sem LLM.

## ✨ Relatório completo planejado pela IA (F5)

Em **Novo relatório → Descrever relatório completo**, você escreve o pedido em português
("relatório executivo com KPIs, gráfico por unidade, mapa por UF e detalhe por unidade em
2025"), escolhe público e visibilidade, e a IA propõe um **ReportPlan**: páginas → blocos
com métricas/dimensões/filtros/estilos — **somente nomes do catálogo semântico** (o
servidor carrega o catálogo real; a IA nunca escreve SQL nem Markdown).

- **Revisão obrigatória**: árvore de páginas/blocos com chips, avisos de ambiguidade e
  erros de validação; descarte blocos/páginas, ou "↻ Regerar" com anotação. Plano
  inválido volta com erros — nunca é consertado em silêncio.
- **Geração em duas fases**: tudo é compilado em memória, passa por lint, políticas
  (PII × visibilidade) e execução de amostra de TODAS as queries; conflitos com páginas
  existentes são listados ANTES; a gravação escreve `.tmp` primeiro e promove por
  rename — falha antes da promoção não toca nenhum original; falha na promoção é
  revertida em melhor esforço (não é uma transação atômica de verdade).
- **Ajustes**: cada bloco gerado é um View Block normal — reedite por ▣/Σ/⚙ ou faça
  drill ⤵ como sempre.
- **Navegação gerada**: relatório multipágina ganha barra de links entre as páginas
  (rotas `/pagina/`, que funcionam no editor e nos dois publishes) e, para páginas
  parametrizadas (`[nome].md`, gravadas como `nome/[nome].md`), um índice de valores
  clicáveis na primeira página — no 📦, links sem alvo viram texto com dica em vez de
  404. Links markdown internos agora navegam também no preview do editor.
- Programático: `POST /api/projects/:p/agent/report-plan` e `…/report-apply` (um plano
  montado à mão, sem LLM, também passa pela mesma esteira de validação e gravação).

## ▦ Relatórios spec-driven (F6)

O plano deixou de ser transitório: cada relatório vive numa **spec**
(`projects/<p>/reports/<slug>.md`) — narrativa humana em Markdown + um bloco
```` ```yaml ```` com o contrato (o mesmo ReportPlan). **A spec é a fonte; páginas são
build** — inclusive nos caminhos de falha: salvar página possuída é transacional com o
sync da spec (falhou → gravação desfeita, erro explícito), e o fluxo ✨ grava spec e
páginas no MESMO staging (spec promovida primeiro; nunca há página sem fonte). Menu do projeto: **Relatórios / Páginas / Dados** (o "Novo relatório" virou
botão dentro de Relatórios; o wizard bloco a bloco fica no ▣ da árvore de Páginas).

- **Build de um clique**: catálogo mudou → o relatório marca `desatualizado` → ⚡ Build
  recompila todas as páginas com a MESMA esteira do apply (validação, lint, políticas,
  amostra, duas fases).
- **Regra da verdade** (impressão digital do último build): reedição estruturada
  (wizard ▣/Σ/⚙, drill fixado) **sincroniza o bloco de volta para a spec**
  automaticamente; editar a **spec** deixa o estado `pendente` (rebuild livre); editar a
  **página à mão** deixa `divergente` — resolvido explicitamente por **↻ Recompilar**
  (spec vence) ou **⬇ Reabsorver** (página vence; blocos voltam direto — prosa manual é MOSTRADA e só
  entra em `prose:` com confirmação). Divergência é detectada mesmo com o catálogo
  desatualizado — edição manual nunca é mascarada. Nunca clobber silencioso.
- **⬆ Promover**: páginas existentes com blocos semânticos viram spec (os marcadores
  View Block reconstituem o contrato).
- O fluxo ✨ agora grava a SPEC.md junto e aterrissa na tela do relatório (abas
  Especificação / Estrutura / Páginas / Diagnósticos / Publicações).

## Fontes de dados — três tipos

Em **Dados › Fontes**, o botão **＋ Nova fonte** oferece:

| Tipo | Origem | Refresh | Runtime lê |
|---|---|---|---|
| **Arquivo** | upload CSV/Parquet/JSON (dropzone) | re-upload | parquet/CSV local |
| **View materializada** | banco externo via conexão global | manual (**↻**) | parquet local gerado |
| **Mount** | object storage / pasta de rede | **externo** (Airflow escreve) | parquet remoto/da pasta |

- **Banco externo nunca é consultado no runtime de páginas** — o ATTACH vive só na
  extração (instância efêmera). Página com `ATTACH`/`postgres_scan` é **recusada** nos
  publishes (e o linter avisa); ao vivo, só no SQL Console do arquiteto.
- **View materializada**: escolha a conexão → escreva a query de extração (**▶ Preview**
  de 100 linhas valida antes) → nomeie a fonte → a 1ª materialização gera
  `sources/<nome>.parquet` e registra. O **↻** re-executa com **swap atômico**
  (`.tmp` → rename): re-run interrompido nunca corrompe o parquet em uso.
  **"Última atualização"** (persistida no `project.yaml`, só em sucesso) e o erro do
  último ↻ aparecem no cartão; fonte mais velha que `stale_after` ganha o badge
  *possivelmente desatualizada*.
- **Mount**: `{base_url, prefixo}` — aceita `http(s)://`, `s3://` (via httpfs) ou pasta
  local/UNC. O contrato com o pipeline (Airflow) é "parquet com schema estável no caminho
  combinado". O **☁ Publish app lê direto do mount, sem copiar** — o pipeline atualiza o
  objeto e o app publicado reflete no reload, sem republicar.

### Conexões (registro global)

No menu **⇌ Conexões** (nível da instalação): cadastre uma vez, use em N projetos.
`connections.yaml` versionável guarda só `{tipo, host, porta, database, usuário}`;
a senha entra por **🔑 write-only** (`.secrets.json` global, nunca exibida de volta,
nunca enviada ao browser) ou por variável `STUDIO_SECRET_<NOME>`. **Testar conexão**
valida antes de usar; **Excluir** lista os dependentes (`projeto → fontes`) antes de
confirmar. Projetos referenciam a conexão **pelo nome** — export/clone leva zero
credenciais, e na instalação destino ou existe conexão homônima ou o ↻ falha com
*"conexão X não registrada"*. Tipos: `postgres`/`mysql`/`sqlite` (via `INSTALL` da
extensão DuckDB no primeiro uso), `duckdb` (arquivo, sem extensão) e `s3`
(object storage compatível com S3 — MinIO, AWS).

**Tipo `s3`** — para bucket PRIVADO, que não pode virar mount (o ☁ Publish app
emitiria uma URL `s3://` que o navegador não autentica). O registro guarda
`{bucket, prefix, endpoint, url_style, use_ssl, region}` e o segredo é
`ACCESS_KEY:SECRET_KEY`. Não há banco para anexar: `ext` é um `:memory:` onde
cada dataset parquet sob o `prefix` vira uma **view** — descobertos por `glob`,
ou declarados em `datasets:` quando listar o bucket for caro. Daí em diante é
uma view materializada como qualquer outra (`select * from ext.<dataset>`):

```yaml
datalake:
  type: s3
  bucket: meu-bucket
  prefix: caminho/do/dataset
  endpoint: objstorage.exemplo.com          # host, sem esquema
  url_style: path                           # MinIO usa path
  use_ssl: true
```

## Editor de páginas

- **Notebook** (padrão): células Texto/SQL/Raw com `Run ▶` inline, ▶▶ Rodar tudo,
  barra de filtros `${inputs.x}` e chips de parâmetros; **✨ por célula** chama o agente
  para escrever a sintaxe. View Blocks aparecem agrupados e read-only.
- **Dividido**: markdown + preview ao vivo. **Fonte**: o `.md` puro.
- **Templating**: interpolação `{expr}` no texto (`{resumo[0].total}`), páginas
  parametrizadas `[param].md` (`${params.x}` no SQL, `{params.x}` no texto, seletor de
  valor no topo, assistente "✨ Nova página por…"), frontmatter `queries:` → `.sql` de
  `queries/`.
- **Componentes**: BigValue, BarChart/LineChart (multi-série, swapXY, stacked100),
  BubbleChart, DataTable + Column (fmt, colorscale, link), Dropdown/DropdownOption,
  TextInput, Slider, DateRange, Note, LinkButton, Grid/Card, Tabs, Details, Value,
  AreaMap (coroplético BR), ConnectionMap (arcos geográficos, `map=world|brazil`),
  CollaborationGraph (Cytoscape; componente próprio da console — num deploy Evidence
  on-premise ele exige um port Svelte equivalente, não incluído aqui), Repeat (partição
  do Nested).

### Linter de compatibilidade Evidence

Badge **Evidence ✓ / ⚠ / ℹ** na barra do editor: linta a página + os `.sql` do
frontmatter contra o Evidence real — erros (componente desconhecido, **scan ao vivo em
página**), avisos (`${inputs.x}` sem `.value` em Dropdown, alias `$page.params`,
componentes custom que exigem port) e infos (diferenças de render, fontes
`schema.tabela`). Para TextInput/Slider, `${inputs.x}` **sem** `.value` é o canônico e
não gera aviso.

## Publicação

Os dois botões do editor gravam no destino do projeto (`project.yaml → deploy.dir`,
com fallback ao Settings global). Ambos aceitam **visibilidade** público/interno —
dimensões `internal` do catálogo só compilam no interno.

- **📦 Publish (snapshot)** — HTML único, offline: dados embutidos, combinações de
  Dropdown pré-computadas (inputs livres ficam congelados no default, com dica).
  Rodapé mostra *publicado em* + **dados materializados em** (transparência de frescor).
- **☁ Publish app (Universal SQL)** — `app.html` + runtime **DuckDB-WASM** + `data/*.parquet`:
  as queries rodam **no navegador**, filtros e páginas `?param=` ao vivo. Atualização =
  trocar o parquet (ou deixar o Airflow trocar no mount/bucket — apps de mount nem levam
  cópia). Base URL opcional aponta para object storage (CORS GET liberado). Servir por
  HTTP (workers do WASM não abrem via `file://`).

## Agente (IA) — local ou Anthropic

Backend plugável ([server/routes/ai.js](server/routes/ai.js)) atende o ✨ do Builder, o
assistente por célula e o wizard semântico. Provedores em **Settings › Agente**:
**OpenAI-compatível local** (LM Studio/vLLM/LiteLLM — só a Base URL) ou **Anthropic**
(chave no servidor; nunca vai ao browser). Saída estruturada validada contra o
modelo/catálogo — a IA escolhe seleções; o SQL é sempre do compilador.

## Interface

Tema claro com cor com significado (lima = dados/executar · violeta = IA/wizard/View Block ·
âmbar = filtros/parâmetros), Space Grotesk + JetBrains Mono, tokens em CSS variables
([web/src/styles.css](web/src/styles.css), [web/src/theme.ts](web/src/theme.ts)). Diálogos
próprios substituem alert/confirm/prompt nativos.

## Estrutura do repositório

```
studio-console/
  server/          # Express + DuckDB: query, projects (sources/models/semantic/config/
                   #   secrets/materialized/mounts), connections (global), settings, ai,
                   #   publish/ (snapshot + app), semantic.js, materialize.js, connections.js
  web/             # React + Vite: páginas (Home, Connections, ProjectData, editor),
                   #   wizard/ (4 passos + RoleMapping + PivotConfig), notebook/, render/
  shared/          # módulos puros usados por web + server + apps publicados (StudioRuntime):
                   #   parser, templating, format, chartOption, publishRender, viewblock,
                   #   viewStyles, semanticCatalog, semanticCompile, evidenceLint
  connections.yaml # registro global de conexões (sem segredos) — criado na 1ª conexão,
                   #   fica fora do versionamento junto com settings.json e .secrets.json
  projects/        # projetos (layout acima) — 'exemplo' acompanha o repositório
  tests/           # Vitest (163 testes) — `npx vitest run` da raiz
```

Projetos **externos** (layout Evidence on-premise fora de `projects/`) entram por
`server/external-projects.json`, que mapeia um nome de projeto para um diretório fora
do repositório — útil para editar um projeto Evidence existente sem movê-lo.

## Papéis (convenção, até existir auth)

**Arquiteto**: conexões, views materializadas/↻, catálogos semânticos, project.yaml.
**Analista**: consome fontes/modelos, monta relatórios no wizard, vê staleness.
A console é single-user — os papéis são convenção de UI; segredos, esses sim, são
tecnicamente inacessíveis pelo browser. RBAC real chega com o modo servidor.

## Licença e créditos

Distribuído sob a **Licença Apache 2.0** — veja [LICENSE](LICENSE).
Copyright 2026 Próxima TI.

O Studio Console é desenvolvido pela Próxima TI em parceria com o
[Claude Code](https://claude.com/claude-code) (Anthropic), usado como par de
programação ao longo do projeto — arquitetura, implementação, testes e
documentação. As contribuições aparecem no histórico do Git com o trailer
`Co-Authored-By`.
