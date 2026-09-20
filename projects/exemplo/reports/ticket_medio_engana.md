# O ticket médio não é o ticket de ninguém

Este relatório foi montado com a skill `montar-historia`: uma frase, e só os blocos
que a sustentam. A frase é esta —

> **O ticket médio da rede, R$ 125,38, descreve 169 dos 1.338 atendimentos (12,6%).
> Ele fica R$ 45 acima do pico da distribuição e logo antes do vale — não é o preço
> de serviço nenhum.**

O que cada bloco faz: o primeiro estabelece a base e o denominador; o segundo mostra
a forma da distribuição, que é onde o vale aparece; o terceiro explica o vale — cada
serviço tem sua própria faixa de preço, e elas quase não se tocam. A segunda página
verifica se o vale é real ou artefato de somar nove unidades diferentes.

```studio-report
name: ticket_medio_engana
version: 1
title: O ticket médio não é o ticket de ninguém
purpose: Decidir se a meta de ticket deve ser única para a rede ou uma por serviço.
audience: Sócios e gerentes das unidades
visibility: public
catalog: comissoes
globalParams: []
pages:
  - path: ticket_medio.md
    title: O ticket médio não é o ticket de ninguém
    purpose: A média da rede e a distribuição que ela resume.
    prose: |
      **Observado.** Em 1.338 atendimentos, o valor médio é R$ 125,38 e o mediano é
      R$ 96,63 — a média fica 30% acima da mediana. Apenas 169 atendimentos (12,6% do
      total) caem a menos de 10% de distância da média.

      A distribuição tem duas regiões povoadas e um vazio entre elas. O pico está entre
      R$ 60 e R$ 80, com 307 atendimentos; a partir daí a contagem cai, e a faixa da
      média (R$ 120 a R$ 140) já tem 111. Entre R$ 140 e R$ 200 há 88 atendimentos
      somando três faixas — menos do que a faixa única anterior. Acima de R$ 200 a
      contagem volta a subir e se mantém até R$ 340, somando 227 atendimentos.

      **Hipótese.** As duas regiões correspondem a dois conjuntos de serviços com preços
      que não se sobrepõem: Barba, Manicure, Escova e Corte têm medianas entre R$ 62 e
      R$ 104; Hidratação e Coloração, R$ 167 e R$ 278. A média da rede cai na descida
      entre os dois conjuntos, pouco antes do vazio.

      **Implicação.** Uma meta única de ticket para a rede mira um valor que nenhum
      serviço pratica. A decisão que este relatório informa é substituir a meta única
      por uma meta por serviço — ou por uma meta de **mix**, que é o que realmente
      move o ticket da unidade.
    blocks:
      - id: base
        title: 1.338 atendimentos, e uma média 30% acima da mediana
        metrics: [atendimentos, faturamento, ticket_medio, ticket_mediana]
        dims: []
        filters: []
        style: freeform
      - id: forma
        title: O pico está em R$ 60–80; a média, R$ 45 acima dele
        metrics: [ticket_medio]
        dims: []
        filters: []
        style: graph.histogram
        distribution:
          bins: 24
      - id: por_servico
        title: Cada serviço tem sua faixa, e elas quase não se tocam
        metrics: [ticket_p25, ticket_mediana, ticket_p75]
        dims: [{ dim: servico }]
        filters: []
        style: graph.range
  - path: nao_e_artefato.md
    title: O vale não vem de misturar unidades
    purpose: Verificar se a dispersão existe dentro de cada unidade.
    prose: |
      **Observado.** O primeiro quartil das nove unidades é quase idêntico: entre R$ 69 e
      R$ 75. O terceiro varia mais, de R$ 125 a R$ 161 — cinco das nove entram na faixa
      vazia de R$ 140 a R$ 200, e **nenhuma a atravessa**. Em unidade nenhuma o meio do
      ticket alcança a segunda região, acima de R$ 200.

      **Implicação.** O vale não é efeito de somar unidades com perfis diferentes: ele
      existe dentro de cada uma. E a segunda região não é especialidade de ninguém — é
      cauda em todas, porque todas vendem os mesmos seis serviços. Portanto a meta por
      serviço vale para a rede inteira, não só no agregado.
    blocks:
      - id: faixa_unidade
        title: O meio do ticket não alcança a segunda região em unidade nenhuma
        metrics: [ticket_p25, ticket_mediana, ticket_p75]
        dims: [{ dim: unidade }]
        filters: []
        style: graph.range
        # O par vira faixa sombreada. Os dois números não são escolha de
        # apresentação: saem da contagem da página anterior — 88 atendimentos
        # somando três faixas de R$20 entre 140 e 200, contra 111 na faixa única
        # imediatamente anterior. A prosa afirmava isso; agora o gráfico mostra.
        reference:
          - { axis: y, value: [140, 200], label: "o vazio — 5 das 9 entram, nenhuma atravessa" }
      - id: mix
        title: O mix de serviços é parecido entre as unidades
        metrics: [pct_faturamento]
        dims: [{ dim: unidade }, { dim: servico }]
        filters: []
        style: group
warnings:
  - "2026 cobre apenas 1/jan a 31/mar (160 atendimentos, contra 553 em 2024 e 625 em 2025). Nenhuma comparação ano a ano é feita aqui por causa disso."
  - "O catálogo não tem custo nem tempo de cadeira: nada neste relatório diz respeito a margem ou a produtividade, só a receita por atendimento."
  - "Dados sintéticos do projeto de exemplo. As faixas de preço por serviço são estreitas por construção do gerador, o que torna o vale mais nítido do que seria numa rede real."
  - "Não há meta declarada na fonte. A afirmação de que a média 'não é meta de ninguém' é sobre o que os serviços praticam, não sobre o que a rede definiu."
```
