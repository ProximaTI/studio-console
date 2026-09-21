import { describe, it, expect } from 'vitest';
import { buildPointMapOption, UF_CENTROIDS } from '../shared/mapOption.js';
import { styleById, compileViewblock } from '../shared/viewStyles.js';
import { lintEvidenceCompat } from '../shared/evidenceLint.js';

// O `areamap` colore a ÁREA: uma contagem absoluta vira mapa do tamanho dos
// estados e da população. "Artigos por UF" acende São Paulo porque São Paulo é
// grande, não porque a taxa é alta — e os quatro areamap em relatórios reais
// deste acervo mapeiam contagem bruta.
//
// A saída registrada no `breaks` era "use uma métrica normalizada": um conselho,
// não um destino. Com o pointmap, passa a ser um id de estilo — que é o que
// tests/styleMenu.test.js consegue validar.
const SOURCE = { name: 'f', columns: [{ name: 'uf', type: 'VARCHAR' }] };
const opt = (rows, attrs = {}) =>
  buildPointMapOption({ rows, attrs: { areaCol: 'uf', value: 'n', ...attrs }, palette: ['#a63d5f'], dark: false, mapName: 'brazil' });

describe('centróides das UFs', () => {
  it('as 27 unidades federativas, e nenhuma a mais', () => {
    expect(Object.keys(UF_CENTROIDS)).toHaveLength(27);
    for (const uf of ['AC', 'DF', 'SP', 'RS', 'RR']) expect(UF_CENTROIDS[uf], uf).toBeTruthy();
  });

  it('todos caem dentro do Brasil continental', () => {
    for (const [uf, [lon, lat]] of Object.entries(UF_CENTROIDS)) {
      expect(lon, `${uf} longitude`).toBeGreaterThan(-75);
      expect(lon, `${uf} longitude`).toBeLessThan(-32);
      expect(lat, `${uf} latitude`).toBeGreaterThan(-34);
      expect(lat, `${uf} latitude`).toBeLessThan(6);
    }
  });
});

describe('a marca: área proporcional ao valor', () => {
  // O erro clássico do mapa de bolha é escalar o RAIO com o valor — a área vai
  // ao quadrado e a diferença é exagerada. Somar um piso ao raio é o erro
  // gêmeo, mais discreto: parece inofensivo e achata a proporção.
  it('razão de ÁREA igual à razão de VALOR', () => {
    const o = opt([{ uf: 'SP', n: 100 }, { uf: 'AC', n: 4 }]);
    const s = o.series[0];
    const [sp, ac] = s.data.map((d) => s.symbolSize(d.value));
    expect((sp / ac) ** 2).toBeCloseTo(25, 1);
  });

  it('o valor entra na 3ª posição, depois de lon e lat', () => {
    const d = opt([{ uf: 'DF', n: 7 }]).series[0].data[0];
    expect(d.name).toBe('DF');
    expect(d.value).toEqual([...UF_CENTROIDS.DF, 7]);
  });

  it('sigla desconhecida SOME — não vira ponto no meio do Atlântico', () => {
    const o = opt([{ uf: 'SP', n: 1 }, { uf: 'XX', n: 99 }, { uf: null, n: 5 }]);
    expect(o.series[0].data.map((d) => d.name)).toEqual(['SP']);
  });

  it('sigla minúscula e com espaço ainda casa', () => {
    expect(opt([{ uf: ' sp ', n: 1 }]).series[0].data[0].name).toBe('SP');
  });

  it('valor não numérico não vira ponto', () => {
    expect(opt([{ uf: 'SP', n: 'muito' }]).series[0].data).toHaveLength(0);
  });

  it('desenha sobre o geo, não como série de mapa — é o que permite o scatter', () => {
    const o = opt([{ uf: 'SP', n: 1 }]);
    expect(o.geo.map).toBe('brazil');
    expect(o.series[0].type).toBe('scatter');
    expect(o.series[0].coordinateSystem).toBe('geo');
  });
});

describe('contrato do estilo pointmap', () => {
  const vb = (over = {}) => ({
    v: 1,
    id: 'vb_p1',
    source: { kind: 'semantic', name: 'm' },
    queries: [{ name: 'vb_p1', sql: null }],
    dims: [{ dim: 'uf', alias: 'uf', column: 'uf' }],
    metrics: [{ name: 'apcs', alias: 'apcs', label: 'APCs', fmt: 'num0' }],
    params: [],
    style: 'pointmap',
    children: [],
    ...over,
  });

  it('mesmo contrato geográfico do areamap — trocar de estilo é trocar uma palavra', () => {
    const p = styleById('pointmap');
    const a = styleById('areamap');
    expect(p.requires(vb(), SOURCE).ok).toBe(true);
    expect(a.requires(vb(), SOURCE).ok).toBe(true);
    const semGeo = vb({ dims: [{ dim: 'servico', alias: 'servico', column: 'servico' }] });
    expect(p.requires(semGeo, SOURCE).ok).toBe(false);
  });

  it('compila para <PointMap> com o fmt da métrica', () => {
    const out = compileViewblock(vb(), { vb: vb(), source: SOURCE, baseSql: 'select 1' });
    expect(out).toContain('<PointMap data={vb_p1} areaCol=uf value=apcs fmt=num0 showLabels=true/>');
  });

  // Era o único `breaks[].use` que não era id de estilo.
  it('o break do areamap agora aponta para um ESTILO', () => {
    const b = styleById('areamap').breaks[0];
    expect(b.use).toBe('pointmap');
    expect(styleById(b.use)).toBeTruthy();
    // e o caminho de volta existe: taxa se lê melhor na cor da área
    expect(styleById('pointmap').breaks.map((x) => x.use)).toContain('areamap');
  });

  // O nome existe no Evidence com OUTRO contrato (lat/lon por linha). Dizer
  // "portável" ali seria promessa falsa; dizer "desconhecido" seria mentira.
  it('o linter registra a divergência de contrato, sem erro', () => {
    const f = lintEvidenceCompat('# t\n\n<PointMap data={q} areaCol=uf value=n/>\n');
    expect(f).toHaveLength(1);
    expect(f[0].code).toBe('render-diff');
    expect(f[0].level).toBe('info');
    expect(f[0].message).toMatch(/LATITUDE e LONGITUDE/);
  });
});
