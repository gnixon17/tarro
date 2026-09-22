import 'dotenv/config';
import express from 'express';
import { apiRouter } from './api/_routes';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  // Loopback by default. This server holds a brokerage OAuth secret and refresh
  // token behind an API with no login, so binding every interface would hand
  // the whole LAN an authenticated broker session. Opt in with HOST if you
  // really mean to expose it, and put auth in front of it if you do.
  const HOST = process.env.HOST || '127.0.0.1';

  // Parse JSON bodies
  app.use(express.json());

  // API Routes
  app.use('/api', apiRouter);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
      console.warn(
        `WARNING: bound to ${HOST}, so this API is reachable beyond this machine. It has no authentication.`,
      );
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
