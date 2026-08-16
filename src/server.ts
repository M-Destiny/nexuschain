/**
 * NexusChain HTTP Server
 * Exposes Prometheus metrics and health check endpoints for deployment platforms.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { Registry, collectDefaultMetrics } from 'prom-client';
import type { NexusChainConfig } from './types.js';

const app = express();
const PORT = process.env.PORT ?? 8080;

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics();

// Shared metrics registry (also used by Marketplace)
const metricsRegistry = new Registry();

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '0.1.0',
  });
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    const metrics = await metricsRegistry.metrics();
    res.send(metrics);
  } catch (err) {
    res.status(500).send('Error generating metrics');
  }
});

// Optional: expose a simple API for agent listing (read-only)
app.get('/api/agents', (_req: Request, res: Response) => {
  // This would need a real registry instance; returning placeholder for now
  res.json({
    message: 'Use the NexusChain CLI or SDK for full functionality',
    endpoints: {
      health: '/health',
      metrics: '/metrics',
    },
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

function createServer(_config?: NexusChainConfig): express.Express {
  // If config provided, we could initialize real services here
  // For now, just return the app with default metrics
  return app;
}

async function startServer(config?: NexusChainConfig): Promise<void> {
  const server = createServer(config);
  server.listen(PORT, () => {
    console.log(`🌐 NexusChain server listening on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Metrics: http://localhost:${PORT}/metrics`);
  });
}

// Auto-start if run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export { app, createServer, startServer, metricsRegistry };