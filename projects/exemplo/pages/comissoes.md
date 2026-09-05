# Comissões

Quanto cada unidade repassa para a equipe. Filtre para ver o detalhe.

**Páginas:** [Visão geral](/) · [Faturamento](/faturamento/) · [Comissões](/comissoes/) · [Atendimentos](/atendimentos/) · [Mapas](/mapas/) · [Profissionais](/prof/)

```sql unidades
select '%' as valor, 'Todas as unidades' as rotulo
union all
select distinct unidade, unidade from comissoes
order by valor
```

<Dropdown data={unidades} name=unidade value=valor label=rotulo title="Unidade"/>

```sql resumo
select
  sum(comissao)                    as comissoes,
  sum(valor)                       as faturamento,
  sum(comissao) / sum(valor)       as margem
from comissoes
where unidade like '${inputs.unidade.value}'
```

<BigValue data={resumo} value=comissoes title="Comissões" fmt=brl/>
<BigValue data={resumo} value=faturamento title="Faturamento" fmt=brl/>
<BigValue data={resumo} value=margem title="% de comissão" fmt=pct1/>

## Por profissional

```sql por_profissional
select profissional, unidade, sum(comissao) as comissoes, count(*) as atendimentos
from comissoes
where unidade like '${inputs.unidade.value}'
group by 1, 2
order by 3 desc
```

<BarChart data={por_profissional} x=profissional y=comissoes title="Comissões por profissional"/>

## Por serviço

```sql por_servico
select servico, sum(comissao) as comissoes, avg(comissao_pct) as pct_medio
from comissoes
where unidade like '${inputs.unidade.value}'
group by 1
order by 2 desc
```

<BarChart data={por_servico} x=servico y=comissoes title="Comissões por serviço"/>

## Detalhe dos atendimentos

```sql detalhe
select data, unidade, profissional, servico, valor, comissao, forma_pagamento
from comissoes
where unidade like '${inputs.unidade.value}'
order by data desc
limit 200
```

<DataTable data={detalhe}>
  <Column id=data title="Data"/>
  <Column id=unidade title="Unidade"/>
  <Column id=profissional title="Profissional"/>
  <Column id=servico title="Serviço"/>
  <Column id=valor title="Valor" fmt=brl/>
  <Column id=comissao title="Comissão" fmt=brl/>
  <Column id=forma_pagamento title="Pagamento"/>
</DataTable>
