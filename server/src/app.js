import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Route imports
import plansRouter from './routes/plans.js';
import kpisRouter from './routes/kpis.js';
import employeesRouter from './routes/employees.js';
import rolesRouter from './routes/roles.js';
import territoriesRouter from './routes/territories.js';
import productsRouter from './routes/products.js';
import customersRouter from './routes/customers.js';
import slabsRouter from './routes/slabs.js';
import rulesRouter from './routes/rules.js';
import calculationRouter from './routes/calculation.js';
import simulationRouter from './routes/simulation.js';
import approvalsRouter from './routes/approvals.js';
import dashboardRouter from './routes/dashboard.js';
import auditRouter from './routes/audit.js';
import lookupsRouter from './routes/lookups.js';
import eventsRouter from './routes/events.js';
import perfectStoreRouter from './routes/perfectStore.js';
import tagsRouter from './routes/tags.js';
import currenciesRouter from './routes/currencies.js';
import bulkImportRouter from './routes/bulkImport.js';
import tripsRouter from './routes/trips.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/plans', plansRouter);
app.use('/api/kpis', kpisRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/territories', territoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/slabs', slabsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/calculation', calculationRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/audit', auditRouter);
app.use('/api/lookups', lookupsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/perfect-store', perfectStoreRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/currencies', currenciesRouter);
app.use('/api/bulk', bulkImportRouter);
app.use('/api/trips', tripsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static client files in production (local only — Vercel serves static files directly)
if (process.env.VERCEL !== '1') {
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

export default app;
