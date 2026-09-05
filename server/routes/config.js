// Configuração do projeto (/api/projects/:project/config) + segredos
// (/api/projects/:project/secrets — WRITE-ONLY: valores jamais saem daqui).
import { Router } from 'express';
import {
  readProjectConfigText,
  writeProjectConfigText,
  validateProjectConfig,
  writeSecret,
  listSecretRefs,
} from '../projectConfig.js';

export const configRouter = Router({ mergeParams: true });
export const secretsRouter = Router({ mergeParams: true });

configRouter.get('/', (req, res) => {
  const text = readProjectConfigText(req.params.project);
  const { errors, config } = validateProjectConfig(text || '');
  res.json({ content: text, config: config || {}, errors });
});

configRouter.put('/', (req, res) => {
  const r = writeProjectConfigText(req.params.project, String((req.body || {}).content ?? ''));
  res.status(r.ok ? 200 : 400).json(r);
});

// Segredos: PUT grava por ref; GET lista SÓ os nomes das refs (nunca valores).
secretsRouter.get('/', (req, res) => {
  res.json({ refs: listSecretRefs(req.params.project) });
});

secretsRouter.put('/', (req, res) => {
  const { ref, value } = req.body || {};
  if (req.params.project === 'scratch') return res.status(400).json({ error: 'Segredos exigem projeto nomeado — promova o rascunho primeiro.' });
  if (!ref || !value) return res.status(400).json({ error: 'ref e value são obrigatórios' });
  writeSecret(req.params.project, String(ref), String(value));
  res.json({ ok: true, ref: String(ref) }); // o valor NÃO volta
});
