# Painel da rede

Este arquivo é a **spec** do relatório: a narrativa acima e ao redor é sua, livre;
o contrato vive no bloco `studio-report` abaixo. O botão **⚡ Build** recompila as
páginas a partir dele — o SQL e o Markdown saem do compilador, nunca da mão.

Como ler o painel:

- **Painel da rede** abre com os KPIs do recorte, o mapa por UF e a evolução mensal.
  O seletor de **Ano** no topo é um parâmetro global: vale para todos os blocos da
  página.
- **Por unidade** é uma página parametrizada — uma página por unidade da rede,
  gerada a partir da mesma spec. O índice de valores clicáveis é montado pelo
  compilador na página comum.

Se o catálogo `comissoes` mudar (métrica nova, dimensão renomeada), o relatório
aparece como **desatualizado** na lista de Relatórios e um build resolve.

```studio-report
name: painel_da_rede
version: 1
title: Painel da rede
purpose: Acompanhamento executivo da rede de salões — faturamento, comissões e desempenho por unidade.
audience: Sócios e gerentes das unidades
visibility: public
catalog: comissoes
globalParams:
  - name: ano
    type: enum
    from: tempo.ano
    default: "%"
    label: Ano
pages:
  - path: painel_rede.md
    title: Painel da rede
    purpose: Visão executiva do período.
    prose: |
      Números da rede no recorte selecionado. Para as páginas escritas à mão,
      volte para a [visão geral](/).

      O gráfico de posições lê os anos lado a lado — é a pergunta "quem trocou
      de lugar", que a série de faturamento não responde: uma unidade pode
      crescer e ainda assim cair no ranking. Ele mostra as unidades que
      estiveram entre as 5 primeiras em ALGUM ano, com a trajetória inteira de
      cada uma, inclusive quando saíram do topo. Selecionar um ano único no
      seletor acima reduz o gráfico a um instante — nesse caso ele não tem o que
      comparar.
    blocks:
      - id: kpis
        title: Números do período
        metrics: [faturamento, comissoes, atendimentos, ticket_medio]
        dims: []
        filters: []
        style: freeform
      - id: mapa_uf
        title: Faturamento por UF
        metrics: [faturamento]
        dims: [{ dim: uf }]
        filters: []
        style: areamap
      - id: evolucao
        title: Evolução mensal
        metrics: [faturamento]
        dims: [{ dim: tempo, level: mes }]
        filters: []
        style: graph.line
      - id: ranking
        title: Faturamento por unidade
        metrics: [faturamento]
        dims: [{ dim: unidade }]
        filters: []
        style: graph.bar
      - id: ranking_tempo
        title: Quem subiu e quem caiu no ranking
        metrics: [posicao_unidade]
        dims: [{ dim: tempo, level: ano }, { dim: unidade }]
        filters: []
        style: graph.bump
        bump:
          top: 5
      - id: servicos
        title: Desempenho por serviço
        metrics: [atendimentos, faturamento, ticket_medio, pct_faturamento]
        dims: [{ dim: servico }]
        filters: []
        style: tabular
  - path: equipe.md
    title: Equipe e perfil de consumo
    purpose: Quem atende e como o cliente paga.
    prose: |
      Duas visões saem de dimensões CALCULADAS do catálogo: a faixa de ticket vem
      de `bins` (bordas declaradas) e o prazo de pagamento vem de `map` (valor →
      rótulo) — nenhum CASE escrito à mão.

      Compare as duas logo abaixo. A faixa declarada responde "quantos por
      categoria que eu escolhi"; o histograma responde "que forma isso tem" — as
      bordas são calculadas sobre os dados do recorte, com a cauda aparada no p99
      para que um valor extremo não esmague o corpo da distribuição. O que passa
      do p99 não é descartado: entra na última faixa, que aparece aberta (`+`).
    blocks:
      - id: eq_profissional
        title: Comissões por profissional
        metrics: [comissoes, atendimentos, ticket_medio]
        dims: [{ dim: profissional }]
        filters: []
        style: tabular
      - id: eq_regiao_servico
        title: Região × serviço
        metrics: [faturamento]
        dims: [{ dim: regiao }, { dim: servico }]
        filters: []
        style: group
      - id: eq_faixa
        title: Atendimentos por faixa de ticket
        metrics: [atendimentos]
        dims: [{ dim: faixa_ticket }]
        filters: []
        style: graph.bar
      - id: eq_forma_dist
        title: Onde o ticket realmente se concentra
        metrics: [faturamento]
        dims: []
        filters: []
        style: graph.histogram
        distribution:
          bins: 24
      - id: eq_prazo
        title: Faturamento por prazo de pagamento
        metrics: [faturamento]
        dims: [{ dim: prazo_pagamento }]
        filters: []
        style: graph.bar
      - id: eq_faixa_ticket
        title: Onde o ticket realmente cai, por unidade
        metrics: [ticket_p25, ticket_mediana, ticket_p75]
        dims: [{ dim: unidade }]
        filters: []
        style: graph.range
      - id: eq_multiplos
        title: Mix de serviços, região a região
        metrics: [faturamento]
        dims: [{ dim: regiao }, { dim: servico }]
        filters: []
        style: nested
        nested:
          parent: [regiao]
          child: [servico]
          childStyle: graph.bar
          limitPerGroup: 6
          maxGroups: 12
  - path: "[unidade].md"
    title: Por unidade
    purpose: Recorte de uma unidade da rede.
    parameter:
      name: unidade
      dimension: unidade
    prose: |
      Desempenho da unidade no recorte. Volte para o [painel da rede](/painel_rede/).
    blocks:
      - id: un_kpis
        title: Números da unidade
        metrics: [faturamento, comissoes, atendimentos, ticket_medio]
        dims: []
        filters: []
        style: freeform
      - id: un_servico
        title: Faturamento por serviço
        metrics: [faturamento]
        dims: [{ dim: servico }]
        filters: []
        style: graph.bar
      - id: un_equipe
        title: Equipe da unidade
        metrics: [comissoes, atendimentos]
        dims: [{ dim: profissional }]
        filters: []
        style: tabular
warnings: []
```
