// Fontes de dados ESCOPADAS por projeto (montado em /api/projects/:project/sources).
// Arquivos vão para projects/<p>/sources/ e viram VIEWs no schema proj_<slug>.
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { PROJECTS_DIR, registerSource, listSources, dropSource, sourceNameFromFile } from '../db.js';
import { sourceFreshness } from '../materialize.js';

const router = Router({ mergeParams: true });

function sourcesDir(project) {
  const safe = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(PROJECTS_DIR, safe, 'sources');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, sourcesDir(req.params.project)),
  filename: (_req, file, cb) => cb(null, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
});
const upload = multer({ storage });

router.get('/', async (req, res) => {
  try {
    // Frescor (spec Fontes §5): mtime do parquet + staleness das materializadas.
    const fresh = sourceFreshness(req.params.project);
    const sources = (await listSources(req.params.project)).map((s) => ({ ...s, ...(fresh[s.name] || {}) }));
    res.json({ sources });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const name = await registerSource(req.file.path, null, req.params.project);
    res.json({ name });
  } catch (e) {
    res.json({ error: e.message });
  }
});

router.delete('/:name', async (req, res) => {
  try {
    await dropSource(req.params.name, req.params.project);
    const dir = sourcesDir(req.params.project);
    for (const f of fs.readdirSync(dir)) {
      if (sourceNameFromFile(f) === req.params.name) fs.rmSync(path.join(dir, f));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
