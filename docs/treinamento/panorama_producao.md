# Panorama da produção científica

Spec do relatório do treinamento. A narrativa é livre; o contrato está no bloco
`studio-report`. **⚡ Build** recompila as páginas — SQL e Markdown saem do
compilador, nunca da mão.

Leitura das páginas:

- **Panorama** abre com os números do recorte, a evolução por ano, o mapa por UF
  e o volume por região.
- **Áreas** compara domínios e campos do conhecimento.
- **Instituição** é uma página parametrizada: uma página por IES, com índice de
  valores clicáveis montado pelo compilador.

`Artigos` conta vínculos IES–artigo (coautoria entre duas IES conta nas duas).

```studio-report
name: panorama_producao
version: 1
title: Panorama da produção científica
purpose: Volume, impacto e perfil de publicação das IES brasileiras entre 2021 e 2025.
audience: Equipe de avaliação e gestores de pesquisa
visibility: public
catalog: producao
globalParams:
  - name: ano
    type: enum
    from: ano
    default: "%"
    label: Ano
pages:
  - path: panorama.md
    title: Panorama
    purpose: Números gerais do recorte selecionado.
    prose: |
      Use o seletor de **Ano** no topo: ele vale para todos os blocos da página.
    blocks:
      - id: kpis
        title: Números do recorte
        metrics: [artigos, pct_fwci1, pct_nacional, pct_oa]
        dims: []
        filters: []
        style: freeform
      - id: evolucao
        title: Artigos por ano
        metrics: [artigos]
        dims: [{ dim: ano }]
        filters: []
        style: graph.line
      - id: mapa
        title: Artigos por UF
        metrics: [artigos]
        dims: [{ dim: uf }]
        filters: []
        style: areamap
      - id: por_regiao
        title: Artigos por região
        metrics: [artigos]
        dims: [{ dim: regiao }]
        filters: []
        style: graph.bar
      - id: por_natureza
        title: Perfil por natureza jurídica
        metrics: [artigos, pct_artigos, pct_fwci1, pct_nacional]
        dims: [{ dim: natureza }]
        filters: []
        style: tabular
  - path: areas.md
    title: Áreas
    purpose: Onde a produção se concentra.
    prose: |
      Os rótulos de domínio e campo vêm do OpenAlex e estão em inglês.
    blocks:
      - id: dominios
        title: Artigos por domínio
        metrics: [artigos]
        dims: [{ dim: dominio }]
        filters: []
        style: graph.bar
      - id: campos
        title: Campos do conhecimento
        metrics: [artigos, pct_artigos, pct_fwci1, citacoes]
        dims: [{ dim: campo }]
        filters: []
        style: tabular
  - path: "[ies].md"
    title: Instituição
    purpose: Perfil de uma instituição.
    parameter: { name: ies, dimension: ies }
    blocks:
      - id: ies_kpis
        title: Números da instituição
        metrics: [artigos, pct_fwci1, pct_nacional, pct_oa]
        dims: []
        filters: []
        style: freeform
      - id: ies_campos
        title: Produção por campo
        metrics: [artigos, pct_artigos, pct_fwci1]
        dims: [{ dim: campo }]
        filters: []
        style: tabular
warnings: []
```
