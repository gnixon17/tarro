import express from 'express';
import { apiRouter } from '../server/routes';

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

export default app;
