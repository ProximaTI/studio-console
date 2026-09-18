# Equipe e perfil de consumo

**Páginas:** [Painel da rede](/painel_rede/) · [Equipe e perfil de consumo](/equipe/)

Quem atende e como o cliente paga.

Duas visões saem de dimensões CALCULADAS do catálogo: a faixa de ticket vem
de `bins` (bordas declaradas) e o prazo de pagamento vem de `map` (valor →
rótulo) — nenhum CASE escrito à mão.

Compare as duas logo abaixo. A faixa declarada responde "quantos por
categoria que eu escolhi"; o histograma responde "que forma isso tem" — as
bordas são calculadas sobre os dados do recorte, com a cauda aparada no p99
para que um valor extremo não esmague o corpo da distribuição. O que passa
do p99 não é descartado: entra na última faixa, que aparece aberta (`+`).

## Comissões por profissional

<!-- viewblock v1 {"v":1,"id":"vb_eq_profissional","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_eq_profissional","sql":null}],"dims":[{"dim":"profissional","alias":"profissional","column":"profissional","table":"comissoes","label":"Profissional"}],"metrics":[{"name":"comissoes","alias":"comissoes","label":"Comissões","fmt":"brl"},{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"},{"name":"ticket_medio","alias":"ticket_medio","label":"Ticket médio","fmt":"brl"}],"filters":[],"limit":1000,"params":[{"name":"ano","type":"enum","from":"tempo.ano","default":"%","label":"Ano"}],"style":"tabular","children":[]} -->

```sql vb_eq_profissional_ano_opts
select distinct cast(year(cast("data" as date)) as varchar) as value
from "comissoes"
where year(cast("data" as date)) is not null
order by 1
```

<Dropdown name=ano data={vb_eq_profissional_ano_opts} value=value title="Ano"><DropdownOption value="%" valueLabel="Todos"/></Dropdown>

```sql vb_eq_profissional
-- semantic: comissoes@d72794a6
with base as (
  select "profissional", count(distinct "atendimento_id") as "atendimentos", sum("comissao") as "comissoes", avg("valor") as "ticket_medio"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "profissional", "comissoes", "atendimentos", "ticket_medio"
from base
order by "comissoes" desc
limit 1000
```

<DataTable data={vb_eq_profissional}>
  <Column id=profissional title="Profissional"/>
  <Column id=comissoes title="Comissões" fmt=brl/>
  <Column id=atendimentos title="Atendimentos" fmt=num0/>
  <Column id=ticket_medio title="Ticket médio" fmt=brl/>
</DataTable>

<!-- /viewblock -->

## Região × serviço

<!-- viewblock v1 {"v":1,"id":"vb_eq_regiao_servico","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_eq_regiao_servico","sql":null}],"dims":[{"dim":"regiao","alias":"regiao","column":"regiao","table":"comissoes","label":"Região"},{"dim":"servico","alias":"servico","column":"servico","table":"comissoes","label":"Serviço"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"group","children":[]} -->

```sql vb_eq_regiao_servico
-- semantic: comissoes@d72794a6
with base as (
  select "regiao", "servico", sum("valor") as "faturamento"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1, 2
)
select "regiao", "servico", "faturamento"
from base
order by "faturamento" desc
limit 1000
```

<DataTable data={vb_eq_regiao_servico}>
  <Column id=regiao title="Região"/>
  <Column id=servico title="Serviço"/>
  <Column id=faturamento title="Faturamento" fmt=brl/>
</DataTable>

<!-- /viewblock -->

## Atendimentos por faixa de ticket

<!-- viewblock v1 {"v":1,"id":"vb_eq_faixa","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_eq_faixa","sql":null}],"dims":[{"dim":"faixa_ticket","alias":"faixa_ticket","column":"faixa_ticket","table":"comissoes","label":"Faixa de ticket"}],"metrics":[{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"}],"filters":[],"limit":1000,"params":[],"style":"graph.bar","children":[]} -->

```sql vb_eq_faixa
-- semantic: comissoes@d72794a6
with base as (
  select case when "valor" >= 0 and "valor" < 60 then 'até R$ 60' when "valor" >= 60 and "valor" < 120 then 'R$ 60–120' when "valor" >= 120 and "valor" < 250 then 'R$ 120–250' when "valor" >= 250 then 'R$ 250+' end as "faixa_ticket", count(distinct "atendimento_id") as "atendimentos"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "faixa_ticket", "atendimentos"
from base
order by "atendimentos" desc
limit 1000
```

<BarChart data={vb_eq_faixa} x=faixa_ticket y=atendimentos yFmt=num0 seriesLabels={["Atendimentos"]}/>

<!-- /viewblock -->

## Onde o ticket realmente se concentra

<!-- viewblock v1 {"v":1,"id":"vb_eq_forma_dist","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_eq_forma_dist","sql":null}],"dims":[],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.histogram","distribution":{"bins":24},"children":[]} -->

```sql vb_eq_forma_dist
-- semantic: comissoes@d72794a6 · distribuição (24 faixas, cauda aparada no p99)
with obs as (
  select "valor" as v
  from "comissoes"
  where "valor" is not null
    and cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
), lim as (
  select min(v) as lo, quantile_cont(v, 0.99) as hi, max(v) as vmax, count(*) as n
  from obs
), faixas as (
  select
    f.i,
    lim.lo + f.i * (lim.hi - lim.lo) / 24 as ini,
    case when f.i = 23 then lim.vmax else lim.lo + (f.i + 1) * (lim.hi - lim.lo) / 24 end as fim,
    case when lim.hi - lim.lo >= 100 then cast(cast(round(ini, 0) as bigint) as varchar)
         else cast(round(ini, 2) as varchar) end
      || case when f.i = 23 and lim.vmax > lim.hi then '+' else '' end as faixa
  from (select unnest(range(0, 24)) as i) f, lim
  where lim.n > 0 and (f.i = 0 or lim.hi > lim.lo)
), contagem as (
  select
    least(23, case when lim.hi > lim.lo
                        then cast(floor((obs.v - lim.lo) * 24 / (lim.hi - lim.lo)) as integer)
                        else 0 end) as i,
    count(*) as n
  from obs, lim
  group by 1
)
select f.i as faixa_i, f.ini as faixa_min, f.fim as faixa_max, f.faixa as faixa,
  coalesce(c.n, 0) as observacoes
from faixas f
left join contagem c on c.i = f.i
order by f.i
```

<BarChart data={vb_eq_forma_dist} x=faixa y=observacoes yFmt=num0 contiguous=true xAxisTitle="Faturamento" seriesLabels={["Observações"]}/>

<!-- /viewblock -->

## Faturamento por prazo de pagamento

<!-- viewblock v1 {"v":1,"id":"vb_eq_prazo","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_eq_prazo","sql":null}],"dims":[{"dim":"prazo_pagamento","alias":"prazo_pagamento","column":"prazo_pagamento","table":"comissoes","label":"Prazo do pagamento"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.bar","children":[]} -->

```sql vb_eq_prazo
-- semantic: comissoes@d72794a6
with base as (
  select case when cast("forma_pagamento" as varchar) = 'Pix' then 'À vista' when cast("forma_pagamento" as varchar) = 'Dinheiro' then 'À vista' when cast("forma_pagamento" as varchar) = 'Débito' then 'À vista' when cast("forma_pagamento" as varchar) = 'Crédito' then 'A prazo' else 'Outros' end as "prazo_pagamento", sum("valor") as "faturamento"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "prazo_pagamento", "faturamento"
from base
order by "faturamento" desc
limit 1000
```

<BarChart data={vb_eq_prazo} x=prazo_pagamento y=faturamento yFmt=brl seriesLabels={["Faturamento"]}/>

<!-- /viewblock -->

## Onde o ticket realmente cai, por unidade

<!-- viewblock v1 {"v":1,"id":"vb_eq_faixa_ticket","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_eq_faixa_ticket","sql":null}],"dims":[{"dim":"unidade","alias":"unidade","column":"unidade","table":"comissoes","label":"Unidade"}],"metrics":[{"name":"ticket_p25","alias":"ticket_p25","label":"Ticket P25","fmt":"brl"},{"name":"ticket_mediana","alias":"ticket_mediana","label":"Ticket mediano","fmt":"brl"},{"name":"ticket_p75","alias":"ticket_p75","label":"Ticket P75","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.range","children":[]} -->

```sql vb_eq_faixa_ticket
-- semantic: comissoes@d72794a6
with base as (
  select "unidade", quantile_cont("valor", 0.25) as "ticket_p25", quantile_cont("valor", 0.5) as "ticket_mediana", quantile_cont("valor", 0.75) as "ticket_p75"
  from "comissoes"
  where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
  group by 1
)
select "unidade", "ticket_p25", "ticket_mediana", "ticket_p75"
from base
order by "ticket_p25" desc
limit 1000
```

<RangeChart data={vb_eq_faixa_ticket} x=unidade low=ticket_p25 mid=ticket_mediana high=ticket_p75 yFmt=brl/>

<!-- /viewblock -->

## Mix de serviços, região a região

<!-- viewblock v1 {"v":1,"id":"vb_eq_multiplos","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_eq_multiplos","sql":null}],"dims":[{"dim":"regiao","alias":"regiao","column":"regiao","table":"comissoes","label":"Região"},{"dim":"servico","alias":"servico","column":"servico","table":"comissoes","label":"Serviço"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"nested","nested":{"parent":["regiao"],"child":["servico"],"childStyle":"graph.bar","limitPerGroup":6,"maxGroups":12},"children":[]} -->

```sql vb_eq_multiplos
select * from (
  select b.*, row_number() over (partition by "regiao" order by "faturamento" desc) as _rn
  from (
    -- semantic: comissoes@d72794a6
    with base as (
      select "regiao", "servico", sum("valor") as "faturamento"
      from "comissoes"
      where cast(year(cast("data" as date)) as varchar) like '${inputs.ano.value}'
      group by 1, 2
    )
    select "regiao", "servico", "faturamento"
    from base
    order by "faturamento" desc
    limit 1000
  ) b
) t
where _rn <= 6
order by "regiao", _rn
```

<Repeat data={vb_eq_multiplos} by="regiao" childStyle=graph.bar x=servico y=faturamento maxGroups=12/>

<!-- /viewblock -->
