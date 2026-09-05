# Painel da rede

**Páginas:** [Painel da rede](/painel_rede/) · [Equipe e perfil de consumo](/equipe/)

Visão executiva do período.

Números da rede no recorte selecionado. Para as páginas escritas à mão,
volte para a [visão geral](/).

## Números do período

<!-- viewblock v1 {"v":1,"id":"vb_kpis","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_kpis","sql":null}],"dims":[],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"},{"name":"comissoes","alias":"comissoes","label":"Comissões","fmt":"brl"},{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"},{"name":"ticket_medio","alias":"ticket_medio","label":"Ticket médio","fmt":"brl"}],"filters":[],"limit":1000,"params":[{"name":"ano","type":"enum","from":"tempo.ano","default":"%","label":"Ano"}],"style":"freeform","children":[]} -->

```sql vb_kpis_ano_opts
select distinct cast(year(cast("data" as date)) as varchar) as value
from "comissoes"
where year(cast("data" as date)) is not null
order by 1
```

<Dropdown name=ano data={vb_kpis_ano_opts} value=value title="Ano"><DropdownOption value="%" valueLabel="Todos"/></Dropdown>

```sql vb_kpis
-- semantic: comissoes@b1e6c89e
with base as (
  select count(distinct "atendimento_id") as "atendimentos", sum("valor") as "faturamento", sum("comissao") as "comissoes", avg("valor") as "ticket_medio"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
)
select "faturamento", "comissoes", "atendimentos", "ticket_medio"
from base
order by "faturamento" desc
limit 1000
```

<BigValue data={vb_kpis} value=faturamento title="Faturamento" fmt=brl/>
<BigValue data={vb_kpis} value=comissoes title="Comissões" fmt=brl/>
<BigValue data={vb_kpis} value=atendimentos title="Atendimentos" fmt=num0/>
<BigValue data={vb_kpis} value=ticket_medio title="Ticket médio" fmt=brl/>

<!-- /viewblock -->

## Faturamento por UF

<!-- viewblock v1 {"v":1,"id":"vb_mapa_uf","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_mapa_uf","sql":null}],"dims":[{"dim":"uf","alias":"uf","column":"uf","table":"comissoes"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"areamap","children":[]} -->

```sql vb_mapa_uf
-- semantic: comissoes@b1e6c89e
with base as (
  select "uf", sum("valor") as "faturamento"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "uf", "faturamento"
from base
order by "faturamento" desc
limit 1000
```

<AreaMap data={vb_mapa_uf} areaCol=uf value=faturamento geoId=sigla/>

<!-- /viewblock -->

## Evolução mensal

<!-- viewblock v1 {"v":1,"id":"vb_evolucao","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_evolucao","sql":null}],"dims":[{"dim":"tempo","level":"mes","alias":"mes","column":"mes","table":"comissoes"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.line","children":[]} -->

```sql vb_evolucao
select * from (
  -- semantic: comissoes@b1e6c89e
  with base as (
    select month(cast("data" as date)) as "mes", sum("valor") as "faturamento"
    from "comissoes"
    where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
    group by 1
  )
  select "mes", "faturamento"
  from base
  order by "faturamento" desc
  limit 1000
) t
order by "mes"
```

<LineChart data={vb_evolucao} x=mes y=faturamento/>

<!-- /viewblock -->

## Faturamento por unidade

<!-- viewblock v1 {"v":1,"id":"vb_ranking","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_ranking","sql":null}],"dims":[{"dim":"unidade","alias":"unidade","column":"unidade","table":"comissoes"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.bar","children":[]} -->

```sql vb_ranking
-- semantic: comissoes@b1e6c89e
with base as (
  select "unidade", sum("valor") as "faturamento"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "unidade", "faturamento"
from base
order by "faturamento" desc
limit 1000
```

<BarChart data={vb_ranking} x=unidade y=faturamento/>

<!-- /viewblock -->

## Desempenho por serviço

<!-- viewblock v1 {"v":1,"id":"vb_servicos","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_servicos","sql":null}],"dims":[{"dim":"servico","alias":"servico","column":"servico","table":"comissoes"}],"metrics":[{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"},{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"},{"name":"ticket_medio","alias":"ticket_medio","label":"Ticket médio","fmt":"brl"},{"name":"pct_faturamento","alias":"pct_faturamento","label":"% do total","fmt":"pct1"}],"filters":[],"limit":1000,"params":[],"style":"tabular","children":[]} -->

```sql vb_servicos
-- semantic: comissoes@b1e6c89e
with base as (
  select "servico", count(distinct "atendimento_id") as "atendimentos", sum("valor") as "faturamento", avg("valor") as "ticket_medio"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "servico", "atendimentos", "faturamento", "ticket_medio", "faturamento" / sum("faturamento") over () as "pct_faturamento"
from base
order by "atendimentos" desc
limit 1000
```

<DataTable data={vb_servicos}>
  <Column id=servico/>
  <Column id=atendimentos title="Atendimentos" fmt=num0/>
  <Column id=faturamento title="Faturamento" fmt=brl/>
  <Column id=ticket_medio title="Ticket médio" fmt=brl/>
  <Column id=pct_faturamento title="% do total" fmt=pct1/>
</DataTable>

<!-- /viewblock -->

## Por unidade

```sql nav_unidade
select distinct cast("unidade" as varchar) as unidade, '/unidade/' || cast("unidade" as varchar) || '/' as link
from "comissoes"
where "unidade" is not null
order by 1
```

<DataTable data={nav_unidade} link=link><Column id=unidade title="Por unidade"/></DataTable>
