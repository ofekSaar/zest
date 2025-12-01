import express from 'express';
import dotenv from 'dotenv';
import { TaskManager } from './taskManager';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

dotenv.config();

const PORT = process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 3000;

const app = express();
app.use(express.json());

const swaggerDocument = YAML.load('./docs/openapi.yaml');
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));


const manager = new TaskManager();

app.post('/tasks', async (req, res) => {
  const { message } = req.body || {};
  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message is required and must be a string' });
  }
  const id = manager.createTask(message);
  res.status(201).json({ id });
});

app.get('/statistics', (req, res) => {
  res.json(manager.getStatistics());
});

app.listen(PORT, () => {
  console.log(`Task service listening on port ${PORT}`);
  console.log(`Docs: http://localhost:${PORT}/docs`);
});
