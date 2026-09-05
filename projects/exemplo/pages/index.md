# Rede de salões — visão geral

Projeto de **exemplo** do Studio Console: uma rede fictícia de 9 salões em 9 UFs,
com 1 linha por atendimento. As páginas desta pasta são **artesanais** (Markdown +
SQL no dialeto Evidence); o relatório em *Relatórios* é **gerado** a partir de uma
spec, com View Blocks reeditáveis.

**Páginas:** [Visão geral](/) · [Faturamento](/faturamento/) · [Comissões](/comissoes/) · [Atendimentos](/atendimentos/) · [Mapas](/mapas/) · [Profissionais](/prof/)

```sql anos
select '%' as valor, 'Todos os anos' as rotulo
union all
select distinct cast(year(data::date) as varchar), cast(year(data::date) as varchar)
from comissoes
order by valor
```

<Dropdown data={anos} name=ano value=valor label=rotulo title="Ano"/>

```sql kpis
select
  sum(valor)                  as faturamento,
  sum(comissao)               as comissoes,
  count(*)                    as atendimentos,
  avg(valor)                  as ticket_medio,
  count(distinct cliente)     as clientes
from comissoes
where cast(year(data::date) as varchar) like '${inputs.ano.value}'
```

<BigValue data={kpis} value=faturamento title="Faturamento" fmt=brl/>
<BigValue data={kpis} value=comissoes title="Comissões" fmt=brl/>
<BigValue data={kpis} value=atendimentos title="Atendimentos" fmt='#,##0'/>
<BigValue data={kpis} value=ticket_medio title="Ticket médio" fmt=brl/>
<BigValue data={kpis} value=clientes title="Clientes" fmt='#,##0'/>

## Evolução mensal

```sql por_mes
select
  strftime(data::date, '%Y-%m') as mes,
  sum(valor)                    as faturamento,
  sum(comissao)                 as comissoes
from comissoes
where cast(year(data::date) as varchar) like '${inputs.ano.value}'
group by 1
order by 1
```

<LineChart data={por_mes} x=mes y=faturamento title="Faturamento por mês"/>

## Unidades

```sql por_unidade
select unidade, uf, sum(valor) as faturamento, count(*) as atendimentos
from comissoes
where cast(year(data::date) as varchar) like '${inputs.ano.value}'
group by 1, 2
order by 3 desc
```

<BarChart data={por_unidade} x=unidade y=faturamento title="Faturamento por unidade"/>

## Mix de serviços

```sql por_servico
select servico, count(*) as atendimentos, sum(valor) as faturamento, avg(valor) as ticket_medio
from comissoes
where cast(year(data::date) as varchar) like '${inputs.ano.value}'
group by 1
order by 3 desc
```

<DataTable data={por_servico}>
  <Column id=servico title="Serviço"/>
  <Column id=atendimentos title="Atendimentos" fmt='#,##0'/>
  <Column id=faturamento title="Faturamento" fmt=brl/>
  <Column id=ticket_medio title="Ticket médio" fmt=brl/>
</DataTable>
