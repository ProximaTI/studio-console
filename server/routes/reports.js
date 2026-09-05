// Relatórios spec-driven (F6) — /api/projects/:project/reports
import { Router } from 'express';
import { loadReports, getReport, reportStatus, saveReport, buildReport, absorbReport, promoteReport, reportsDir, clearBuildRecord } from '../reports.js';
import path from 'node:path';
import fs from 'node:fs';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const list = [];
    for (const r of loadReports(req.params.project)) {
      const st = await reportStatus(req.params.project, r);
      list.push({ slug: r.slug, name: r.spec?.name, title: r.spec?.title, valid: r.valid, state: st.state, pages: st.pages });
    }
    res.json({ reports: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/promote', (req, res) => {
  try {
    const r = promoteReport(req.params.project, req.body || {});
    res.status(r.error ? 400 : 200).json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const r = getReport(req.params.project, req.params.slug);
    if (!r) return res.status(404).json({ error: 'Relatório não encontrado' });
    const st = await reportStatus(req.params.project, r);
    res.json({ slug: r.slug, content: r.content, spec: r.spec, errors: r.errors, valid: r.valid, status: st });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:slug', (req, res) => {
  try {
    res.json(saveReport(req.params.project, req.params.slug, (req.body || {}).content));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:slug', (req, res) => {
  try {
    const safe = String(req.params.slug).replace(/[^a-zA-Z0-9_-]/g, '_');
    const f = path.join(reportsDir(req.params.project), safe + '.md');
    if (fs.existsSync(f)) fs.rmSync(f); // páginas ficam — viram soltas (posse acaba)
    clearBuildRecord(req.params.project, safe); // slug recriado nasce limpo (achado 6)
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:slug/build', async (req, res) => {
  try {
    const r = await buildReport(req.params.project, req.params.slug, req.body || {});
    res.status(r.error || r.errors ? 400 : 200).json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:slug/absorb', async (req, res) => {
  try {
    const r = await absorbReport(req.params.project, req.params.slug, req.body || {});
    res.status(r.error ? 400 : 200).json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
