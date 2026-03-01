import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { diagramRoutes } from './routes/diagrams.js';
import { sharingRoutes } from './routes/sharing.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // Plugins
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET ?? 'mavisdraw-cookie-secret',
  });

  // Health check
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register routes
  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(diagramRoutes);
  await app.register(sharingRoutes);

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error);
    reply.code(error.statusCode ?? 500).send({
      error: error.message ?? 'Internal server error',
    });
  });

  return app;
}
