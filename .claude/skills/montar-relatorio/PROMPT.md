# Modelo de pedido — `/montar-relatorio`

Cole, preencha o que souber e apague o resto. Campos em branco têm padrão
declarado em §4: nada trava por falta de resposta, mas o que você não disser
eu decido — e digo o que decidi.

---

## 1. Versão curta (serve para 80% dos casos)

```
/montar-relatorio
Projeto: <slug em projects/>   Modelo: <nome do semantic/*.yaml>
Público: <quem lê>             Visibilidade: public | internal

Perguntas:
1. <pergunta em linguagem de negócio>
2. <...>
```

Se você só souber isso, é o suficiente para começar. O resto eu pergunto **só
se mudar o resultado**.

---

## 2. Versão completa

```
Projeto: <slug>
Modelo semântico: <nome> | sem catálogo (fontes cruas em sources/)
Público: <sócios · gestores da CAPES · coordenadores de área · externo>
Visibilidade: public | internal      # internal é o que libera dimensão pii/expose

PERGUNTAS (uma por linha, em linguagem de negócio — ver §3)
1.
2.
3.

JÁ DECIDIDO
- Recorte fixo: <filtros que valem para tudo>
- Período: <anos/meses cobertos>
- O leitor pode trocar: <ano? unidade? nada?>
- Uma página por <dimensão>: <sim/não — vira [param].md>

NÃO QUERO
- <métricas ou dimensões proibidas>
- <comparações que não fazem sentido no negócio>
- <denominador que muda a leitura: "conte artigos, não autores">

ENTREGA
- Formato: spec-driven (reports/<slug>.md) | página artesanal
- Onde: editor | 📦 snapshot | ☁ app
- Prosa: <quem escreve a narrativa — você ou eu>
```

---

## 3. Como enunciar as perguntas (a parte que mais muda o resultado)

**Diga a pergunta, não o gráfico.** A escolha do gráfico sai do registro de
estilos (`shared/viewStyles.js`), que casa pergunta → estilo → contrato. Quando
você nomeia o gráfico, você desliga essa escolha e herda o que pediu, mesmo que
a premissa do dado não sustente.

| em vez de | escreva |
|---|---|
| "faz um gráfico de barras de faturamento por unidade" | "qual unidade fatura mais" |
| "mostra a média do ticket" | "a média do ticket esconde muita coisa; quero ver se ela representa os atendimentos" |
| "põe um mapa do Brasil com os artigos" | "onde a produção se concentra no país" |
| "linha do faturamento por unidade ao longo dos anos" | "alguma unidade perdeu terreno para as outras com o passar dos anos" |

A segunda coluna da linha 2 é literal: esse enunciado produziu histograma +
marca de intervalo + bump nas quatro execuções do teste. A primeira teria
produzido um número só.

**Enuncie o denominador quando ele for ambíguo.** "% de artigos" é sobre o total
da IES, da área ou do país? Sem isso eu escolho um e declaro — mas é o tipo de
escolha que muda a manchete.

---

## 4. O que eu assumo se você não disser

| campo em branco | padrão |
|---|---|
| Visibilidade | `public` — e recuso dimensão `pii`/`expose: internal` com erro, não em silêncio |
| Formato | **spec-driven** (`reports/<slug>.md`), que é o caminho preferido para multipágina |
| Onde | editor; publico 📦/☁ só se você pedir (☁ escreve ~79MB de WASM por app) |
| Prosa | escrevo um rascunho e marco como seu para revisar |
| Modelo semântico | se o projeto tiver exatamente um catálogo válido, uso ele; se tiver vários, pergunto |
| Período | o recorte inteiro da fonte |

---

## 5. O que eu vou recusar ou questionar

Não são preferências minhas — são regras que o compilador aplica, ou achados
medidos neste projeto:

- **SQL escrito à mão em bloco semântico.** Sai do compilador ou não sai. Se
  você precisa de SQL que o catálogo não expressa, o conserto é no catálogo.
- **Contagem absoluta num mapa por UF.** Colore população e tamanho do estado,
  não a taxa — os quatro `areamap` em relatórios reais deste acervo caem nisso.
  Vou propor uma métrica normalizada e explicar.
- **Filtro de ano global junto de um gráfico com ano no eixo.** Escolher um ano
  reduz o gráfico a um instante. Os dois na mesma página se contradizem.
- **Banco externo em runtime de página.** ATTACH/postgres_scan são proibidos; o
  caminho é view materializada ou mount.
- **Segredo em yaml, página ou resposta de API.** Nunca, em nenhuma forma.

---

## 6. Padrão de rigor da narrativa

Vale para a prosa que eu escrever, e é o que você já cobrou antes:

- **denominador explícito** em toda proporção;
- **citar ≠ ler**: não afirmar leitura onde o dado mede citação;
- separar **observado · hipótese · implicação** — não misturar as três na mesma
  frase;
- **títulos descritivos** ("Metade do faturamento vem de três unidades"), não
  rótulos ("Faturamento por unidade");
- eixos e legendas formatados em pt-BR.

---

## 7. Exemplo preenchido

```
/montar-relatorio
Projeto: exemplo     Modelo: comissoes
Público: sócios e gerentes das unidades      Visibilidade: public

PERGUNTAS
1. Como vai o faturamento da rede no período, em número de cabeçalho.
2. A média do ticket esconde muita coisa — quero ver onde os valores caem de verdade.
3. Alguma unidade perdeu terreno para as outras com o passar dos anos.
4. Como o faturamento se espalha pelo país.

JÁ DECIDIDO
- O leitor pode trocar o ano.
- Uma página por unidade: sim.

NÃO QUERO
- Nada que exponha nome de cliente (dimensão cliente é pii).

ENTREGA
- spec-driven, editor por enquanto. Prosa: eu reviso a sua.
```
