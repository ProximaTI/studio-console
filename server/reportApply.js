// Aplicação de ReportPlan (F5.1, D31): pipeline extraído da rota para ser
// testável diretamente. Revalida → compila TUDO em memória → lint + políticas
// → sample-run de TODAS as queries → conflitos → gravação em DUAS FASES
// (.tmp → rename, D30) com rollback de MELHOR ESFORÇO na promoção — nunca
// prometa "transação atômica": queda de energia no meio dos renames ainda
// pode deixar estado misto; o que as duas fases garantem é que falha de
// compilação/validação/escrita não toca nenhum original.
import path from 'node:path';
import fs from 'node:fs';
import { loadCatalogs, factColumnsFor, checkPublishPolicies } from './semantic.js';
import { runQuery } from './db.js';
import { validateReportPlan } from '../shared/reportPlan.js';
import { compileReport } from '../shared/reportCompiler.js';
import { lintEvidenceCompat } from '../shared/evidenceLint.js';
import { parseBlocks } from '../shared/parser.js';
import { projectDirs } from './routes/projects.js';

const SAMPLE_CAP = 200; // backstop — os limites do plano já mantêm bem abaixo

/** Substitui templates por defaults p/ o sample-run (validação, não resultado). */
export function sampleize(sql, globalParams = []) {
  const def = Object.fromEntries(globalParams.map((p) => [p.name, p.default ?? '%']));
  return String(sql)
    .replace(/\$\{inputs\.(\w+)\.value\}/g, (_, n) => String(def[n] ?? '%'))
    .replace(/\$\{inputs\.(\w+)\.start\}/g, '1900-01-01')
    .replace(/\$\{inputs\.(\w+)\.end\}/g, '2100-01-01')
    .replace(/\$\{inputs\.(\w+)\}/g, (_, n) => String(def[n] ?? '%'))
    .replace(/\$\{params\.(\w+)\}/g, '%');
}

/**
 * Aplica um ReportPlan no projeto. Retornos:
 *  { errors }    — plano inválido (nada tocado)
 *  { error }     — falha de lint/política/amostra/gravação (nada mantido)
 *  { conflicts } — páginas existentes não cobertas por `overwrite` (nada gravado)
 *  { written, sampled } — sucesso
 */
/**
 * @param {{alsoWrite?: [{abs: string, content: string}]}} opts — arquivos
 * extras (ex.: a spec do relatório) que entram no MESMO staging de duas fases
 * das páginas (revisão F6, achado 2): ou tudo é promovido, ou nada fica.
 */
export async function applyReport(project, plan, overwrite = [], { alsoWrite = [] } = {}) {
  const entry = loadCatalogs(project).find((m) => m.valid && m.model === plan?.catalog);
  const factColumns = entry ? await factColumnsFor(project, entry.catalog.fact) : null;

  // 1) revalida — o plano pode ter sido editado no browser (D21)
  const errors = validateReportPlan(plan, { catalog: entry?.catalog || null, factColumns: factColumns || undefined });
  if (errors.length) return { errors };

  // 2) compila TUDO em memória (nada tocou o disco ainda)
  const files = compileReport(plan, { catalog: entry.catalog, hash: entry.hash, factColumns: factColumns || [] });

  // 3) lint + políticas por página
  for (const f of files) {
    const lintErrs = lintEvidenceCompat(f.content).filter((x) => x.severity === 'error');
    if (lintErrs.length) return { error: `Lint recusou ${f.path}: ${lintErrs.map((l) => l.message).join('; ')}` };
    const pol = checkPublishPolicies(project, f.content, plan.visibility);
    if (!pol.ok) return { error: pol.error };
  }

  // 4) sample-run de TODAS as queries (F5.1 — não só a primeira): pega
  //    catálogo/coluna quebrados em QUALQUER bloco antes de gravar.
  let sampled = 0;
  for (const f of files) {
    for (const b of parseBlocks(f.content).filter((x) => x.type === 'sql')) {
      if (++sampled > SAMPLE_CAP) return { error: `Plano excede o teto de ${SAMPLE_CAP} queries na validação de amostra — reduza páginas/blocos.` };
      const sql = sampleize(b.sql, plan.globalParams).replace(/;\s*$/, '');
      try {
        await runQuery(`select * from (${sql}) t limit 5`, project);
      } catch (e) {
        return { error: `A página ${f.path} falhou na execução de amostra (query "${b.name}"): ${e.message}` };
      }
    }
  }

  // 5) conflitos: sem cobertura explícita em `overwrite`, NADA é gravado
  const { pagesDir } = projectDirs(project);
  const alvo = (rel) => {
    const p = path.resolve(pagesDir, rel);
    if (p !== pagesDir && !p.startsWith(pagesDir + path.sep)) throw new Error('Caminho inválido: ' + rel);
    return p;
  };
  const conflicts = files.filter((f) => fs.existsSync(alvo(f.path)) && !overwrite.includes(f.path)).map((f) => f.path);
  if (conflicts.length) return { conflicts };

  // 6) FASE 1 (staging): escreve todos os .tmp (páginas + extras como a spec)
  //    — falha aqui não toca NENHUM original; só limpa os tmps.
  const destinos = [
    ...files.map((f) => ({ key: f.path, abs: alvo(f.path), content: f.content })),
    ...alsoWrite.map((a) => ({ key: a.abs, abs: a.abs, content: a.content })),
  ];
  const tmps = [];
  try {
    for (const d of destinos) {
      const p = d.abs + '.tmp';
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, d.content, 'utf8');
      tmps.push(p);
    }
  } catch (e) {
    for (const t of tmps) {
      try {
        fs.rmSync(t, { force: true });
      } catch {
        /* melhor esforço */
      }
    }
    return { error: `Falha ao preparar os arquivos (${e.message}) — nada foi alterado.` };
  }

  // 7) FASE 2 (promoção): SPEC PRIMEIRO (a fonte da verdade nunca fica para
  //    trás das páginas — revisão F6, achado 2), depois as páginas; rename
  //    por arquivo, com backup-in-memory; falha no meio restaura tudo em
  //    melhor esforço.
  const ordem = [...alsoWrite.map((a) => ({ key: a.abs, abs: a.abs })), ...files.map((f) => ({ key: f.path, abs: alvo(f.path) }))];
  const backups = new Map();
  const promovidos = [];
  try {
    for (const d of ordem) {
      backups.set(d.key, fs.existsSync(d.abs) ? fs.readFileSync(d.abs, 'utf8') : null);
      fs.renameSync(d.abs + '.tmp', d.abs);
      promovidos.push(d);
    }
  } catch (e) {
    for (const d of promovidos) {
      const prev = backups.get(d.key);
      try {
        if (prev === null) fs.rmSync(d.abs, { force: true });
        else fs.writeFileSync(d.abs, prev, 'utf8');
      } catch {
        /* melhor esforço na restauração */
      }
    }
    for (const d of ordem) {
      try {
        fs.rmSync(d.abs + '.tmp', { force: true });
      } catch {
        /* tmp órfão é inofensivo, mas tentamos */
      }
    }
    return { error: `Falha ao promover os arquivos (${e.message}) — alterações revertidas em melhor esforço.` };
  }
  return { written: files.map((f) => f.path), sampled };
}
