import { Router } from 'express';
import { runQuery } from '../db.js';

const router = Router();

// Executa SQL ad-hoc no schema do projeto (default: scratch).
// Erros voltam em 200 com { error } para a UI exibir inline.
router.post('/', async (req, res) => {
  const { sql, project } = req.body || {};
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL vazio' });
  try {
    res.json(await runQuery(sql, project || 'scratch'));
  } catch (e) {
    res.json({ error: e.message });
  }
});

export default router;
