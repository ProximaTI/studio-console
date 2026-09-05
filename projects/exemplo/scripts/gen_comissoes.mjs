// Gera sources/comissoes.csv — dados sintéticos da rede de salões do projeto
// de exemplo. DETERMINÍSTICO (PRNG com semente fixa): rodar de novo produz o
// mesmo arquivo byte a byte.
//
//   node projects/exemplo/scripts/gen_comissoes.mjs
//
// Colunas (as 7 originais do exemplo antigo + geografia, cliente e id):
//   atendimento_id, data, unidade, uf, regiao, profissional, servico,
//   valor, comissao_pct, comissao, forma_pagamento, cliente
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sources', 'comissoes.csv');

// PRNG determinístico (mulberry32).
let seed = 20260905;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function pickWeighted(pairs) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) if ((r -= w) < 0) return v;
  return pairs[pairs.length - 1][0];
}

// 9 unidades em 9 UFs / 5 regiões — inclui o DF (área pequena no mapa: é o
// caso que o rótulo com linha-guia do AreaMap resolve).
const UNIDADES = [
  { nome: 'Vila Madalena', uf: 'SP', regiao: 'Sudeste', peso: 1.35, equipe: ['Ana Prado', 'Bruno Tavares'] },
  { nome: 'Copacabana', uf: 'RJ', regiao: 'Sudeste', peso: 1.15, equipe: ['Carla Menezes', 'Diego Moura'] },
  { nome: 'Savassi', uf: 'MG', regiao: 'Sudeste', peso: 1.0, equipe: ['Elisa Rocha', 'Fábio Nunes'] },
  { nome: 'Moinhos de Vento', uf: 'RS', regiao: 'Sul', peso: 0.95, equipe: ['Gabriela Lima', 'Henrique Alves'] },
  { nome: 'Batel', uf: 'PR', regiao: 'Sul', peso: 0.9, equipe: ['Isabel Cardoso', 'João Vitor Reis'] },
  { nome: 'Boa Viagem', uf: 'PE', regiao: 'Nordeste', peso: 0.85, equipe: ['Karina Melo', 'Lucas Bandeira'] },
  { nome: 'Meireles', uf: 'CE', regiao: 'Nordeste', peso: 0.8, equipe: ['Marina Fontes', 'Nelson Braga'] },
  { nome: 'Asa Sul', uf: 'DF', regiao: 'Centro-Oeste', peso: 0.9, equipe: ['Olívia Serra', 'Paulo Krause'] },
  { nome: 'Umarizal', uf: 'PA', regiao: 'Norte', peso: 0.65, equipe: ['Renata Pinho', 'Sérgio Maia'] },
];

// serviço: [preço mín, preço máx, % de comissão, peso na demanda]
const SERVICOS = [
  ['Corte', 70, 130, 0.4, 30],
  ['Coloração', 190, 340, 0.35, 18],
  ['Escova', 60, 110, 0.4, 22],
  ['Manicure', 45, 85, 0.5, 20],
  ['Barba', 40, 75, 0.45, 12],
  ['Hidratação', 120, 220, 0.35, 10],
];

const PAGAMENTOS = [
  ['Pix', 38],
  ['Crédito', 32],
  ['Débito', 18],
  ['Dinheiro', 12],
];

const PRIMEIROS = ['Alice', 'Beatriz', 'Camila', 'Daniel', 'Eduardo', 'Fernanda', 'Gustavo', 'Helena', 'Igor', 'Juliana',
  'Kelly', 'Leandro', 'Mariana', 'Natália', 'Otávio', 'Patrícia', 'Rafael', 'Sofia', 'Thiago', 'Vanessa'];
const SOBRENOMES = ['Almeida', 'Barbosa', 'Cavalcanti', 'Duarte', 'Esteves', 'Farias', 'Gomes', 'Horta', 'Ibrahim',
  'Jardim', 'Klein', 'Loureiro', 'Machado', 'Nogueira', 'Oliveira', 'Peixoto', 'Queiroz', 'Ramos', 'Siqueira', 'Teixeira'];

// Crescimento por ano e sazonalidade por mês (dezembro e maio puxam a rede).
const CRESCIMENTO = { 2024: 1.0, 2025: 1.14, 2026: 1.27 };
const SAZONAL = [0.92, 0.88, 0.97, 0.99, 1.12, 1.0, 1.02, 1.0, 1.03, 1.05, 1.08, 1.3];

const linhas = [];
let ordem = 0;

for (let ano = 2024; ano <= 2026; ano++) {
  for (let mes = 1; mes <= 12; mes++) {
    if (ano === 2026 && mes > 3) break; // a série termina em março/2026
    const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    for (const u of UNIDADES) {
      const base = 5.2 * u.peso * CRESCIMENTO[ano] * SAZONAL[mes - 1];
      const n = Math.max(1, Math.round(base * (0.85 + rnd() * 0.3)));
      for (let i = 0; i < n; i++) {
        const dia = 1 + Math.floor(rnd() * diasNoMes);
        const [servico, min, max, pct] = pickWeighted(SERVICOS.map((s) => [s, s[4]]));
        const valor = min + rnd() * (max - min);
        // Reajuste anual acompanhando o crescimento da rede.
        const valorAno = valor * (1 + (ano - 2024) * 0.06);
        linhas.push({
          data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
          ordem: ordem++,
          unidade: u.nome,
          uf: u.uf,
          regiao: u.regiao,
          profissional: pick(u.equipe),
          servico,
          valor: valorAno,
          comissao_pct: pct,
          forma_pagamento: pickWeighted(PAGAMENTOS),
          cliente: `${pick(PRIMEIROS)} ${pick(SOBRENOMES)}`,
        });
      }
    }
  }
}

// Ordena por data (empate resolvido pela ordem de geração — estável) e numera.
linhas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.ordem - b.ordem));

const head = 'atendimento_id,data,unidade,uf,regiao,profissional,servico,valor,comissao_pct,comissao,forma_pagamento,cliente';
const csv = [head];
linhas.forEach((l, i) => {
  const valor = l.valor.toFixed(2);
  const comissao = (l.valor * l.comissao_pct).toFixed(2);
  csv.push(
    [
      'A' + String(i + 1).padStart(5, '0'),
      l.data,
      l.unidade,
      l.uf,
      l.regiao,
      l.profissional,
      l.servico,
      valor,
      l.comissao_pct.toFixed(2),
      comissao,
      l.forma_pagamento,
      l.cliente,
    ].join(','),
  );
});

fs.writeFileSync(OUT, csv.join('\n') + '\n', 'utf8');
console.log(`${OUT}: ${linhas.length} atendimentos (${linhas[0].data} → ${linhas[linhas.length - 1].data})`);
