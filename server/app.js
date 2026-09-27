// Montagem do app Express, separada do listen: o entrypoint (index.js) sobe o
// servidor; os testes criam o app em porta efêmera e o exercitam por HTTP.
import express from 'express';
import queryRouter from './routes/query.js';
import projectsRouter from './routes/projects.js';
import settingsRouter from './routes/settings.js';
import aiRouter from './routes/ai.js';
import agentRouter from './routes/agent.js';
import reportsRouter from './routes/reports.js';
import connectionsRouter from './routes/connections.js';
import { hostGuard, requireToken } from './auth.js';

export const PROJECT_NAME = /^[A-Za-z0-9_-]+$/;

export function createApp({ token, allowedHosts } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Sem cors(): o console chega pelo proxy do Vite (mesma origem). Qualquer
  // outra origem fica sem Access-Control-Allow-Origin — o navegador não lê.
  app.use('/api', hostGuard(allowedHosts));
  app.use('/api', requireToken(token));
  app.use(express.json({ limit: '5mb' }));

  // Nome de projeto vira caminho em disco em vários lugares: um formato só, e
  // checado uma vez para TODAS as rotas /api/projects/:project/... (inclusive
  // %2F decodificado pelo Express dentro do parâmetro).
  app.use('/api/projects/:project', (req, res, next) => {
    if (PROJECT_NAME.test(req.params.project)) return next();
    res.status(400).json({ error: 'Nome de projeto inválido' });
  });

  app.use('/api/query', queryRouter);
  app.use('/api/projects/:project/agent', agentRouter); // F5: planejamento de relatório
  app.use('/api/projects/:project/reports', reportsRouter); // F6: specs de relatório
  app.use('/api/projects', projectsRouter);
  app.use('/api/connections', connectionsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/ai', aiRouter);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  // Erro final: JSON curto, sem stack nem caminho do servidor (o handler padrão
  // do Express devolve HTML com stack trace fora de produção).
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido no corpo da requisição' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Corpo da requisição grande demais' });
    if (err?.code === 'UPLOAD_REJECTED') return res.status(400).json({ error: err.message });
    const status = Number(err?.status || err?.statusCode);
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'Requisição inválida' });
    console.error('[studio-console]', err);
    res.status(500).json({ error: 'Erro interno' });
  });

  return app;
}
