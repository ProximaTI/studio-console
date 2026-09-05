import express from 'express';
import cors from 'cors';
import { registerAllProjects } from './db.js';
import queryRouter from './routes/query.js';
import projectsRouter from './routes/projects.js';
import settingsRouter from './routes/settings.js';
import aiRouter from './routes/ai.js';
import agentRouter from './routes/agent.js';
import reportsRouter from './routes/reports.js';
import connectionsRouter from './routes/connections.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api/query', queryRouter);
app.use('/api/projects/:project/agent', agentRouter); // F5: planejamento de relatório
app.use('/api/projects/:project/reports', reportsRouter); // F6: specs de relatório
app.use('/api/projects', projectsRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// API_PORT dedicada: PORT genérica pode vir do ambiente (ex.: harness de preview)
// apontando para a porta do Vite, o que colocaria a API no lugar errado.
const PORT = process.env.API_PORT || 3001;
registerAllProjects()
  .then(() => app.listen(PORT, () => console.log(`[studio-console] API em http://localhost:${PORT}`)))
  .catch((err) => {
    console.error('Erro ao iniciar DuckDB:', err);
    process.exit(1);
  });
