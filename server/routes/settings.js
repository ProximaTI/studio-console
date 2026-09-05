import { Router } from 'express';
import { readSettings, writeSettings } from '../settings.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(readSettings());
});

router.put('/', (req, res) => {
  res.json(writeSettings(req.body));
});

export default router;
