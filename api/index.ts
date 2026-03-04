import express from 'express';
import { apiRouter } from '../server/routes';

const app = express();
app.use(express.json());
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled API Error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error', 
    message: err.message || 'Unknown error' 
  });
});

export default app;
