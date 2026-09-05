# Mapas e redes

Componentes geográficos e de rede, sobre um segundo conjunto de dados do projeto
(colaboração científica) — as fontes `colab_paises` e `colab_ies_br`.

**Páginas:** [Visão geral](/) · [Faturamento](/faturamento/) · [Comissões](/comissoes/) · [Atendimentos](/atendimentos/) · [Mapas](/mapas/) · [Profissionais](/prof/)

## Mundo — colaboração internacional (país ↔ país)

A largura do arco é proporcional ao volume de artigos; o tamanho do ponto, à colaboração total.

```sql colab_paises
select pais_a, lat_a, lon_a, pais_b, lat_b, lon_b, artigos from colab_paises
```

<ConnectionMap map=world data={colab_paises} fromName=pais_a fromLat=lat_a fromLon=lon_a toName=pais_b toLat=lat_b toLon=lon_b weight=artigos title="Colaboração internacional"/>

## Brasil — colaboração entre instituições (IES ↔ IES)

```sql colab_ies
select ies_a, lat_a, lon_a, ies_b, lat_b, lon_b, projetos from colab_ies_br
```

<ConnectionMap map=brazil data={colab_ies} fromName=ies_a fromLat=lat_a fromLon=lon_a toName=ies_b toLat=lat_b toLon=lon_b weight=projetos title="Colaboração entre IES (Brasil)"/>

## A mesma rede sem geografia

O `CollaborationGraph` desenha as duas pontas como grafo (força dirigida): duas
queries — nós e arestas.

```sql rede_nodes
select distinct ies_a as id, ies_a as label from colab_ies_br
union
select distinct ies_b as id, ies_b as label from colab_ies_br
```

```sql rede_edges
select ies_a as source_id, ies_b as target_id, ies_b as target_name, projetos as weight
from colab_ies_br
```

<CollaborationGraph nodes=rede_nodes edges=rede_edges nodeId=id nodeLabel=label edgeWeight=weight layout="force-directed"/>
