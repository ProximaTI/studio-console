# O vale não vem de misturar unidades

**Páginas:** [O ticket médio não é o ticket de ninguém](/ticket_medio/) · [O vale não vem de misturar unidades](/nao_e_artefato/)

Verificar se a dispersão existe dentro de cada unidade.

**Observado.** As nove unidades têm faixas do meio parecidas: em todas, o intervalo
entre o primeiro e o terceiro quartil atravessa o vazio da página anterior. Nenhuma
unidade tem um ticket concentrado.

**Implicação.** O vale não é efeito de somar unidades com perfis diferentes — ele
existe dentro de cada uma, porque cada uma vende os mesmos seis serviços. Portanto
a meta por serviço vale para a rede inteira, não só no agregado.

## Todas as nove unidades têm a mesma dispersão larga

<!-- viewblock v1 {"v":1,"id":"vb_faixa_unidade","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_faixa_unidade","sql":null}],"dims":[{"dim":"unidade","alias":"unidade","column":"unidade","table":"comissoes","label":"Unidade"}],"metrics":[{"name":"ticket_p25","alias":"ticket_p25","label":"Ticket P25","fmt":"brl"},{"name":"ticket_mediana","alias":"ticket_mediana","label":"Ticket mediano","fmt":"brl"},{"name":"ticket_p75","alias":"ticket_p75","label":"Ticket P75","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.range","children":[]} -->

```sql vb_faixa_unidade
-- semantic: comissoes@d72794a6
with base as (
  select "unidade", quantile_cont("valor", 0.25) as "ticket_p25", quantile_cont("valor", 0.5) as "ticket_mediana", quantile_cont("valor", 0.75) as "ticket_p75"
  from "comissoes"
  group by 1
)
select "unidade", "ticket_p25", "ticket_mediana", "ticket_p75"
from base
order by "ticket_p25" desc
limit 1000
```

<RangeChart data={vb_faixa_unidade} x=unidade low=ticket_p25 mid=ticket_mediana high=ticket_p75 yFmt=brl/>

<!-- /viewblock -->

## O mix de serviços é parecido entre as unidades

<!-- viewblock v1 {"v":1,"id":"vb_mix","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_mix","sql":null}],"dims":[{"dim":"unidade","alias":"unidade","column":"unidade","table":"comissoes","label":"Unidade"},{"dim":"servico","alias":"servico","column":"servico","table":"comissoes","label":"Serviço"}],"metrics":[{"name":"pct_faturamento","alias":"pct_faturamento","label":"% do total","fmt":"pct1"}],"filters":[],"limit":1000,"params":[],"style":"group","children":[]} -->

```sql vb_mix
-- semantic: comissoes@d72794a6
with base as (
  select "unidade", "servico", sum("valor") as "faturamento"
  from "comissoes"
  group by 1, 2
)
select "unidade", "servico", "faturamento" / sum("faturamento") over () as "pct_faturamento"
from base
order by "pct_faturamento" desc
limit 1000
```

<DataTable data={vb_mix}>
  <Column id=unidade title="Unidade"/>
  <Column id=servico title="Serviço"/>
  <Column id=pct_faturamento title="% do total" fmt=pct1/>
</DataTable>

<!-- /viewblock -->
