// Snapshot 📦: links internos pela tabela de rotas, parametrizadas sem destino
// (o 📦 não as tem), e dropdown múltiplo congelado como LISTA — tratá-lo como
// escolha única gerava `in (I…)` sem aspas nas combinações pré-computadas.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { resolveInternalHref } from '../shared/publishRender.js';
import { buildPublishedHtml } from '../server/publish/snapshot.js';
import { registerProjectSources, PROJECTS_DIR } from '../server/db.js';

const pagePackages = { '': 'index', comparativo: 'comparativo', 'a/b': 'a-b', prof: 'prof-index' };
const paramPages = { instituicao: 'institution_id', prof: 'prof' };

describe('resolveInternalHref', () => {
  const snap = { hrefMode: 'snapshot', pagePackages, paramPages };
  const app = { hrefMode: 'app', pagePackages, paramPages };

  it('📦: páginas comuns viram o .html irmão; âncora e query vão junto', () => {
    expect(resolveInternalHref('/', snap)).toBe('./index.html');
    expect(resolveInternalHref('/comparativo/', snap)).toBe('./comparativo.html');
    expect(resolveInternalHref('/a/b/#sec', snap)).toBe('./a-b.html#sec');
    expect(resolveInternalHref('/prof/', snap)).toBe('./prof-index.html');
  });

  it('📦: pasta parametrizada, com ou sem valor, fica sem destino (link desligado)', () => {
    expect(resolveInternalHref('/instituicao/', snap)).toBeNull();
    expect(resolveInternalHref('/instituicao/I123/', snap)).toBeNull();
  });

  it('☁: parametrizada sem valor abre o app no padrão; com valor, via ?param=', () => {
    expect(resolveInternalHref('/instituicao/', app)).toBe('../instituicao-app/app.html');
    expect(resolveInternalHref('/instituicao/I123/', app)).toBe('../instituicao-app/app.html?institution_id=I123');
    expect(resolveInternalHref('/comparativo/', app)).toBe('../comparativo-app/app.html');
  });

  it('externo e âncora local não são tocados', () => {
    expect(resolveInternalHref('https://x.org/', snap)).toBeNull();
    expect(resolveInternalHref('//cdn/x', snap)).toBeNull();
    expect(resolveInternalHref('#topo', snap)).toBeNull();
  });
});

describe('snapshot com dropdown múltiplo (projeto exemplo)', () => {
  beforeAll(async () => {
    await registerProjectSources('exemplo', path.join(PROJECTS_DIR, 'exemplo', 'sources'));
  });

  const md = `\`\`\`sql unidades
select distinct unidade from comissoes order by 1
\`\`\`

\`\`\`sql fat
select unidade, sum(valor) as faturamento from comissoes where unidade in (\${inputs.us}) group by 1 order by 1
\`\`\`

\`\`\`sql por_forma
select forma_pagamento, count(*) as n from comissoes where forma_pagamento = '\${inputs.forma.value}' group by 1
\`\`\`

<Dropdown data={unidades} name=us value=unidade multiple=true defaultValue={["Savassi", "Batel", "Inexistente"]}/>

<Dropdown name=forma defaultValue="pix">
  <DropdownOption value="cartao" valueLabel="Cartão" />
  <DropdownOption value="pix" valueLabel="Pix" />
</Dropdown>

<DataTable data={fat}/>
`;

  it('múltiplo congela como lista e a query roda; simples respeita defaultValue', async () => {
    const html = await buildPublishedHtml('exemplo', 'teste.md', md, {}, null, path.join(PROJECTS_DIR, 'exemplo', 'pages'));
    const P = JSON.parse(html.match(/const P = (\{[\s\S]*?\});\nconst md =/)[1]);
    expect(P.freeDefaults.us).toEqual(['Savassi', 'Batel']);
    expect(P.inputNames).toEqual(['forma']); // o múltiplo não entra nas combinações
    expect(P.defaults.forma).toBe('pix');
    expect(P.staticData.fat.map((r) => r.unidade).sort()).toEqual(['Batel', 'Savassi']);
    expect(P.paramPages).toMatchObject({ unidade: 'unidade', prof: 'prof' });
    expect(P.pagePackages.prof).toBe('prof-index');
  });
});
