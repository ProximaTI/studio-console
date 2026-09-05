# Atendimentos

Busca livre no histórico — demonstra os três inputs sem lista fixa:
`TextInput` (texto), `Slider` (número) e `DateRange` (período).

**Páginas:** [Visão geral](/) · [Faturamento](/faturamento/) · [Comissões](/comissoes/) · [Atendimentos](/atendimentos/) · [Mapas](/mapas/) · [Profissionais](/prof/)

<TextInput name=busca title="Profissional (like)" defaultValue="%"/>

<Slider name=minimo title="Valor mínimo (R$)" min=0 max=350 step=10 defaultValue=0/>

<DateRange name=periodo title="Período" start="2024-01-01" end="2026-03-31"/>

```sql filtrados
select
  data,
  unidade,
  profissional,
  servico,
  valor,
  comissao,
  forma_pagamento
from comissoes
where profissional like '${inputs.busca}'
  and valor >= ${inputs.minimo}
  and data::date between '${inputs.periodo.start}' and '${inputs.periodo.end}'
order by data desc
limit 200
```

```sql total_filtrado
select count(*) as atendimentos, sum(valor) as faturamento
from comissoes
where profissional like '${inputs.busca}'
  and valor >= ${inputs.minimo}
  and data::date between '${inputs.periodo.start}' and '${inputs.periodo.end}'
```

<BigValue data={total_filtrado} value=atendimentos title="Atendimentos no filtro" fmt='#,##0'/>
<BigValue data={total_filtrado} value=faturamento title="Faturamento no filtro" fmt=brl/>

A tabela abaixo mostra no máximo 200 linhas do recorte.

<DataTable data={filtrados}>
  <Column id=data title="Data"/>
  <Column id=unidade title="Unidade"/>
  <Column id=profissional title="Profissional"/>
  <Column id=servico title="Serviço"/>
  <Column id=valor title="Valor" fmt=brl/>
  <Column id=comissao title="Comissão" fmt=brl/>
  <Column id=forma_pagamento title="Pagamento"/>
</DataTable>
