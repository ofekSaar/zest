import request from 'supertest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 3000;
const DIST = path.resolve(__dirname, '../dist/index.js');
let serverProcess: any;

beforeAll((done) => {
  const cmd = 'node';
  const args = [DIST];
  serverProcess = spawn(cmd, args, { env: { ...process.env, SERVER_PORT: `${PORT}`, LOG_PATH: './test.log' } });
  serverProcess.stdout.on('data', (d: Buffer) => {
    const s = d.toString();
    if (s.includes('listening')) done();
  });
  serverProcess.stderr.on('data', (d: Buffer) => {
    console.error(d.toString());
  });
});

afterAll(() => {
  if (serverProcess) serverProcess.kill();
  try { fs.unlinkSync('./test.log'); } catch(e){}
});

test('POST /tasks enqueues and returns id, GET /statistics returns metrics', async () => {
  const base = `http://localhost:${PORT}`;
  const res = await request(base).post('/tasks').send({ message: 'hello test' });
  expect(res.status).toBe(201);
  expect(res.body.id).toBeDefined();
  // wait a bit for processing
  await new Promise(r => setTimeout(r, 1000));
  const stats = await request(base).get('/statistics');
  expect(stats.status).toBe(200);
  expect(stats.body.queueLength).toBeGreaterThanOrEqual(0);
  expect(typeof stats.body.processedTasks).toBe('number');
});
