# Faturamento

Onde o dinheiro entra: geografia, forma de pagamento e serviço.

**Páginas:** [Visão geral](/) · [Faturamento](/faturamento/) · [Comissões](/comissoes/) · [Atendimentos](/atendimentos/) · [Mapas](/mapas/) · [Profissionais](/prof/)

## Mapa por UF

```sql por_uf
select uf, sum(valor) as faturamento, count(*) as atendimentos
from comissoes
group by 1
order by 2 desc
```

O `colorPalette` controla o degradê e `showLabels` imprime o valor dentro de cada
área — o DF, pequeno demais para caber o rótulo, recebe o número fora com linha-guia.
Métrica de rótulo curto (contagem) para os números não colidirem entre UFs vizinhas.

<AreaMap
    data={por_uf}
    areaCol=uf
    value=atendimentos
    geoId=sigla
    title="Atendimentos por UF"
    height=520
    colorPalette={['#e8f0f8','#9dc2e0','#5b95c6','#236aa4']}
    showLabels=true
/>

<DataTable data={por_uf}>
  <Column id=uf title="UF"/>
  <Column id=atendimentos title="Atendimentos" fmt='#,##0'/>
  <Column id=faturamento title="Faturamento" fmt=brl/>
</DataTable>

## Por região

```sql por_regiao
select regiao, sum(valor) as faturamento, count(*) as atendimentos
from comissoes
group by 1
order by 2 desc
```

<BarChart data={por_regiao} x=regiao y=faturamento title="Faturamento por região" swapXY=true/>

## Forma de pagamento

```sql por_pagamento
select forma_pagamento, sum(valor) as faturamento, count(*) as atendimentos, avg(valor) as ticket_medio
from comissoes
group by 1
order by 2 desc
```

<BarChart data={por_pagamento} x=forma_pagamento y=faturamento title="Faturamento por forma de pagamento"/>

<DataTable data={por_pagamento}>
  <Column id=forma_pagamento title="Forma de pagamento"/>
  <Column id=atendimentos title="Atendimentos" fmt='#,##0'/>
  <Column id=faturamento title="Faturamento" fmt=brl/>
  <Column id=ticket_medio title="Ticket médio" fmt=brl/>
</DataTable>

## Serviço × ano

```sql fat_servico_ano
select servico, cast(year(data::date) as varchar) as ano, sum(valor) as faturamento
from comissoes
group by 1, 2
order by 1, 2
```

<BarChart data={fat_servico_ano} x=servico y=faturamento series=ano title="Faturamento por serviço e ano"/>
