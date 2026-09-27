import { Router } from 'express';
import { readSettings, publicSettings, applySettingsUpdate } from '../settings.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(publicSettings(readSettings()));
});

router.put('/', (req, res) => {
  res.json(publicSettings(applySettingsUpdate(req.body)));
});

export default router;
