# O ticket médio não é o ticket de ninguém

**Páginas:** [O ticket médio não é o ticket de ninguém](/ticket_medio/) · [O vale não vem de misturar unidades](/nao_e_artefato/)

A média da rede e a distribuição que ela resume.

**Observado.** Em 1.338 atendimentos, o valor médio é R$ 125,38 e o mediano é
R$ 96,63 — a média fica 30% acima da mediana. Apenas 169 atendimentos (12,6% do
total) caem a menos de 10% de distância da média.

A distribuição tem duas regiões povoadas e um vazio entre elas. O pico está entre
R$ 60 e R$ 80, com 307 atendimentos; a partir daí a contagem cai, e a faixa da
média (R$ 120 a R$ 140) já tem 111. Entre R$ 140 e R$ 200 há 88 atendimentos
somando três faixas — menos do que a faixa única anterior. Acima de R$ 200 a
contagem volta a subir e se mantém até R$ 340, somando 227 atendimentos.

**Hipótese.** As duas regiões correspondem a dois conjuntos de serviços com preços
que não se sobrepõem: Barba, Manicure, Escova e Corte têm medianas entre R$ 62 e
R$ 104; Hidratação e Coloração, R$ 167 e R$ 278. A média da rede cai na descida
entre os dois conjuntos, pouco antes do vazio.

**Implicação.** Uma meta única de ticket para a rede mira um valor que nenhum
serviço pratica. A decisão que este relatório informa é substituir a meta única
por uma meta por serviço — ou por uma meta de **mix**, que é o que realmente
move o ticket da unidade.

## 1.338 atendimentos, e uma média 30% acima da mediana

<!-- viewblock v1 {"v":1,"id":"vb_base","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_base","sql":null}],"dims":[],"metrics":[{"name":"atendimentos","alias":"atendimentos","label":"Atendimentos","fmt":"num0"},{"name":"faturamento","alias":"faturamento","label":"Faturamento","fmt":"brl"},{"name":"ticket_medio","alias":"ticket_medio","label":"Ticket médio","fmt":"brl"},{"name":"ticket_mediana","alias":"ticket_mediana","label":"Ticket mediano","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"freeform","children":[]} -->

```sql vb_base
-- semantic: comissoes@d72794a6
with base as (
  select count(distinct "atendimento_id") as "atendimentos", sum("valor") as "faturamento", avg("valor") as "ticket_medio", quantile_cont("valor", 0.5) as "ticket_mediana"
  from "comissoes"
)
select "atendimentos", "faturamento", "ticket_medio", "ticket_mediana"
from base
order by "atendimentos" desc
limit 1000
```

<BigValue data={vb_base} value=atendimentos title="Atendimentos" fmt=num0/>
<BigValue data={vb_base} value=faturamento title="Faturamento" fmt=brl/>
<BigValue data={vb_base} value=ticket_medio title="Ticket médio" fmt=brl/>
<BigValue data={vb_base} value=ticket_mediana title="Ticket mediano" fmt=brl/>

<!-- /viewblock -->

## O pico está em R$ 60–80; a média, R$ 45 acima dele

<!-- viewblock v1 {"v":1,"id":"vb_forma","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_forma","sql":null}],"dims":[],"metrics":[{"name":"ticket_medio","alias":"ticket_medio","label":"Ticket médio","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.histogram","distribution":{"bins":24},"children":[]} -->

```sql vb_forma
-- semantic: comissoes@d72794a6 · distribuição (24 faixas, cauda aparada no p99)
with obs as (
  select "valor" as v
  from "comissoes"
  where "valor" is not null
), lim as (
  select min(v) as lo, quantile_cont(v, 0.99) as hi, max(v) as vmax, count(*) as n
  from obs
), faixas as (
  select
    f.i,
    lim.lo + f.i * (lim.hi - lim.lo) / 24 as ini,
    case when f.i = 23 then lim.vmax else lim.lo + (f.i + 1) * (lim.hi - lim.lo) / 24 end as fim,
    case when lim.hi - lim.lo >= 100 then cast(cast(round(ini, 0) as bigint) as varchar)
         else replace(cast(round(ini, 2) as varchar), '.', ',') end
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

<BarChart data={vb_forma} x=faixa y=observacoes yFmt=num0 contiguous=true xAxisTitle="Ticket médio" seriesLabels={["Observações"]}/>

<!-- /viewblock -->

## Cada serviço tem sua faixa, e elas quase não se tocam

<!-- viewblock v1 {"v":1,"id":"vb_por_servico","source":{"kind":"semantic","name":"comissoes"},"catalogHash":"d72794a6","queries":[{"name":"vb_por_servico","sql":null}],"dims":[{"dim":"servico","alias":"servico","column":"servico","table":"comissoes","label":"Serviço"}],"metrics":[{"name":"ticket_p25","alias":"ticket_p25","label":"Ticket P25","fmt":"brl"},{"name":"ticket_mediana","alias":"ticket_mediana","label":"Ticket mediano","fmt":"brl"},{"name":"ticket_p75","alias":"ticket_p75","label":"Ticket P75","fmt":"brl"}],"filters":[],"limit":1000,"params":[],"style":"graph.range","children":[]} -->

```sql vb_por_servico
-- semantic: comissoes@d72794a6
with base as (
  select "servico", quantile_cont("valor", 0.25) as "ticket_p25", quantile_cont("valor", 0.5) as "ticket_mediana", quantile_cont("valor", 0.75) as "ticket_p75"
  from "comissoes"
  group by 1
)
select "servico", "ticket_p25", "ticket_mediana", "ticket_p75"
from base
order by "ticket_p25" desc
limit 1000
```

<RangeChart data={vb_por_servico} x=servico low=ticket_p25 mid=ticket_mediana high=ticket_p75 yFmt=brl/>

<!-- /viewblock -->
