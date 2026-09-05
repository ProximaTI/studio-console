# Profissionais

Clique num nome para abrir o perfil — cada linha aponta para a rota `/prof/<nome>/`,
que o editor e o app publicado resolvem para a página parametrizada.

**Páginas:** [Visão geral](/) · [Faturamento](/faturamento/) · [Comissões](/comissoes/) · [Atendimentos](/atendimentos/) · [Mapas](/mapas/) · [Profissionais](/prof/)

```sql lista
select
  profissional,
  unidade,
  count(*)      as atendimentos,
  sum(valor)    as faturamento,
  sum(comissao) as comissoes,
  '/prof/' || profissional || '/' as link
from comissoes
group by 1, 2
order by 5 desc
```

<DataTable data={lista} link=link>
  <Column id=profissional title="Profissional"/>
  <Column id=unidade title="Unidade"/>
  <Column id=atendimentos title="Atendimentos" fmt='#,##0'/>
  <Column id=faturamento title="Faturamento" fmt=brl/>
  <Column id=comissoes title="Comissões" fmt=brl/>
</DataTable>
