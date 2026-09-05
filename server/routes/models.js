// Models (queries SQL reutilizáveis) ESCOPADOS por projeto — montado em
// /api/projects/:project/models. Armazenados em projects/<p>/models/*.json.
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { PROJECTS_DIR } from '../db.js';

const router = Router({ mergeParams: true });

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

function modelsDir(project) {
  const safe = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(PROJECTS_DIR, safe, 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const fileFor = (project, id) => path.join(modelsDir(project), slug(id) + '.json');

router.get('/', (req, res) => {
  const dir = modelsDir(req.params.project);
  const models = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  res.json({ models });
});

router.post('/', (req, res) => {
  const { name, description = '', sql = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  const model = { id: slug(name), name, description, sql, lastRun: null };
  fs.writeFileSync(fileFor(req.params.project, model.id), JSON.stringify(model, null, 2));
  res.json({ model });
});

router.put('/:id', (req, res) => {
  const file = fileFor(req.params.project, req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Model não encontrado' });
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  const upd = { ...cur, ...req.body, id: cur.id };
  fs.writeFileSync(file, JSON.stringify(upd, null, 2));
  res.json({ model: upd });
});

router.delete('/:id', (req, res) => {
  const file = fileFor(req.params.project, req.params.id);
  if (fs.existsSync(file)) fs.rmSync(file);
  res.json({ ok: true });
});

export default router;
