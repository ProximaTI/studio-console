# Studio Console em 5 minutos — do objetivo ao relatório

Este é o guia curto: escolha o cenário, siga os cliques e valide o resultado. Para conceitos, estados e anatomia completa da spec, consulte o [guia detalhado](GUIA_RELATORIOS.md).

## Escolha seu caminho

| Se você quer... | Use... | Resultado |
|---|---|---|
| Uma tabela ou gráfico rapidamente | **Montar bloco a bloco** | Uma página editável no Notebook |
| Uma página executiva completa | **Descrever relatório completo** | Spec + página gerada |
| Um relatório com várias páginas | **Descrever relatório completo** | Uma spec composite + navegação |
| Organizar páginas que já existem | **Promover páginas existentes** | Uma spec passa a governar as páginas |

> Regra simples: **a spec descreve o produto; as páginas são o build executável**.

---

## Fluxo A — uma página simples

### 1. Abra o projeto

Na Home, abra o projeto que contém seus dados. Dentro dele, entre em **Relatórios**.

![Lista de relatórios do projeto](docs/img/guia-relatorios-lista.png)

Clique em **+ Novo relatório (✨ descrever)** e escolha uma das portas:

![Escolha entre relatório completo e bloco a bloco](docs/img/guia-portas.png)

- Para uma página pronta, escolha **Descrever relatório completo**.
- Para controlar fonte, campos e gráfico manualmente, escolha **Montar bloco a bloco**.

### 2. Diga o que precisa

Use uma frase com quatro elementos: **objetivo + indicadores + recorte + interação**.

Exemplo:

> Mostre uma visão executiva da rede com quantidade de atendimentos, faturamento, distribuição por unidade e filtro por ano.

![Objetivo, público e visibilidade do relatório](docs/img/guia-objetivo.png)

Escolha o público e a visibilidade e clique em **✨ Propor plano**.

### 3. Revise antes de gerar

Confirme:

- as métricas respondem à pergunta;
- as dimensões representam o recorte;
- o gráfico combina com os dados;
- filtros e visibilidade estão corretos.

O agente propõe o plano. O compilador gera SQL e Markdown a partir do catálogo semântico.

### 4. Gere e confira

Clique em **Gerar**. Na tela do relatório, revise a aba **Especificação** e execute **Build** quando alterar o contrato.

![Spec, Build e Reabsorver](docs/img/guia-spec.png)

Abra a página no editor para conferir dados, filtros e apresentação:

![Página gerada no editor Notebook](docs/img/guia-editor.png)

### Checklist rápido

- [ ] Valores conferem com a fonte.
- [ ] Filtros alteram os resultados.
- [ ] Títulos explicam o que está sendo medido.
- [ ] **Diagnósticos** não mostra erro.
- [ ] Snapshot ou Publish App abre corretamente.

---

## Fluxo B — relatório composite

Use composite quando o leitor precisa navegar entre assuntos ou níveis de detalhe.

### 1. Descreva as páginas, não apenas os gráficos

Exemplo:

> Crie um relatório da rede com: visão geral contendo KPIs e evolução anual; distribuição por serviço; mapa por UF; e uma página parametrizada por unidade com os atendimentos correspondentes.

Uma boa descrição informa:

- a função de cada página;
- a ordem de navegação;
- quais filtros são globais;
- qual dimensão cria o drill-down;
- quais páginas são parametrizadas.

### 2. Confira a arquitetura

Depois de gerar, abra a aba **Estrutura**. Ela é a visão mais rápida do composite:

![Estrutura hierárquica das páginas e blocos](docs/img/guia-estrutura.png)

Procure uma árvore coerente, por exemplo:

```text
Painel da rede
├── Visão geral
├── Serviços
├── Distribuição por UF
└── Unidade
    └── [unidade].md
```

### 3. Controle o ciclo de vida das páginas

Na aba **Páginas**, use a ação correspondente ao estado do arquivo:

![Estados e ações das páginas geradas](docs/img/guia-paginas.png)

| Situação | Ação |
|---|---|
| A spec mudou | **Recompilar** ou **Build** |
| A página foi ajustada pelo wizard | **Reabsorver** |
| Quer inspecionar o resultado | **Abrir no editor** |
| O catálogo mudou | Revisar a spec e executar **Build** |

### 4. Teste a navegação

Antes de publicar, percorra:

1. página inicial;
2. links entre páginas;
3. índice da página parametrizada;
4. pelo menos dois valores do parâmetro;
5. retorno à visão geral.

Para páginas parametrizadas, use **Publish App**.

---

## Fluxo C — promover páginas existentes

Use este caminho quando você já criou páginas com View Blocks semânticos.

1. Entre em **Relatórios**.
2. Clique em **Promover páginas existentes**.
3. Dê um nome ao relatório.
4. Informe os caminhos separados por vírgula.

Exemplo:

```text
painel_rede.md, equipe.md, unidade/[unidade].md
```

Depois da promoção:

- revise **Estrutura**;
- confirme a propriedade das páginas;
- ajuste narrativa e ordem na **Especificação**;
- execute **Build**;
- confira **Diagnósticos**.

---

## Como escrever um bom pedido ao agente

Copie este molde e substitua os colchetes:

> Crie um relatório para **[público]** acompanhar **[objetivo]**. Mostre **[métricas]** por **[dimensões]**. Inclua **[páginas]**, filtros por **[campos]** e drill-down de **[nível superior]** para **[nível inferior]**. A visibilidade é **[pública/interna]**.

Exemplo complexo:

> Crie um relatório para gestores acompanharem o desempenho da rede. Mostre atendimentos, faturamento e ticket médio por região, UF, unidade e serviço. Inclua visão executiva, mapa por UF, ranking de unidades e detalhe parametrizado por unidade. Use filtro global de ano e permita drill-down Região → UF → Unidade. A visibilidade é interna.

## Quando parar e revisar

Não gere ainda se:

- uma métrica está ambígua;
- o catálogo não contém a dimensão pedida;
- o relacionamento entre tabelas não foi confirmado;
- uma dimensão interna foi usada em relatório público;
- a árvore de páginas não corresponde à jornada do leitor.

## Publicação em uma linha

- **Snapshot:** entrega estática/offline de página não parametrizada.
- **Publish App:** filtros, SQL no navegador, Parquet e páginas parametrizadas.

Para detalhes sobre YAML, estados, View Blocks e regras de sincronização, volte ao [guia completo de relatórios](GUIA_RELATORIOS.md).
