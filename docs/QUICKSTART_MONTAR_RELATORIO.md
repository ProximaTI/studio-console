# Quickstart — skill `/montar-relatorio`

**Montar relatórios do Studio Console pedindo em português ao Claude Code.** A skill
carrega, de uma vez, o dialeto das páginas, os compiladores de `shared/`, as APIs da
console e o roteiro de verificação — de modo que o agente monte a página do jeito certo em
vez de improvisar Markdown e SQL.

Pré-requisito de leitura: o [tutorial de treinamento](TUTORIAL_TREINAMENTO.md) (ou já saber
o que são **fonte**, **View Block**, **catálogo semântico** e **spec**). A skill acelera o
trabalho; ela não substitui entender o produto.

---

## 1. Ter tudo no lugar (2 minutos)

| Item | Como conferir |
|---|---|
| Repositório clonado | você está em `studio-console/` |
| Console rodando | `npm run dev` num terminal (API 3001 + web 5173) |
| Claude Code aberto **nesta pasta** | a skill vem versionada em `.claude/skills/montar-relatorio/` |
| Um projeto com dados | fonte registrada e, de preferência, catálogo semântico |

> A skill é **do repositório**, não da sua máquina: quem clona já a tem. Mas ela só é
> encontrada se o Claude Code for aberto a partir de `studio-console/` (ou de um diretório
> acima dela).

Para conferir que o agente enxerga a skill, digite `/` e procure **montar-relatorio** na
lista.

---

## 2. Invocar

Duas formas, mesmo efeito:

```text
/montar-relatorio crie uma página de ranking de instituições no projeto treinamento usando o catálogo producao
```

…ou simplesmente descrever a tarefa — a skill se anuncia sozinha quando o pedido envolve
página `.md`, View Block ou catálogo semântico:

```text
no projeto treinamento, monte uma página com o ranking das instituições por artigos
```

Prefira a forma explícita com `/` quando quiser **garantir** que as regras entrem em jogo
(por exemplo, num pedido curto que poderia parecer "só editar um arquivo").

---

## 3. Os quatro pedidos que cobrem quase tudo

Copie, troque o que está entre colchetes.

**a) Uma página nova a partir do catálogo**

```text
/montar-relatorio no projeto [treinamento], crie a página [ranking_ies.md] com [artigos,
% do total, % com FWCI ≥ 1] por [instituição], filtro de [ano], estilo [tabela],
usando o catálogo [producao]
```

**b) Um relatório multipágina (o caminho preferido)**

```text
/montar-relatorio no projeto [treinamento], monte um relatório spec-driven chamado
[panorama_producao] com: visão geral (indicadores + evolução por ano + mapa por UF),
uma página de áreas e uma página parametrizada por instituição. Filtro global de ano,
visibilidade pública, catálogo [producao]
```

Aqui a skill usa a **esteira ReportPlan** (validação → lint → políticas → execução de
amostra de todas as queries → gravação em duas fases), não grava página a página.

**c) Mudar um relatório que já existe**

```text
/montar-relatorio no relatório [panorama_producao], acrescente uma página de natureza
jurídica com artigos, % do total e % com FWCI ≥ 1, e rode o build
```

A skill edita a **spec** e recompila. Ela não vai editar as páginas construídas à mão —
isso deixaria o relatório `divergente`.

**d) Publicar**

```text
/montar-relatorio publique [panorama.md] como snapshot e a página parametrizada
[ies/[ies].md] como app, no projeto [treinamento]
```

---

## 4. O que acontece quando você pede (exemplo real)

Pedido: *"criar uma página avulsa de ranking de instituições no projeto `treinamento`, a
partir do catálogo semântico `producao`"*. A skill conduziu o agente por estes passos:

1. **Leu o catálogo** `projects/treinamento/semantic/producao.yaml` e calculou o hash
   (`8f531ac9`), em vez de adivinhar nomes de métricas.
2. **Consultou a fonte** por `GET /api/projects/treinamento/sources` para ter as colunas
   reais do fato.
3. **Compilou o bloco** com `compileSemanticBlock` (de `shared/reportCompiler.js`) — a
   mesma função que o wizard da interface usa. O SQL saiu com o carimbo
   `-- semantic: producao@8f531ac9`; o marcador `viewblock` saiu na forma canônica.
4. **Gravou a página** por `PUT /api/projects/treinamento/file`, com uma abertura em prosa
   avisando que `artigos` conta vínculos IES–artigo.
5. **Verificou nos três ambientes**: rodou o SQL pela API, abriu a página no editor em modo
   **Dividido** (badge **Evidence ✓**, tabela renderizada) e publicou 📦 e ☁ — os três
   concordaram (USP 95.104 · 7,2% · 34,5%).

Resultado: `pages/ranking_ies.md` com um View Block reeditável pelos botões **▣ Σ ⚙** da
interface. O que o agente escreveu à mão foi **o texto**; o SQL e o bloco vieram do
compilador.

---

## 5. As regras que a skill faz valer (não negocie com elas)

| Regra | Por que existe |
|---|---|
| **SQL de View Block sai do compilador** — nunca da IA, nunca da mão | mesma seleção ⇒ SQL idêntico, com proveniência e políticas aplicadas |
| **Nunca escrever o marcador `viewblock` à mão** | o JSON tem forma canônica; escrito à mão, quebra a reedição por ▣/Σ/⚙ |
| **Banco externo nunca em página** (`ATTACH`, `postgres_scan`) | erro no lint e nos dois publishes; use view materializada ou mount |
| **A spec é a fonte; páginas são build** | editar a página possuída gera `divergente`, que exige decisão manual |
| **Segredo jamais em YAML, página ou resposta de API** | credencial mora no `.secrets.json` write-only |
| **Verificação nos 3 ambientes** | editor, 📦 e ☁ executam por caminhos diferentes — têm de concordar |

Se o seu pedido colidir com uma dessas regras, a skill vai propor o caminho correto em vez
de obedecer. Isso é a skill funcionando, não um bloqueio.

---

## 6. Como escrever um bom pedido

Um pedido completo responde a seis coisas — quanto mais faltar, mais o agente vai perguntar
(ou assumir):

1. **Projeto** — `no projeto treinamento`
2. **Fonte da verdade** — `usando o catálogo producao` (ou o nome da fonte crua)
3. **Métricas** — `artigos e % com FWCI ≥ 1`
4. **Recorte** — `por instituição`, `por região e ano`
5. **Interação** — `com filtro de ano`, `com drill região → UF → instituição`
6. **Destino** — `página avulsa`, `dentro do relatório X`, `publicar como app`

Molde pronto:

> No projeto **[projeto]**, crie **[página/relatório]** com **[métricas]** por
> **[dimensões]**, filtro por **[campo]**, no estilo **[tabela/barras/linha/mapa]**, usando
> o catálogo **[modelo]**. Visibilidade **[pública/interna]**.

---

## 7. Como conferir o que voltou

- [ ] A página abre no editor com o badge **Evidence ✓**.
- [ ] Em **Dividido**, os dados renderizam (lembre do filtro: no Notebook é preciso digitar
      `%` na barra de filtros).
- [ ] O SQL do bloco tem o comentário `-- semantic: <modelo>@<hash>`.
- [ ] Se for relatório: a aba **Diagnósticos** está limpa e o estado é `ok`.
- [ ] Os números batem com uma consulta sua no **SQL Console**.
- [ ] Se o agente mexeu em código (`shared/`, `server/`, `web/`): `npx vitest run` da raiz
      `studio-console/` e, para TypeScript, `npx tsc --noEmit` em `web/`.

---

## 8. Quando algo dá errado

| Sintoma | Causa provável | Saída |
|---|---|---|
| "porta 3001 ocupada" | a API já está de pé | use a que está rodando; não suba outra |
| métrica "não existe no catálogo" | nome inventado no pedido | peça pelo rótulo do catálogo, ou declare a métrica antes |
| relatório ficou `divergente` | alguém editou a página à mão | **Recompilar** (spec vence) ou **Reabsorver** (página vence) |
| relatório ficou `desatualizado` | o catálogo mudou de hash | **⚡ Build** |
| publish público recusado | dimensão `pii` / `expose: internal` | publique como **interno** |
| a página não renderiza no ☁ | aberta por `file://` | sirva por HTTP |

---

## 9. Cartão de referência

**Onde as coisas vivem**

```
projects/<proj>/pages/*.md        páginas (index.md = capa)
projects/<proj>/semantic/*.yaml   catálogos
projects/<proj>/reports/*.md      specs (fence ```studio-report)
shared/                           compiladores — a fonte da verdade do SQL
.claude/skills/montar-relatorio/  a skill
```

**APIs que a skill usa** (server na 3001)

```
GET|PUT /api/projects/:p/file           ler/gravar página
POST    /api/query                      rodar SQL no schema do projeto
GET     /api/projects/:p/sources|semantic
POST    /api/projects/:p/agent/report-plan | report-apply
GET|PUT /api/projects/:p/reports/:slug  +  POST /:slug/build | /:slug/absorb
POST    /api/projects/:p/publish | publish-app
```

**Estados de um relatório**

`ok` · `pendente` (spec à frente — build livre) · `divergente` (página editada) ·
`desatualizado` (catálogo mudou) · `quebrado` (spec com erro)

---

> **Para o instrutor:** este quickstart cabe em 20 minutos ao fim do treinamento, depois do
> Módulo 13. O exercício natural é pedir à skill a mesma página que a turma montou pelo
> wizard no Módulo 8 e comparar os dois `.md`: o **SQL e o componente devem coincidir** (só
> o `id` do bloco muda), porque o wizard da interface e a skill chamam o **mesmo**
> compilador de `shared/`. É a demonstração mais curta de por que o SQL não sai da IA.
