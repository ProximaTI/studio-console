# Perfil de {params.prof}

**Páginas:** [Visão geral](/) · [Profissionais](/prof/)

```sql prof
-- query-convenção: a coluna "prof" define os valores possíveis da página
select distinct profissional as prof from comissoes order by 1
```

```sql resumo
select
  count(*)      as atendimentos,
  sum(valor)    as faturamento,
  sum(comissao) as comissoes,
  avg(valor)    as ticket_medio
from comissoes
where profissional = '${params.prof}'
```

{params.prof} fez **{resumo[0].atendimentos}** atendimentos no período.

<BigValue data={resumo} value=atendimentos title="Atendimentos" fmt='#,##0'/>
<BigValue data={resumo} value=faturamento title="Faturamento" fmt=brl/>
<BigValue data={resumo} value=comissoes title="Comissões" fmt=brl/>
<BigValue data={resumo} value=ticket_medio title="Ticket médio" fmt=brl/>

## Comissões por serviço

```sql porservico
select servico, count(*) as atendimentos, sum(comissao) as comissoes
from comissoes
where profissional = '${params.prof}'
group by 1
order by 3 desc
```

<BarChart data={porservico} x=servico y=comissoes title="Comissões por serviço"/>

## Evolução mensal

```sql pormes
select strftime(data::date, '%Y-%m') as mes, sum(comissao) as comissoes
from comissoes
where profissional = '${params.prof}'
group by 1
order by 1
```

<LineChart data={pormes} x=mes y=comissoes title="Comissões por mês"/>

<DataTable data={porservico}>
  <Column id=servico title="Serviço"/>
  <Column id=atendimentos title="Atendimentos" fmt='#,##0'/>
  <Column id=comissoes title="Comissões" fmt=brl/>
</DataTable>
