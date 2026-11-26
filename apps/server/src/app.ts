import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { diagramRoutes } from './routes/diagrams.js';
import { sharingRoutes } from './routes/sharing.js';
import { githubRoutes } from './routes/github.js';
import { agentRoutes } from './routes/agent.js';
import { commentRoutes } from './routes/comments.js';
import { tourRoutes } from './routes/tours.js';
import { workspaceRoutes } from './routes/workspaces.js';
import {
  createHocuspocusServer,
  persistOpenDocuments,
  type SocketGate,
} from './ws/hocuspocus.js';

/** Largest single WebSocket message (a big pasted image is a few MB). */
const WS_MAX_PAYLOAD = 16 * 1024 * 1024;
/** Bytes a socket may send before any document on it has authenticated. */
const WS_PRE_AUTH_LIMIT = 256 * 1024;
const WS_AUTH_TIMEOUT_MS = 15_000;
import type { Hocuspocus } from '@hocuspocus/server';

declare module 'fastify' {
  interface FastifyInstance {
    hocuspocus: Hocuspocus;
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
    // Behind a load balancer (Render, Fly, nginx) the client address is in
    // X-Forwarded-For; without this every user shares the proxy's IP for
    // rate limiting
    trustProxy: config.trustProxy,
  });

  // Plugins
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  await app.register(cookie, {
    secret: config.cookieSecret,
  });

  // Diagram updates carry inline images, but nothing legitimate comes close
  // to ws's 100MB default; an unauthenticated client could otherwise make the
  // server buffer huge messages (Hocuspocus queues them until auth)
  await app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD } });

  // Create Hocuspocus server for Y.js collaboration; routes use it to write
  // into live documents instead of racing them
  const hocuspocus = createHocuspocusServer();
  app.decorate('hocuspocus', hocuspocus);
  // Live edits are persisted on a debounce; flush them before shutting down
  app.addHook('onClose', async () => {
    await persistOpenDocuments(hocuspocus);
  });

  // WebSocket route for collaboration — room per diagram
  app.get('/collaboration', { websocket: true }, (socket, request) => {
    // Until a document on this socket authenticates, only a little data is
    // allowed, and only for a little while
    const gate: SocketGate = { authenticated: false };
    let preAuthBytes = 0;
    const authTimer = setTimeout(() => {
      if (!gate.authenticated) socket.close(4401, 'Authentication timeout');
    }, WS_AUTH_TIMEOUT_MS);
    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (gate.authenticated) return;
      preAuthBytes += Array.isArray(data)
        ? data.reduce((n, b) => n + b.byteLength, 0)
        : data.byteLength;
      if (preAuthBytes > WS_PRE_AUTH_LIMIT) socket.close(1009, 'Too much data before authentication');
    });
    socket.on('close', () => clearTimeout(authTimer));
    hocuspocus.handleConnection(socket, request.raw, { gate });
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
  await app.register(githubRoutes);
  await app.register(agentRoutes);
  await app.register(commentRoutes);
  await app.register(tourRoutes);
  await app.register(workspaceRoutes);

  // Global error handler
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    app.log.error(error);
    reply.code(error.statusCode ?? 500).send({
      error: error.message ?? 'Internal server error',
    });
  });

  return app;
}
