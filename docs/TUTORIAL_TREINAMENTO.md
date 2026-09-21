# Tutorial de treinamento — Studio Console

**Do zero ao relatório publicado, em passos pequenos.** Este roteiro foi escrito para uma
turma que nunca abriu o console. Cada módulo tem **objetivo**, **passos numerados** e um
bloco **✅ Como saber que deu certo** com os números exatos que você deve ver na tela — se
o seu número bater, você está no caminho.

Dados do exercício: **produção científica das IES brasileiras (2021–2025)**, extraída do
banco `aderencia` e entregue como **CSV** em
[`docs/treinamento/producao_ies_2021_2025.csv`](treinamento/producao_ies_2021_2025.csv).

| Módulo | O que você faz | Tempo |
|---|---|---|
| [0](#módulo-0--o-que-é-o-studio-console) | Entender o produto e o vocabulário | 10 min |
| [1](#módulo-1--pré-requisitos) | Conferir Node e Git | 10 min |
| [2](#módulo-2--baixar-do-github) | Clonar o repositório | 10 min |
| [3](#módulo-3--instalar-e-subir) | `npm install` + `npm run dev` | 15 min |
| [4](#módulo-4--primeiro-contato-com-a-interface) | Passear pela interface | 10 min |
| [5](#módulo-5--o-arquivo-do-exercício) | Conhecer os dados | 10 min |
| [6](#módulo-6--criar-o-projeto-e-subir-o-csv) | Projeto + fonte | 10 min |
| [7](#módulo-7--explorar-no-sql-console) | Três consultas | 15 min |
| [8](#módulo-8--seu-primeiro-gráfico-o-wizard-) | Wizard de 4 passos | 20 min |
| [9](#módulo-9--anatomia-do-view-block) | Entender o bloco gerado | 15 min |
| [10](#módulo-10--camada-semântica-o-papel-do-arquiteto) | Catálogo semântico | 25 min |
| [11](#módulo-11--relatório-spec-driven) | Spec + Build | 25 min |
| [12](#módulo-12--filtros-e-parâmetros) | Dropdown e página parametrizada | 15 min |
| [13](#módulo-13--publicar) | 📦 snapshot e ☁ app | 20 min |
| [14](#módulo-14--do-csv-de-volta-ao-banco) | View materializada (arquiteto) | 15 min |
| [15](#módulo-15--exercícios) | Praticar | 30 min |

---

## Módulo 0 — O que é o Studio Console

O Studio Console é um **console local de data products**: você escreve páginas em
**Markdown + SQL**, o **DuckDB** executa as consultas na sua máquina e a página vira um
relatório com gráficos, filtros e tabelas. Nada sai para a nuvem enquanto você não mandar.

Três ideias sustentam tudo:

1. **O projeto é a unidade de trabalho.** Páginas, fontes, queries e catálogo vivem dentro
   do projeto, isolados por um schema DuckDB próprio — um CSV subido no projeto A não
   aparece no projeto B.
2. **SQL não se escreve à mão em relatório.** Você escolhe métricas e dimensões; quem
   escreve o SQL é o **compilador**. Isso vale inclusive para a IA: ela escolhe nomes do
   catálogo, nunca redige SQL.
3. **A spec é a fonte; as páginas são build.** Um relatório é um contrato em YAML; as
   páginas `.md` são geradas a partir dele e podem ser regeradas a qualquer momento.

Vocabulário que vai aparecer o tempo todo:

| Termo | Significado |
|---|---|
| **Fonte** | um dado registrado no projeto (arquivo, view materializada ou mount) |
| **Página** | um arquivo `.md` em `pages/` — Markdown + blocos SQL + componentes |
| **View Block** | bloco gerado pelo wizard, delimitado por marcadores, reeditável por botões |
| **Catálogo semântico** | YAML onde o arquiteto declara métricas e dimensões com rótulo e formato |
| **Spec de relatório** | `reports/<slug>.md`: narrativa + contrato YAML que gera as páginas |
| **Publish** | 📦 snapshot (HTML único) ou ☁ app (Parquet + DuckDB no navegador) |

> **Papéis (convenção, não login):** o **arquiteto** declara de onde vêm os dados e o que
> as métricas significam; o **analista** consome o catálogo e monta relatórios. No
> treinamento você fará os dois — e vai perceber quando trocar de chapéu.

---

## Módulo 1 — Pré-requisitos

**Objetivo:** garantir que a máquina tem o que o console precisa.

### 1.1 Node.js 18 ou superior

Abra o terminal (no Windows: **PowerShell**) e rode:

```bash
node --version
```

- Saiu algo como `v20.11.0`, `v22.x` ou `v24.x`? Pode seguir.
- Saiu erro, ou versão menor que 18? Instale o Node LTS em <https://nodejs.org> (escolha
  "LTS"), **feche e reabra o terminal** e teste de novo.

> **Windows:** se o `node` funciona no instalador mas não no terminal, o PATH não foi
> recarregado. Reabra o terminal; se persistir, chame pelo caminho completo:
> `& "$env:PROGRAMFILES\nodejs\node.exe" --version`.

### 1.2 npm

```bash
npm --version
```

Vem junto com o Node (10.x ou superior). Se `node` responde e `npm` não, reinstale o Node.

### 1.3 Git

```bash
git --version
```

Sem Git? Instale em <https://git-scm.com/downloads> — ou use o **Módulo 2, opção B**
(download do ZIP).

### 1.4 Um navegador moderno

Chrome, Edge ou Firefox atualizados. O console usa WebAssembly no publish ☁.

✅ **Como saber que deu certo:** os três comandos respondem com um número de versão, sem
mensagem de erro.

---

## Módulo 2 — Baixar do GitHub

**Objetivo:** ter o código na sua máquina.

### Opção A — clonar com Git (recomendado)

1. Escolha uma pasta para seus projetos e entre nela:

```bash
cd ~/projetos
```

(No Windows, algo como `cd C:\projetos`. Se a pasta não existe, crie antes: `mkdir C:\projetos`.)

2. Clone o repositório:

```bash
git clone https://github.com/ProximaTI/studio-console.git
```

3. Entre na pasta criada:

```bash
cd studio-console
```

### Opção B — baixar o ZIP (sem Git)

1. Abra <https://github.com/ProximaTI/studio-console> no navegador.
2. Botão verde **Code** → **Download ZIP**.
3. Extraia em `C:\projetos\studio-console` (ou equivalente).
4. No terminal, entre na pasta extraída.

### 2.1 Confira que você está no lugar certo

```bash
ls
```

Você deve ver, entre outros: `package.json`, `README.md`, `server/`, `web/`, `shared/`,
`projects/`. **É nesta pasta que todos os comandos do tutorial rodam.**

✅ **Como saber que deu certo:** `ls` mostra `package.json` e as pastas `server`, `web`,
`shared` e `projects`.

---

## Módulo 3 — Instalar e subir

**Objetivo:** ver o console rodando no navegador.

### 3.1 Instalar as dependências

```bash
npm install
```

Demora alguns minutos na primeira vez (baixa o DuckDB nativo, o React, o Vite). Avisos
`npm warn deprecated` são normais; o que importa é terminar sem `ERR!`.

### 3.2 Subir o console

```bash
npm run dev
```

Esse comando sobe **dois processos ao mesmo tempo**:

- **server** — a API e o motor DuckDB, em <http://localhost:3001>
- **web** — a interface, em <http://localhost:5173>

No terminal aparecem linhas prefixadas por `[server]` e `[web]`, e o navegador abre sozinho
em `http://localhost:5173`. **Deixe esse terminal aberto** — fechá-lo derruba o console.
Para parar: `Ctrl+C`.

### 3.3 (Opcional) Rodar os testes

Em **outro** terminal, na mesma pasta:

```bash
npx vitest run
```

São 163 testes dos módulos puros; servem para confirmar que a instalação está íntegra.

### Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `EADDRINUSE :5173` ou `:3001` | já existe um console rodando | feche a outra janela, ou use a que já está de pé |
| navegador não abre sozinho | configuração do SO | digite `http://localhost:5173` na barra |
| tela em branco | o `web` subiu antes do `server` | recarregue a página (F5) |
| `npm` não é reconhecido | Node fora do PATH | reabra o terminal ou use o caminho completo do Node |
| firewall pedindo permissão | Node abrindo porta local | permita em **rede privada** |

✅ **Como saber que deu certo:** o navegador mostra a tela **Projetos**, com o cartão
**exemplo** e o cartão **Rascunho** marcado com a etiqueta `scratch`.

---

## Módulo 4 — Primeiro contato com a interface

**Objetivo:** saber onde ficam as coisas antes de mexer nos seus dados.

### 4.1 Os dois níveis

O console tem **dois níveis**, e confundi-los é o erro nº 1 de quem começa:

- **Global** (a tela inicial): a lista de **Projetos**, o menu **Conexões** (registro de
  bancos, espaço do arquiteto) e **Settings** (tema, agente de IA, pasta de publicação).
- **Projeto aberto**: a barra lateral muda e passa a mostrar **Relatórios**, **Páginas** e
  **Dados** — tudo dali para baixo pertence àquele projeto.

### 4.2 Passeio guiado (5 minutos)

1. Na tela **Projetos**, clique em **Abrir** no cartão **exemplo**.
2. Você caiu em **Páginas** — o editor. Na árvore à esquerda, clique em `painel_rede.md`.
3. No topo do editor, experimente os três modos:
   - **Notebook** — células de Texto/SQL/Raw com `▶` para rodar cada uma;
   - **Dividido** — Markdown à esquerda, **página renderizada ao vivo** à direita;
   - **Fonte** — o `.md` puro, sem enfeite.
4. Clique em **▶▶ Rodar tudo** e veja as tabelas aparecerem embaixo de cada célula SQL.
5. Repare nos blocos com **moldura violeta** e os botões **▣ Σ ⚙** — são View Blocks
   (Módulo 9).
6. Volte em **Projetos** (canto superior esquerdo) para sair do projeto.

> **Dica de treinamento:** o projeto `exemplo` acompanha o repositório justamente para ser
> estragado à vontade. O **Rascunho** (`scratch`) também: é um projeto descartável, que
> depois pode ser **Promovido** para um projeto nomeado.

✅ **Como saber que deu certo:** você rodou uma página do `exemplo` e viu gráficos e tabelas
com dados.

---

## Módulo 5 — O arquivo do exercício

**Objetivo:** entender o dado antes de desenhar qualquer gráfico. Analista que pula esta
etapa erra o denominador.

### 5.1 De onde vem

O arquivo saiu do banco **`aderencia`** (PostgreSQL), que consolida a produção científica
das instituições brasileiras a partir do **OpenAlex** cruzado com o cadastro da **CAPES**.
Lá o dado é grande (1,3 milhão de vínculos artigo–instituição, dezenas de milhões de
arestas de citação); para o treinamento ele foi **agregado e exportado em CSV**. O SQL da
extração está no [Apêndice A](#apêndice-a--o-sql-da-extração).

**Arquivo:** `docs/treinamento/producao_ies_2021_2025.csv` — 2,9 MB, **35.993 linhas**.

**Procedência e licença.** Os indicadores (artigos, citações, FWCI, acesso aberto) e a
taxonomia de domínio/campo são derivados do **OpenAlex**, publicado sob **CC0 1.0** —
domínio público, sem exigência de atribuição, embora ela seja boa prática e esteja feita
aqui. O cruzamento com o cadastro da CAPES fornece UF, região e natureza jurídica da
instituição. É por isso que este CSV acompanha o repositório público: **nenhuma coluna
contém dado pessoal nem informação sob restrição** — o grão é a instituição, não a pessoa,
e não há autor, ORCID nem identificador individual.

Se você substituir esta base pela sua, confira as duas coisas antes: que a licença da fonte
permita redistribuição, e que o grão agregado não permita reidentificar indivíduo.

### 5.2 O grão (leia duas vezes)

**Uma linha = uma combinação (IES, ano, campo do conhecimento).** Não é uma linha por
artigo. As colunas de contagem já vêm somadas dentro dessa combinação.

### 5.3 Dicionário de colunas

| Coluna | Tipo | O que é |
|---|---|---|
| `ies` | texto | sigla da instituição sede (384 valores) |
| `uf` | texto | unidade da federação (27 valores) |
| `regiao` | texto | Norte, Nordeste, Centro-Oeste, Sudeste, Sul |
| `status_juridico` | texto | Federal, Estadual, Municipal, Privada |
| `ano` | inteiro | ano de publicação (2021–2025) |
| `dominio` | texto | grande área do OpenAlex (4 valores, rótulo em inglês) |
| `campo` | texto | campo do conhecimento (26 valores, rótulo em inglês) |
| `artigos` | inteiro | vínculos IES–artigo |
| `artigos_fwci1` | inteiro | destes, os com FWCI ≥ 1 |
| `artigos_nacionais` | inteiro | destes, os publicados em periódico nacional |
| `artigos_abertos` | inteiro | destes, os em acesso aberto (qualquer via) |
| `citacoes` | inteiro | referências que esses artigos **fazem** |
| `citacoes_nacionais` | inteiro | destas, as que apontam para periódico nacional |

### 5.4 Três armadilhas que o treinamento vai cobrar

1. **`artigos` conta vínculos, não artigos.** Um artigo assinado por USP e UNICAMP conta
   **nas duas**. A soma do arquivo dá **1.313.043 vínculos**, para **812.189 artigos
   distintos**. Serve para **comparar recortes**; nunca escreva "o Brasil publicou 1,3
   milhão de artigos".
2. **`citacoes` é consumo, não impacto.** São as referências que os artigos **fazem**.
   Impacto recebido está em `artigos_fwci1` (FWCI 1,0 = média mundial da área e do ano).
3. **`artigos_abertos` inclui repositório.** Por isso o percentual beira 84% — é composição
   de via de acesso, não "qualidade aberta".

✅ **Como saber que deu certo:** você consegue explicar, em uma frase, por que somar
`artigos` de todas as IES **não** dá o número de artigos do Brasil.

---

## Módulo 6 — Criar o projeto e subir o CSV

**Objetivo:** ter os dados registrados como **fonte** de um projeto seu.

1. Na tela **Projetos**, clique em **＋ Novo projeto** (canto superior direito).
2. Digite `treinamento` e confirme em **OK**.
   > Use letras minúsculas, sem espaços nem acentos — o nome vira pasta e schema DuckDB.
3. O projeto aparece na lista. Clique em **Dados** no cartão dele (ou abra o projeto e use
   **Dados** na barra lateral).
4. Você está na aba **Fontes**. No alto há uma área tracejada: *"⇪ Arraste CSV, Parquet ou
   JSON aqui — cada arquivo vira uma tabela do projeto `treinamento` · máx. 500 MB"*.
5. **Arraste** `producao_ies_2021_2025.csv` para essa área — ou clique em
   **Escolher arquivo** e selecione-o em `docs/treinamento/`, dentro da pasta do
   repositório.
6. Aguarde alguns segundos: o DuckDB lê o CSV, infere os tipos e registra a fonte.

> **O botão ＋ Nova fonte** abre o mesmo caminho pelo formulário, com os três tipos que o
> console aceita: **Arquivo (CSV/Parquet/JSON)**, **View materializada (banco → parquet)** e
> **Mount (bucket/pasta — Airflow escreve)**. Os dois últimos são trabalho de arquiteto e
> aparecem no Módulo 14.

### O que aconteceu por baixo

- O arquivo foi copiado para `projects/treinamento/sources/`.
- A fonte ganhou o nome do arquivo, normalizado: **`producao_ies_2021_2025`**. É esse o
  nome que você usará no `from` do SQL.
- Ela virou uma **view** dentro do schema `proj_treinamento` — invisível para os outros
  projetos.

✅ **Como saber que deu certo:** em *FONTES DO PROJETO · 1* aparece o cartão
**`producao_ies_2021_2025` · 13 col**, listando `ies varchar`, `uf varchar`,
`regiao varchar`, `status_juridico varchar`, `ano bigint`, `dominio varchar` e um `+7`, com
a data em **Última atualização**.

---

## Módulo 7 — Explorar no SQL Console

**Objetivo:** confirmar os números do arquivo com as suas próprias mãos. É o único módulo
em que escrever SQL é a lição — nas páginas, o SQL virá do compilador.

Vá em **Dados › SQL Console**. A aba **Editor** tem a caixa de SQL, o botão **Run ▶** e uma
lista de tabelas do projeto à esquerda (com um campo *filtrar tabelas…*). Cole cada consulta
abaixo e clique em **Run ▶**.

> Ao lado do Editor existe o **✨ Builder visual**, que monta a consulta por cliques, e um
> botão para **salvar a query em `queries/`** e reusá-la nas páginas.

### 7.1 Tamanho e cobertura

```sql
select count(*) as linhas,
       count(distinct ies) as instituicoes,
       count(distinct uf) as ufs,
       count(distinct campo) as campos,
       sum(artigos) as vinculos
from producao_ies_2021_2025;
```

Resultado esperado: **35.993 · 384 · 27 · 26 · 1.313.043**.

### 7.2 Evolução por ano

```sql
select ano, sum(artigos) as artigos, sum(citacoes) as citacoes
from producao_ies_2021_2025
group by 1
order by 1;
```

| ano | artigos | citacoes |
|---|---|---|
| 2021 | 282.979 | 6.591.041 |
| 2022 | 253.483 | 5.923.746 |
| 2023 | 259.044 | 5.874.803 |
| 2024 | 273.216 | 6.031.658 |
| 2025 | 244.321 | 5.731.180 |

> **Leitura honesta:** a queda de 2025 quase certamente é **cobertura da base**, não
> produção — artigos recentes ainda estão sendo indexados. Isso precisa estar escrito no
> relatório, não só sabido pelo analista.

### 7.3 Impacto por região

```sql
select regiao,
       sum(artigos) as artigos,
       round(100.0 * sum(artigos_fwci1) / sum(artigos), 1) as pct_fwci1
from producao_ies_2021_2025
group by 1
order by 2 desc;
```

Esperado: Sudeste 609.387 (28,7%) · Nordeste 251.245 (22,1%) · Sul 250.805 (23,8%) ·
Centro-Oeste 123.400 (25,3%) · Norte 78.206 (22,1%).

✅ **Como saber que deu certo:** os três resultados batem com os números acima.

> **Regra de ouro que nasce aqui:** o SQL Console é o **espaço de exploração do arquiteto**.
> Consulta exploratória fica aqui; o que vai para a página sai do wizard ou do catálogo.

---

## Módulo 8 — Seu primeiro gráfico: o wizard ▣

**Objetivo:** produzir um gráfico publicável **sem escrever uma linha de SQL**.

1. Na barra lateral, clique em **Páginas**.
2. Na barra de botões acima da árvore de arquivos, clique em **▣**
   (*Wizard de View Block: Fonte → Seleção → Argumentos → Apresentação*).
3. **Passo 1 · Fonte** — em *FONTES DO PROJETO*, clique em **⛁ producao_ies_2021_2025** e
   depois em **Avançar →**.
4. **Passo 2 · Seleção** — marque:
   - em *medidas*: `citacoes` (agregação `sum`);
   - em *dimensões*: `regiao`.

   O rodapé deve dizer **1 métrica(s) · 1 dimensão(ões)**. **Avançar →**.
5. **Passo 3 · Argumentos** — deixe vazio por enquanto (é onde nascem os filtros da página;
   voltaremos no Módulo 12). **Avançar →**.
6. **Passo 4 · Apresentação** — a galeria mostra os estilos. Repare que alguns estão
   **desabilitados com o motivo escrito**: *"Graph · linha (tempo) — precisa de 1 dimensão
   TEMPORAL (ano/data/mês) e ≥1 métrica"*, *"Mapa (Brasil por UF) — precisa de 1 dimensão
   geográfica"*. Escolha **▮▮▮ Graph · barras**.
7. Clique em **▣ Gerar relatório**. Uma caixa pergunta o **nome da página (.md)** e sugere
   algo como `producao_por_regiao`. Confirme em **OK**.

O console **cria uma página nova** com esse nome, já aberta no editor, com o bloco pronto.

8. Clique em **Dividido** para ver o gráfico renderizado à direita.

✅ **Como saber que deu certo:** existe `producao_por_regiao.md` na árvore, e o gráfico de
barras mostra o Sudeste na frente, com o eixo Y em milhões de citações.

---

## Módulo 9 — Anatomia do View Block

**Objetivo:** entender o que o wizard escreveu — e por que não se mexe nele à mão.

Abra a página gerada em **Fonte**. Você verá três partes entre marcadores:

````markdown
<!-- viewblock v1 {"id":"vb_b1f701","source":{...},"dims":[{"dim":"regiao",...}],
     "metrics":[{"name":"citacoes",...}],"style":"graph.bar", ...} -->

```sql vb_b1f701
select "regiao", sum("citacoes") as "citacoes"
from "producao_ies_2021_2025"
group by 1
order by "citacoes" desc
limit 1000
```

<BarChart data={vb_b1f701} x=regiao y=citacoes yFmt=num0 seriesLabels={["Citações feitas"]}/>

<!-- /viewblock -->
````

| Parte | O que é |
|---|---|
| comentário `viewblock v1` | **o contrato**: fonte, dimensões, métricas, filtros, estilo |
| bloco ```` ```sql nome ```` | **o SQL compilado** a partir do contrato — o resultado vira a variável `nome` |
| componente `<BarChart …>` | **a apresentação**, consumindo aquela variável |

No modo **Notebook**, o bloco aparece com **moldura violeta** e células **read-only**, e
ganha quatro ações:

- **▣ Apresentação** — troca o estilo (barras → tabela → mapa…) sem refazer a seleção;
- **Σ Seleção** — volta ao passo 2 (métricas e dimensões);
- **⚙ Argumentos** — volta ao passo 3 (filtros e parâmetros);
- **Desacoplar** — remove os marcadores; o conteúdo vira texto livre e você assume o SQL.

**Experimente agora:** clique em **▣**, escolha **▦ Tabular** e gere. Compare o `.md` antes
e depois — mudou pouco mais que duas linhas, e o SQL continua sendo do compilador.

> **Regra inviolável:** *nunca* escreva ou edite o marcador `viewblock` à mão, e nunca
> edite o SQL de dentro do bloco. Precisa de algo que o wizard não faz? **Desacople** o
> bloco e assuma o SQL — explicitamente, não por acidente.

✅ **Como saber que deu certo:** você trocou o estilo do bloco por um botão e o gráfico virou
tabela sem perder a seleção.

---

## Módulo 10 — Camada semântica: o papel do arquiteto

**Objetivo:** transformar colunas em **métricas com nome, rótulo e formato**, para que o
analista nunca mais precise lembrar que "% de impacto" é `artigos_fwci1 / artigos`.

### 10.1 O problema que ela resolve

No Módulo 8 você escolheu a coluna `citacoes` e a agregação `sum`. Multiplique isso por dez
analistas e você terá dez definições diferentes de "impacto", metade delas com o
denominador errado. O catálogo declara a verdade **uma vez**.

### 10.2 Criar o modelo

1. Vá em **Dados › Semântica**.
2. Clique em **＋ Novo modelo** e dê o nome `producao` (o arquivo nasce como
   `semantic/producao.yaml`).
3. Cole o conteúdo de [`docs/treinamento/producao.yaml`](treinamento/producao.yaml) no
   editor e salve.

Trecho comentado do que você está colando:

```yaml
model: producao
fact: producao_ies_2021_2025          # a fonte do Módulo 6
grain: [ies, ano, campo]              # o grão, documentado

dimensions:
  ies:     { column: ies, label: "Instituição", synonyms: [IES, universidade] }
  uf:      { column: uf, label: "UF", geo: brazil-states }   # habilita o mapa
  regiao:  { column: regiao, label: "Região" }
  ano:     { column: ano, label: "Ano de publicação" }

metrics:
  artigos:
    agg: sum
    column: artigos
    label: "Artigos"
    fmt: num0
    description: >-
      Conta VÍNCULOS IES–artigo: coautoria entre duas IES conta nas duas.
  pct_fwci1:
    derived: "artigos_fwci1 / artigos"    # aritmética entre métricas
    label: "% de artigos com FWCI ≥ 1"
    fmt: pct1
  pct_artigos:
    derived: "artigos / total(artigos)"   # total() = janela sobre o conjunto filtrado

hierarchies:
  geografia: [regiao, uf, ies]            # habilita o drill ⤵ / ⤴
  area: [dominio, campo]
```

### 10.3 O que o save faz por você

- **Valida a estrutura** e aponta o erro **pelo caminho** (`metrics.pct_fwci1.derived: …`).
- **Confere as colunas contra a fonte real**: se você escrever `artigoss`, o erro sugere a
  coluna mais próxima.
- Gera um **hash de proveniência**: o cartão do modelo passa a mostrar
  **`producao.yaml · @8f531ac9`**, e o mesmo hash é carimbado em todo SQL compilado
  (`-- semantic: producao@8f531ac9`).

> **Atalhos do arquiteto:** **✨ Gerar rascunho do modelo** roda uma heurística sobre a
> fonte e emite um YAML inicial para você revisar — ele **propõe**, quem declara é você.
> **✨ Sugerir relações** vai além: testa dependência funcional nos seus dados e propõe
> hierarquias com evidência ("uf → regiao: 0 violações em 35.993 linhas"). Nada entra no
> YAML sem o seu aceite, e nada disso depende de LLM.

### 10.4 Refazer o gráfico — agora pelo catálogo

1. Clique em **▣** de novo.
2. **Passo 1** — agora existe uma seção no topo: **MODELOS SEMÂNTICOS (GOVERNADOS —
   MÉTRICAS E RÓTULOS PRONTOS)**, com **◆ Produção científica das IES brasileiras
   (2021–2025) · 11 métricas · 7 dims · @8f531ac9**. Escolha-o.
3. **Passo 2** — em vez de colunas cruas você vê **Artigos**, **% de artigos com FWCI ≥ 1**,
   **Citações feitas**… Marque **Artigos** e **% de artigos com FWCI ≥ 1**, e a dimensão
   **Região**.
4. **Passo 4** — escolha **▦ Tabular** e gere a página `impacto_por_regiao`.

Repare no resultado: a coluna já sai com o **rótulo** e o **formato percentual** certos, e o
SQL traz o comentário de proveniência. Ninguém digitou uma divisão.

✅ **Como saber que deu certo:** a tabela mostra Sudeste **609.387** artigos e **28,7%**, com
o cabeçalho escrito por extenso.

---

## Módulo 11 — Relatório spec-driven

**Objetivo:** sair de "páginas soltas" para um **produto de dados versionável**: um contrato
que gera várias páginas com navegação.

### 11.1 Criar a spec

1. Barra lateral → **Relatórios**.
2. Se o seu ambiente tem agente de IA configurado (**Settings › Agente**), use
   **+ Novo relatório (✨ descrever)** → **Descrever relatório completo** e escreva:

   > Crie um relatório executivo da produção científica das IES brasileiras com uma visão
   > geral contendo indicadores, evolução por ano, mapa por UF e volume por região; uma
   > página de áreas do conhecimento; e uma página parametrizada por instituição. Filtro
   > global por ano. Visibilidade pública.

   A IA propõe um **plano** usando **somente** nomes do catálogo; você revisa, descarta
   blocos e manda gerar. SQL e Markdown saem dos compiladores, depois da sua aprovação.

3. **Sem agente configurado** (caminho garantido do treinamento): crie o arquivo
   `reports/panorama_producao.md` e cole o conteúdo de
   [`docs/treinamento/panorama_producao.md`](treinamento/panorama_producao.md).

O coração da spec é o bloco ```` ```studio-report ````:

```yaml
name: panorama_producao
title: Panorama da produção científica
visibility: public
catalog: producao                 # o modelo do Módulo 10
globalParams:
  - { name: ano, type: enum, from: ano, default: "%", label: Ano }
pages:
  - path: panorama.md
    title: Panorama
    blocks:
      - { id: kpis, metrics: [artigos, pct_fwci1, pct_nacional, pct_oa], dims: [], style: freeform }
      - { id: evolucao, metrics: [artigos], dims: [{ dim: ano }], style: graph.line }
      - { id: mapa, metrics: [artigos], dims: [{ dim: uf }], style: areamap }
  - path: "[ies].md"
    title: Instituição
    parameter: { name: ies, dimension: ies }
    blocks:
      - { id: ies_kpis, metrics: [artigos, pct_fwci1], dims: [], style: freeform }
```

Tudo que está **fora** do bloco é narrativa sua — contexto, ressalvas, como ler. Ela vai
junto para as páginas.

### 11.2 Build

Clique em **⚡ Build (recompilar páginas)**. O console, em duas fases:

1. valida o plano contra o catálogo, aplica o lint do Evidence e as políticas de
   visibilidade, e **executa uma amostra de todas as queries**;
2. só então grava as páginas — em arquivos temporários promovidos por rename.

Se algo falhar, **nada é gravado** e o erro aparece em **Diagnósticos**.

Resultado esperado: **3 páginas escritas** — `panorama.md`, `areas.md` e `ies/[ies].md` —
com 13 queries testadas.

### 11.3 As cinco abas

| Aba | Para quê |
|---|---|
| **Especificação** | a spec: narrativa + YAML, com indicador **Salvo ✓** |
| **Estrutura** | árvore de páginas → blocos → métricas/dimensões (leitura rápida) |
| **Páginas** | estado de cada arquivo + **Abrir no editor**, **Recompilar**, **Reabsorver** |
| **Diagnósticos** | erros e avisos — confira **antes** de publicar |
| **Publicações** | 📦 e ☁ para as páginas do relatório |

### 11.4 Os cinco estados (o que a turma precisa decorar)

| Estado | Significa | O que fazer |
|---|---|---|
| `ok` | páginas batem com o último build | nada |
| `pendente` | a spec mudou | **⚡ Build** |
| `divergente` | **alguém editou a página à mão** | **↻ Recompilar** (spec vence) ou **⬇ Reabsorver** (página vence) |
| `desatualizado` | o catálogo semântico mudou (hash novo) | revisar e **⚡ Build** |
| `quebrado` | a spec tem erro | abrir **Diagnósticos** |

> **Teste isso com a turma:** abra `panorama.md` no editor, escreva uma frase qualquer,
> salve e volte a Relatórios. O estado vira **divergente** — e o console exige uma decisão
> explícita. Nunca há sobrescrita silenciosa.

✅ **Como saber que deu certo:** em **Relatórios**, o cartão mostra **▦ Panorama da produção
científica · ok** e as três páginas existem na árvore.

---

## Módulo 12 — Filtros e parâmetros

**Objetivo:** entender as duas formas de recorte — e a pegadinha do editor.

### 12.1 Argumento de bloco (passo 3 do wizard)

No passo **Argumentos** você declara `{nome, tipo, origem, default}` e o console gera **o
input e o predicado**:

| Tipo | Componente gerado | Predicado no SQL |
|---|---|---|
| `enum` | `<Dropdown>` (com opção "Todos" = `%`) | `like '${inputs.x.value}'` |
| `texto` | `<TextInput>` | `like` |
| `número` | `<Slider>` | `>=` |
| `data` | `<DateRange>` | `between` |

Na spec do Módulo 11 isso virou o **`globalParams: ano`** — um filtro que vale para todos os
blocos da página.

### 12.2 A pegadinha do Notebook

Abra `panorama.md` em **Notebook** e clique em **▶▶ Rodar tudo**. Os indicadores saem
**vazios**. Por quê?

A barra **Filtros:** do notebook mostra `ano=` com uma **caixa de texto vazia** — ali o
editor não aplica o default do Dropdown. O SQL roda com `like ''` e não casa com nada.

**Solução:** digite `%` (ou um ano, como `2023`) na caixa e rode de novo. Agora sim:

| Indicador | Valor com `%` |
|---|---|
| Artigos | **1.313.043** |
| % de artigos com FWCI ≥ 1 | **25,8%** |
| % em periódico nacional | **51,2%** |
| % em acesso aberto | **83,8%** |

No modo **Dividido** isso não acontece: ali a página renderiza o `<Dropdown>` de verdade, já
com **Ano: Todos** selecionado. **Notebook é bancada de trabalho; Dividido é o produto.**

### 12.3 Página parametrizada

`ies/[ies].md` é uma página **por instituição**. O compilador gera, na primeira página
comum, um **índice de valores clicáveis** (os 384 nomes, com busca). No editor há um seletor
de valor no topo para você testar.

Abra a página, escolha `USP` e confira: **95.104** artigos. Troque para `UNICAMP`:
**31.517**.

✅ **Como saber que deu certo:** os quatro indicadores do panorama batem com a tabela acima, e
a página da instituição muda os números ao trocar o valor.

---

## Módulo 13 — Publicar

**Objetivo:** entregar o relatório para quem não tem o console.

O destino dos dois botões é a pasta configurada no projeto (`project.yaml → deploy.dir`),
com fallback para o Settings global — por padrão, `published/`.

### 13.1 📦 Publish (snapshot)

**HTML único, offline, dados embutidos.**

1. Abra `panorama.md` no editor.
2. Clique em **📦 Publish**.
3. Escolha a visibilidade **Pública**.

Sai um `published/treinamento/panorama.html` de ~2 MB que abre com duplo clique, sem servidor
e sem internet. As combinações do Dropdown já vêm pré-calculadas; inputs livres ficam
congelados no default, com dica na tela. O rodapé mostra *publicado em* e *dados
materializados em* — transparência de frescor.

**Ideal para:** anexo de e-mail, entrega para auditoria, arquivo de um número fechado.

### 13.2 ☁ Publish app (Universal SQL)

**`app.html` + DuckDB-WASM + `data/*.parquet`** — as queries rodam **no navegador**.

1. Abra `ies/[ies].md`.
2. Clique em **☁ Publish app**.

Sai a pasta `published/treinamento/ies-app/`. Filtros ficam vivos e a URL aceita `?ies=USP`.
Atualizar o painel amanhã = trocar o `.parquet`, sem republicar.

> **Precisa ser servido por HTTP** — os workers do WebAssembly não abrem por `file://`. Para
> testar na hora, use a pré-visualização do próprio console.

### 13.3 Qual usar

| Situação | Escolha |
|---|---|
| página sem filtro, entrega offline | **📦 snapshot** |
| filtros ao vivo, muitos dados | **☁ app** |
| **página parametrizada `[x].md`** | **☁ app** — o snapshot recusa, com mensagem explicando |
| dado atualizado por pipeline | **☁ app** apontando para mount/bucket |

### 13.4 O que o publish recusa (e ainda bem)

- **Scan ao vivo em banco externo** na página (`ATTACH`, `postgres_scan`) — erro nos dois
  modos. Banco externo entra materializado (Módulo 14).
- **Dimensão marcada como `pii` ou `expose: internal`** em publish **público** — erro, não
  omissão silenciosa. Publique como **interno** para painel autenticado.

✅ **Como saber que deu certo:** `published/treinamento/panorama.html` abre no navegador com
os gráficos, e `published/treinamento/ies-app/` contém `app.html` e uma pasta `data/`.

---

## Módulo 14 — Do CSV de volta ao banco

**Objetivo:** mostrar à turma o caminho de produção. O CSV foi didático; em produção o dado
vem do banco — **sem que a página nunca toque nele**.

### 14.1 A regra inviolável

> **Página nunca consulta banco externo em runtime.** O `ATTACH` vive só na extração, numa
> instância efêmera. Em página, é erro no lint e nos dois publishes.

Motivo: um relatório aberto por 50 pessoas não pode virar 50 conexões no banco de produção —
e um relatório publicado precisa continuar funcionando com o banco fora do ar.

### 14.2 Como seria com o `aderencia`

1. **Menu ⇌ Conexões** (nível global): **＋ Nova conexão** → tipo `postgres`, host, porta,
   database `aderencia`, usuário. **Sem senha neste formulário** — o cadastro vai para
   `connections.yaml`, que é versionável, e o validador **recusa** qualquer coisa parecida
   com segredo.
2. **🔑 Senha**: entra write-only, nunca é exibida de volta, nunca chega ao browser. Em
   produção, a variável de ambiente `STUDIO_SECRET_<NOME>` tem precedência sobre o arquivo.
3. **Testar conexão** antes de usar.
4. No projeto: **Dados › Fontes › ＋ Nova fonte** → tipo **View materializada (banco →
   parquet)** → escolha a conexão → cole o SQL de extração
   ([Apêndice A](#apêndice-a--o-sql-da-extração)) → **▶ Preview** (100 linhas, valida antes
   de extrair tudo) → nomeie a fonte.
5. A primeira materialização gera `sources/<nome>.parquet`. O botão **↻** re-extrai com
   **troca atômica**: um refresh interrompido nunca corrompe o parquet em uso.
6. Defina `stale_after: 7d` para a fonte ganhar o selo *possivelmente desatualizada* quando
   passar do prazo.

**O resto do tutorial não muda uma vírgula**: catálogo semântico, wizard, spec e publishes
funcionam igual — porque todos leem a **fonte**, não o banco.

✅ **Como saber que deu certo:** a turma consegue explicar por que o console materializa em
vez de consultar o Postgres na hora do clique.

---

## Módulo 15 — Exercícios

Faça no projeto `treinamento`. As respostas estão no
[Apêndice C](#apêndice-c--respostas-dos-exercícios).

1. **(Fonte)** Quantas linhas do arquivo pertencem a instituições da região Norte?
2. **(Wizard)** Monte um gráfico de barras de **Citações feitas por domínio**. Qual domínio
   lidera?
3. **(Semântica)** Acrescente ao catálogo a métrica `citacoes_por_artigo`
   (`citacoes / artigos`, formato `num2`). Salve e confira que o hash mudou. O que aconteceu
   com o estado do relatório?
4. **(Denominador)** Usando **% do total exibido** (`pct_artigos`) por região, some os
   percentuais. Dá 100%? Agora filtre o ano 2023 e some de novo. Explique.
5. **(Spec)** Acrescente à spec uma página `natureza.md` com uma tabela de **Artigos**,
   **% do total exibido** e **% com FWCI ≥ 1** por **Natureza jurídica**. Faça o Build.
6. **(Estados)** Edite `areas.md` à mão, salve, volte a Relatórios e resolva a divergência
   das duas formas — uma vez com **Recompilar**, outra com **Reabsorver**. Qual delas
   preserva o seu texto?
7. **(Publicação)** Por que `ies/[ies].md` não pode ser publicada como snapshot?

### Checklist de encerramento

- [ ] Consigo clonar, instalar e subir o console em uma máquina limpa.
- [ ] Sei a diferença entre **fonte**, **página**, **View Block**, **catálogo** e **spec**.
- [ ] Monto um gráfico pelo wizard sem escrever SQL.
- [ ] Declaro uma métrica derivada no catálogo e sei ler o hash de proveniência.
- [ ] Gero um relatório multipágina pela spec e sei resolver `divergente`.
- [ ] Escolho entre 📦 e ☁ com justificativa.
- [ ] Sei dizer, sobre a métrica `artigos`, qual é o denominador.

---

## Módulo bônus — pedir o relatório em português ao Claude Code

O repositório traz uma **skill** chamada `montar-relatorio`: ela ensina ao agente o dialeto
das páginas, os compiladores de `shared/`, as APIs da console e o roteiro de verificação —
para que ele monte a página pelo caminho certo em vez de improvisar Markdown e SQL.

```text
/montar-relatorio no projeto treinamento, crie a página ranking_ies.md com artigos,
% do total e % com FWCI ≥ 1 por instituição, filtro de ano, em tabela, usando o
catálogo producao
```

Passo a passo, pedidos prontos e o checklist de conferência estão no
[quickstart da skill](QUICKSTART_MONTAR_RELATORIO.md) — 20 minutos, de preferência **depois**
do Módulo 13. A ordem importa: quem pede sem entender o produto não sabe conferir o que
recebeu.

---

## Apêndice A — O SQL da extração

O CSV do treinamento foi produzido **agregando** o fato `tcc_fato_producao` do banco
`aderencia` (uma linha por instituição × artigo) para o grão (IES, ano, campo):

```sql
select instituicao                                                     as ies,
       uf, regiao, status_juridico,
       pub_year                                                        as ano,
       dominio, campo,
       count(distinct work_id)                                         as artigos,
       count(distinct case when fwci >= 1 then work_id end)            as artigos_fwci1,
       count(distinct case when origem = 'nacional' then work_id end)  as artigos_nacionais,
       count(distinct case when is_oa then work_id end)                as artigos_abertos,
       sum(n_citacoes)                                                 as citacoes,
       sum(n_citacoes_nacional)                                        as citacoes_nacionais
from tcc_fato_producao
where instituicao is not null and campo is not null
group by all
order by ies, ano, campo;
```

É exatamente esse texto que entraria no campo **query** de uma *view materializada*
(Módulo 14), com `ext.` na frente da tabela.

## Apêndice B — Colinha de comandos

```bash
git clone https://github.com/ProximaTI/studio-console.git
```

```bash
npm install
```

```bash
npm run dev
```

```bash
npx vitest run
```

Onde as coisas ficam em disco:

```
studio-console/
  projects/treinamento/
    pages/           panorama.md, areas.md, ies/[ies].md …
    sources/         producao_ies_2021_2025.csv
    semantic/        producao.yaml
    reports/         panorama_producao.md        ← a spec
    project.yaml     fontes e deploy (versionável, SEM segredos)
    .secrets.json    segredos do projeto (nunca versionado)
  published/treinamento/   panorama.html · ies-app/
  connections.yaml   conexões globais (sem senha)
```

## Apêndice C — Respostas dos exercícios

1. `select count(*) from producao_ies_2021_2025 where regiao = 'Norte';` → **2.858** linhas.
2. **Physical Sciences** lidera as citações feitas (10,8 mi), seguido de Health Sciences
   (8,1 mi). Cobre o achado interessante: **Social Sciences tem o maior número de artigos**
   (431.153) e o **menor** volume de citações feitas (3,8 mi) — listas de referência são
   mais curtas nas humanidades. Volume de consumo não é qualidade; é hábito disciplinar.
3. O hash do modelo muda; o relatório passa a **desatualizado** e um **⚡ Build** resolve. É
   o lineage barato do console: mexeu no catálogo, os produtos acusam.
4. Sem filtro soma 100%; com 2023 também — `total(m)` é uma janela sobre o conjunto
   **filtrado**. Para percentual sobre o universo inteiro, use `total(m, scope: all)`.
5. Bloco novo em `pages:` com `metrics: [artigos, pct_artigos, pct_fwci1]`,
   `dims: [{ dim: natureza }]`, `style: tabular`.
6. **Reabsorver** (a página vence e o conteúdo volta para a spec). **Recompilar** faz a spec
   vencer e descarta a edição manual. Prosa escrita à mão só entra na spec com confirmação
   explícita.
7. Porque o snapshot pré-computa os dados em tempo de build e não há como resolver `?ies=`
   na URL de um HTML estático — o console recusa com essa mensagem e indica o ☁.

---

## Roteiro do instrutor (3 horas)

| Tempo | Bloco | Módulos |
|---|---|---|
| 0:00–0:35 | Ambiente: clone, install, `npm run dev`, passeio no `exemplo` | 1–4 |
| 0:35–1:00 | Os dados: dicionário, grão, as três armadilhas + SQL Console | 5–7 |
| 1:00–1:35 | Primeiro gráfico e anatomia do View Block | 8–9 |
| 1:35–1:45 | *Intervalo* | |
| 1:45–2:15 | Catálogo semântico: por que existe, como se declara | 10 |
| 2:15–2:45 | Spec, Build, estados e publicação | 11–13 |
| 2:45–3:00 | Caminho de produção + exercícios dirigidos | 14–15 |

**Prepare antes da aula:** repositório clonado e `npm install` já rodado nas máquinas (o
download é o maior risco de atraso), o CSV copiado para a Área de Trabalho de cada aluno e o
projeto `exemplo` funcionando.

**Erros que a turma vai cometer (e são ótimos):** rodar `npm install` na pasta errada;
esperar os indicadores aparecerem no Notebook sem preencher o filtro; editar o SQL dentro do
View Block; e somar `artigos` chamando o resultado de "artigos do Brasil". Cada um deles é um
módulo deste tutorial se pagando.
