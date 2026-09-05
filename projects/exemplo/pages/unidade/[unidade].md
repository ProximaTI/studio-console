# Por unidade — {params.unidade}

**Páginas:** [Painel da rede](/painel_rede/) · [Equipe e perfil de consumo](/equipe/)

Recorte de uma unidade da rede.

Desempenho da unidade no recorte. Volte para o [painel da rede](/painel_rede/).

## Números da unidade

<!-- viewblock v1 {"v":1,"id":"vb_un_kpis","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_un_kpis","sql":null}],"dims":[],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"},{"name":"comissoes","alias":"comissoes","label":"Comissões","fmt":"brl"},{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"},{"name":"ticket_medio","alias":"ticket_medio","label":"Ticket médio","fmt":"brl"}],"filters":[{"dim":"unidade","values":["${params.unidade}"]}],"limit":1000,"params":[{"name":"ano","type":"enum","from":"tempo.ano","default":"%","label":"Ano"}],"style":"freeform","children":[]} -->

```sql vb_un_kpis_ano_opts
select distinct cast(year(cast("data" as date)) as varchar) as value
from "comissoes"
where year(cast("data" as date)) is not null
order by 1
```

<Dropdown name=ano data={vb_un_kpis_ano_opts} value=value title="Ano"><DropdownOption value="%" valueLabel="Todos"/></Dropdown>

```sql vb_un_kpis
-- semantic: comissoes@b1e6c89e
with base as (
  select count(distinct "atendimento_id") as "atendimentos", sum("valor") as "faturamento", sum("comissao") as "comissoes", avg("valor") as "ticket_medio"
  from "comissoes"
  where "unidade" = '${params.unidade}'
  and cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
)
select "faturamento", "comissoes", "atendimentos", "ticket_medio"
from base
order by "faturamento" desc
limit 1000
```

<BigValue data={vb_un_kpis} value=faturamento title="Faturamento" fmt=brl/>
<BigValue data={vb_un_kpis} value=comissoes title="Comissões" fmt=brl/>
<BigValue data={vb_un_kpis} value=atendimentos title="Atendimentos" fmt=num0/>
<BigValue data={vb_un_kpis} value=ticket_medio title="Ticket médio" fmt=brl/>

<!-- /viewblock -->

## Faturamento por serviço

<!-- viewblock v1 {"v":1,"id":"vb_un_servico","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_un_servico","sql":null}],"dims":[{"dim":"servico","alias":"servico","column":"servico","table":"comissoes"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[{"dim":"unidade","values":["${params.unidade}"]}],"limit":1000,"params":[],"style":"graph.bar","children":[]} -->

```sql vb_un_servico
-- semantic: comissoes@b1e6c89e
with base as (
  select "servico", sum("valor") as "faturamento"
  from "comissoes"
  where "unidade" = '${params.unidade}'
  and cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "servico", "faturamento"
from base
order by "faturamento" desc
limit 1000
```

<BarChart data={vb_un_servico} x=servico y=faturamento/>

<!-- /viewblock -->

## Equipe da unidade

<!-- viewblock v1 {"v":1,"id":"vb_un_equipe","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_un_equipe","sql":null}],"dims":[{"dim":"profissional","alias":"profissional","column":"profissional","table":"comissoes"}],"metrics":[{"name":"comissoes","alias":"comissoes","label":"Comissões","fmt":"brl"},{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"}],"filters":[{"dim":"unidade","values":["${params.unidade}"]}],"limit":1000,"params":[],"style":"tabular","children":[]} -->

```sql vb_un_equipe
-- semantic: comissoes@b1e6c89e
with base as (
  select "profissional", count(distinct "atendimento_id") as "atendimentos", sum("comissao") as "comissoes"
  from "comissoes"
  where "unidade" = '${params.unidade}'
  and cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "profissional", "comissoes", "atendimentos"
from base
order by "comissoes" desc
limit 1000
```

<DataTable data={vb_un_equipe}>
  <Column id=profissional/>
  <Column id=comissoes title="Comissões" fmt=brl/>
  <Column id=atendimentos title="Atendimentos" fmt=num0/>
</DataTable>

<!-- /viewblock -->
