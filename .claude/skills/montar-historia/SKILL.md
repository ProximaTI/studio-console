---
name: montar-historia
description: Montar um relatório do Studio Console que CONTA UMA HISTÓRIA — junta a disciplina narrativa (arco, gancho, so-what) com a mecânica do console (spec, blocos, compiladores). Use quando o pedido é "conte a história destes dados", "painel executivo", "apresentação para a diretoria" ou quando o relatório precisa levar a uma decisão, não só exibir números.
---

# Montar história com dados no Studio Console

Esta skill **compõe duas outras; não as substitui**:

- **`montar-relatorio`** — a mecânica: dialeto, View Blocks, catálogo semântico, esteira
  ReportPlan/spec-driven, APIs, verificação nos 3 ambientes. Carregue-a sempre.
- **`data-storytelling`** — o repertório narrativo: arco, frameworks (problema→solução,
  tendência, comparação), transições, manchetes. Carregue quando precisar do repertório.

O que é **novo aqui** é só a junção: onde a decisão narrativa encosta na estrutura da spec,
e o que fazer quando as duas skills discordam. Nada do que já está nelas é repetido — se
divergirem deste arquivo, **elas** são a fonte para o que é delas.

Se `data-storytelling` não estiver instalada, o mínimo que ela aporta é: um relatório tem
**gancho** (o número que faz parar), **contexto** (a base contra a qual ler), **desenvolvimento**
(o que muda e por quê), **achado** (a frase que o leitor vai repetir) e **consequência** (o que
fazer com isso). Sem os cinco, é um painel, não uma história.

## A regra que decide os empates

**Onde `data-storytelling` e o padrão de rigor deste projeto conflitarem, o rigor vence.**

`data-storytelling` é genérica e orientada a persuasão: os exemplos afirmam "US$ 2,4M ao ano"
e "reduzir 40% do churn" sem denominador, e a seção de incerteza para em "com 95% de confiança".
Seguir isso aqui produz afirmação a mais do que o dado sustenta. As substituições:

| onde ela diz | aqui vale |
|---|---|
| "Start with the so what", "Lead with insight" | sim — **mas** a manchete carrega o denominador |
| "Show, don't tell" | sim — e o eixo vem formatado em pt-BR, com o denominador na legenda |
| "The data reveals…" | separe **observado · hipótese · implicação**; não misture na mesma frase |
| frameworks com números redondos | número redondo é suspeito: mostre o valor, não o arredondado |
| "correlation is strong" | correlação de postos = Spearman com postos médios; diga qual usou |
| "Don't show methodology first" | não mostre primeiro, mas **mostre**: o que o dado NÃO responde vai em `warnings` |

E uma que é só deste domínio: **citar ≠ ler**. Se a fonte mede citação, a frase não pode afirmar
leitura, uso ou impacto.

## O arco encosta na spec aqui

A estrutura narrativa não vira prosa solta — ela vira **campos do contrato** em
`projects/<p>/reports/<slug>.md`. Este é o mapa:

| movimento | onde vive na spec | observação |
|---|---|---|
| **Gancho** | `title` do relatório + `title` do primeiro bloco | título DESCRITIVO ("Metade do faturamento vem de três unidades"), nunca rótulo ("Faturamento por unidade") |
| **Promessa** | `purpose` | uma frase: a decisão que este relatório informa |
| **Contexto** | primeira página, blocos de base | é aqui que o **denominador** aparece, explicitamente |
| **Desenvolvimento** | ordem das páginas e dos blocos | a ordem É o argumento; o compilador preserva a que você declarar |
| **Achado** | o bloco cuja pergunta É a pergunta do relatório | um por página, no máximo |
| **Consequência** | `prose:` da página | campo AUTORAL, fora do schema do LLM — é onde a interpretação humana entra |
| **Limite** | `warnings:` | o que o recorte não permite afirmar |

Duas propriedades do `prose:` que fazem diferença: ele é preservado pelo build (a página é
recompilada, a prosa não é reescrita) e o `absorb` só o traz de volta com `{prose: true}`. É o
lugar seguro para a narrativa.

## Enuncie a pergunta, não o gráfico

O gráfico sai do registro de estilos (`question` → `breaks` → `fallback` em
`shared/viewStyles.js`), que também gera o menu do planejador. Nomear o gráfico no pedido
desliga essa escolha e herda a forma mesmo quando a premissa do dado não a sustenta.

Traduza cada movimento narrativo numa pergunta de negócio e deixe o registro escolher:

- gancho → *"qual é o número que resume isto"*
- contexto → *"qual é a base de comparação, e sobre qual total"*
- desenvolvimento → *"o que mudou, e quem mudou de lugar"*
- achado → *"onde os valores realmente caem"* / *"quem subiu e quem caiu"*

O gabarito de pedido está em `montar-relatorio/PROMPT.md` §3, com exemplos medidos.

## Uma história por relatório

O erro mais comum não é escolher mal o gráfico — é **não escolher a história**. Sintomas:

- páginas que são listas de tudo o que o catálogo oferece;
- dois achados concorrendo na mesma página (o leitor não sabe qual repetir);
- um bloco que ninguém consegue explicar por que está ali.

Antes de montar: escreva **uma frase** com o achado. Se não couber numa frase, ou não há
história, ou há mais de uma — e aí são dois relatórios.

Todo bloco tem de responder a esta pergunta: *que parte da frase este bloco sustenta?* Bloco
sem resposta sai.

### Quantas páginas

Página nova **só quando a pergunta do leitor muda de natureza** — não quando sobra dado.
São três perguntas possíveis, nesta ordem, e a maioria dos relatórios usa uma ou duas:

| página | a pergunta que ela responde | quando existe |
|---|---|---|
| 1 · o achado | *o que é?* | sempre |
| 2 · a verificação | *isso é robusto, ou é artefato do recorte?* | quando o achado depende de agregar coisas diferentes (várias unidades, vários períodos, vários produtos) e o leitor tem razão em desconfiar |
| 3 · o desdobramento | *onde isso aparece mais forte?* | quando a ação muda conforme o segmento — e só então |

A pergunta *"e daí?"* **não** ganha página: a consequência mora em `prose:`, e uma página de
recomendações sem bloco novo é texto fingindo ser análise.

Sintoma de página a mais: você consegue apagá-la e a frase continua sustentada. Sintoma de
página a menos: a frase depende de uma afirmação que nenhum bloco mostra.

Exemplo real (`projects/exemplo/reports/ticket_medio_engana.md`): a página 1 mostra que a
média descreve 12,6% dos atendimentos; a página 2 existe porque a rede tem nove unidades e
a primeira dúvida honesta é *"isso não é só efeito de somar unidades diferentes?"*. Não há
página 3: a recomendação (meta por serviço) é uma frase na prosa, não um bloco.

## Antes de entregar

Além da verificação obrigatória de `montar-relatorio` (editor + 📦 + ☁ concordando, vitest da
raiz, tsc em `web/`):

1. A manchete do relatório cabe numa frase, e o denominador está nela.
2. Toda proporção na prosa diz sobre qual total.
3. Nenhuma frase mistura observado, hipótese e implicação.
4. Todo título de bloco é descritivo, não rótulo.
5. `warnings` diz o que o recorte não permite afirmar — e está preenchido, não vazio por preguiça.
6. Nenhum bloco sobra sem sustentar uma parte da frase.
6b. Nenhuma página sobra: apagar qualquer uma deixa a frase sem sustentação.
7. Se há mapa: a métrica é normalizada, não contagem absoluta (viés de área/população).
8. Se há filtro global de tempo: nenhum bloco tem tempo no eixo (os dois se contradizem).
