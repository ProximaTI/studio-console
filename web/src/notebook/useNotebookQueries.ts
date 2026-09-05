import { useEffect, useMemo, useState } from 'react';
import { runQuery } from '../api';
import { applyTemplates } from '../render/interpolate';
import { Cell } from './cells';

export type RunState = { columns?: string[]; rows?: any[]; error?: string; loading?: boolean };

// Execução das queries do notebook: resultado por célula (runs), dataMap
// acumulado para a interpolação inline {q[0].col} e o auto-run debounced —
// sem o debounce, cada tecla digitada re-executava tudo.
export function useNotebookQueries(cells: Cell[], inputsForSql: Record<string, any>, params: Record<string, any>, project?: string) {
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [dataMap, setDataMap] = useState<Record<string, any[]>>({});

  async function runCell(c: Cell) {
    if (c.type !== 'sql') return;
    setRuns((r) => ({ ...r, [c.id]: { loading: true } }));
    const res = await runQuery(applyTemplates(c.source, inputsForSql, params), project);
    setRuns((r) => ({ ...r, [c.id]: { ...res, loading: false } }));
    if (!res.error && c.name) setDataMap((m) => ({ ...m, [c.name as string]: res.rows || [] }));
  }
  async function runAll() {
    for (const c of cells) if (c.type === 'sql') await runCell(c);
  }

  const allSqlKey = useMemo(
    () => cells.filter((c) => c.type === 'sql').map((c) => c.name + ':' + c.source).join('|'),
    [cells]
  );
  const paramsKey = JSON.stringify(params);
  const inputsKey = JSON.stringify(inputsForSql);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const dm: Record<string, any[]> = {};
      for (const c of cells) {
        if (c.type === 'sql' && c.name) {
          const r = await runQuery(applyTemplates(c.source, inputsForSql, params), project);
          if (!r.error) dm[c.name] = r.rows || [];
        }
      }
      if (!cancelled) setDataMap(dm);
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSqlKey, paramsKey, inputsKey]);

  const resetRuns = () => setRuns({});
  return { runs, dataMap, runCell, runAll, resetRuns };
}
