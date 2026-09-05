// Menu global "Conexões" (DELTA §2) — nível da instalação, espaço do arquiteto.
// Senha entra write-only e NUNCA é exibida de volta (só substituível).
import { Router } from 'express';
import {
  readConnections,
  readConnectionsText,
  writeConnectionsText,
  upsertConnection,
  deleteConnection,
  writeConnectionSecret,
  hasConnectionSecret,
  testConnection,
  previewQuery,
  connectionUsage,
} from '../connections.js';

const router = Router();

router.get('/', (_req, res) => {
  const conns = readConnections();
  const list = Object.entries(conns).map(([name, c]) => ({
    name,
    ...c,
    hasSecret: hasConnectionSecret(name), // booleano — o valor jamais sai
    usage: connectionUsage(name),
  }));
  res.json({ connections: list, content: readConnectionsText() });
});

router.put('/', (req, res) => {
  const r = writeConnectionsText(String((req.body || {}).content ?? ''));
  res.status(r.ok ? 200 : 400).json(r);
});

router.put('/:name', (req, res) => {
  const { type, host, port, database, user, path: p } = req.body || {};
  const def = Object.fromEntries(Object.entries({ type, host, port, database, user, path: p }).filter(([, v]) => v !== undefined && v !== ''));
  const r = upsertConnection(req.params.name, def);
  res.status(r.ok ? 200 : 400).json(r);
});

router.delete('/:name', (req, res) => {
  // A UI mostra usage e confirma ANTES; aqui deletamos e devolvemos o que dependia.
  const usage = connectionUsage(req.params.name);
  deleteConnection(req.params.name);
  res.json({ ok: true, orphaned: usage });
});

router.get('/:name/usage', (req, res) => {
  res.json({ usage: connectionUsage(req.params.name) });
});

// Senha/credencial: write-only (o valor não volta em NENHUMA rota).
router.put('/:name/secret', (req, res) => {
  const { value } = req.body || {};
  if (!value) return res.status(400).json({ error: 'value obrigatório' });
  writeConnectionSecret(req.params.name, String(value));
  res.json({ ok: true });
});

router.post('/:name/test', async (req, res) => {
  try {
    res.json(await testConnection(req.params.name));
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ▶ Preview da query de extração (100 linhas) — valida antes de materializar.
router.post('/:name/preview', async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || !String(query).trim()) return res.status(400).json({ error: 'query obrigatória' });
    res.json(await previewQuery(req.params.name, String(query)));
  } catch (e) {
    res.json({ error: e.message });
  }
});

export default router;
