// Catálogos semânticos do projeto (/api/projects/:project/semantic).
// Espaço do ARQUITETO (spec F3 §2): o analista só consome via Passo 1 do wizard.
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { semanticDir, loadCatalogs, catalogHash, factColumnsFor, suggestRelations, applyRelations } from '../semantic.js';
import { validateCatalog } from '../../shared/semanticCatalog.js';

const router = Router({ mergeParams: true });

function safeFile(project, rel) {
  const dir = semanticDir(project);
  const f = path.resolve(dir, String(rel || ''));
  if (f !== dir && !f.startsWith(dir + path.sep)) throw new Error('Caminho inválido');
  return f;
}

router.get('/', (req, res) => {
  try {
    res.json({ models: loadCatalogs(req.params.project) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/file', (req, res) => {
  try {
    const f = safeFile(req.params.project, req.query.path);
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'Modelo não encontrado' });
    res.json({ content: fs.readFileSync(f, 'utf8') });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT salva SEMPRE (o arquiteto itera) e devolve os erros de validação —
// o editor mostra inline; um modelo inválido não aparece como fonte no wizard.
// F4 frente F: com a fonte registrada, a validação confere colunas REAIS
// (erro com caminho + sugestão de coluna próxima); sem ela, aviso e segue.
router.put('/file', async (req, res) => {
  try {
    const { path: rel, content } = req.body || {};
    const f = safeFile(req.params.project, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content ?? '', 'utf8');
    const model = loadCatalogs(req.params.project).find((m) => m.file === path.basename(f));
    let errors = model?.errors || [];
    let notice;
    if (model && errors.length === 0) {
      let catalog = null;
      try {
        catalog = parseYaml(content ?? '');
      } catch {
        /* já validado acima */
      }
      const cols = catalog ? await factColumnsFor(req.params.project, catalog.fact) : null;
      if (cols) errors = validateCatalog(catalog, cols);
      else notice = 'fonte não registrada — validação de colunas adiada';
    }
    res.json({ ok: true, hash: catalogHash(content ?? ''), errors, ...(notice ? { notice } : {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// F4 frente H: sondas determinísticas (FD dim→dim + cardinalidade de join) →
// PROPOSTAS com evidência. Nada é gravado aqui — ratificação em apply-relations.
router.post('/:model/suggest-relations', async (req, res) => {
  try {
    res.json(await suggestRelations(req.params.project, req.params.model));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:model/apply-relations', (req, res) => {
  try {
    res.json(applyRelations(req.params.project, req.params.model, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/file', (req, res) => {
  try {
    const f = safeFile(req.params.project, req.query.path);
    if (fs.existsSync(f)) fs.rmSync(f);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
