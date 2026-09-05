# Equipe e perfil de consumo

**Páginas:** [Painel da rede](/painel_rede/) · [Equipe e perfil de consumo](/equipe/)

Quem atende e como o cliente paga.

As duas últimas visões saem de dimensões CALCULADAS do catálogo: a faixa de
ticket vem de `bins` (bordas declaradas) e o prazo de pagamento vem de `map`
(valor → rótulo) — nenhum CASE escrito à mão.

## Comissões por profissional

<!-- viewblock v1 {"v":1,"id":"vb_eq_profissional","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_eq_profissional","sql":null}],"dims":[{"dim":"profissional","alias":"profissional","column":"profissional","table":"comissoes"}],"metrics":[{"name":"comissoes","alias":"comissoes","label":"Comissões","fmt":"brl"},{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"},{"name":"ticket_medio","alias":"ticket_medio","label":"Ticket médio","fmt":"brl"}],"filters":[],"limit":1000,"params":[{"name":"ano","type":"enum","from":"tempo.ano","default":"%","label":"Ano"}],"style":"tabular","children":[]} -->

```sql vb_eq_profissional_ano_opts
select distinct cast(year(cast("data" as date)) as varchar) as value
from "comissoes"
where year(cast("data" as date)) is not null
order by 1
```

<Dropdown name=ano data={vb_eq_profissional_ano_opts} value=value title="Ano"><DropdownOption value="%" valueLabel="Todos"/></Dropdown>

```sql vb_eq_profissional
-- semantic: comissoes@b1e6c89e
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
  <Column id=profissional/>
  <Column id=comissoes title="Comissões" fmt=brl/>
  <Column id=atendimentos title="Atendimentos" fmt=num0/>
  <Column id=ticket_medio title="Ticket médio" fmt=brl/>
</DataTable>

<!-- /viewblock -->

## Região × serviço

<!-- viewblock v1 {"v":1,"id":"vb_eq_regiao_servico","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_eq_regiao_servico","sql":null}],"dims":[{"dim":"regiao","alias":"regiao","column":"regiao","table":"comissoes"},{"dim":"servico","alias":"servico","column":"servico","table":"comissoes"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"group","children":[]} -->

```sql vb_eq_regiao_servico
-- semantic: comissoes@b1e6c89e
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
  <Column id=regiao/>
  <Column id=servico/>
  <Column id=faturamento title="Faturamento" fmt=brl/>
</DataTable>

<!-- /viewblock -->

## Atendimentos por faixa de ticket

<!-- viewblock v1 {"v":1,"id":"vb_eq_faixa","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_eq_faixa","sql":null}],"dims":[{"dim":"faixa_ticket","alias":"faixa_ticket","column":"faixa_ticket","table":"comissoes"}],"metrics":[{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"}],"filters":[],"limit":1000,"params":[],"style":"graph.bar","children":[]} -->

```sql vb_eq_faixa
-- semantic: comissoes@b1e6c89e
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

<BarChart data={vb_eq_faixa} x=faixa_ticket y=atendimentos/>

<!-- /viewblock -->

## Faturamento por prazo de pagamento

<!-- viewblock v1 {"v":1,"id":"vb_eq_prazo","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"b1e6c89e","queries":[{"name":"vb_eq_prazo","sql":null}],"dims":[{"dim":"prazo_pagamento","alias":"prazo_pagamento","column":"prazo_pagamento","table":"comissoes"}],"metrics":[{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.bar","children":[]} -->

```sql vb_eq_prazo
-- semantic: comissoes@b1e6c89e
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

<BarChart data={vb_eq_prazo} x=prazo_pagamento y=faturamento/>

<!-- /viewblock -->
