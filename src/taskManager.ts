import os from 'os';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

export const config = {
  TASK_SIMULATED_DURATION: Number(process.env.TASK_SIMULATED_DURATION ?? 500),
  TASK_SIMULATED_ERROR_PERCENTAGE: Number(process.env.TASK_SIMULATED_ERROR_PERCENTAGE ?? 20),
  TASK_ERROR_RETRY_DELAY: Number(process.env.TASK_ERROR_RETRY_DELAY ?? 1000),
  WORKER_TIMEOUT: Number(process.env.WORKER_TIMEOUT ?? 5000),
  TASK_MAX_RETRIES: Number(process.env.TASK_MAX_RETRIES ?? 3),
  LOG_PATH: process.env.LOG_PATH ?? './logs/task_service.log',
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type Task = {
  id: string;
  message: string;
  attempts: number;
  createdAt: number;
  processing: boolean;
  completed: boolean;
};

type Statistics = {
  processedTasks: number;
  retries: number;
  succeeded: number;
  failed: number;
  successRate: number;
  averageProcessingTimeMsPerAttempt: number;
  queueLength: number;
  idleWorkers: number;
  hotWorkers: number;
};

class LogWriter {
  private queue: Promise<void> = Promise.resolve();

  constructor(private path: string) { }

  async append(line: string) {
    this.queue = this.queue.then(async () => {
      await fs.appendFile(this.path, line);
    }).catch(err => {
      console.error('log write error', err);
    });
    return this.queue;
  }
}

export class TaskManager {
  private queue: Task[] = [];
  private waiters: Array<(t: Task) => void> = [];
  private maxWorkers = Math.max(1, os.cpus().length);
  private workers: Map<string, Worker> = new Map();
  private logWriter = new LogWriter(config.LOG_PATH || './task_service.log');

  private processedTasks = 0;
  private retries = 0;
  private succeeded = 0;
  private failed = 0;
  private totalProcessingTimeMs = 0;
  private attemptsCount = 0;

  private workerIdleTimeoutMs = config.WORKER_TIMEOUT;
  private simulatedDuration = config.TASK_SIMULATED_DURATION;
  private errorPercentage = config.TASK_SIMULATED_ERROR_PERCENTAGE;
  private retryDelayMs = config.TASK_ERROR_RETRY_DELAY;
  private maxRetries = config.TASK_MAX_RETRIES;

  constructor() {
    fs.mkdir('./logs', { recursive: true }).catch(() => { });
    fs.appendFile(config.LOG_PATH, `--- service start ${new Date().toISOString()} ---\n`).catch(() => { });
  }

  createTask(message: string) {
    const task: Task = {
      id: uuidv4(),
      message,
      attempts: 0,
      createdAt: Date.now(),
      processing: false,
      completed: false,
    };
    this.enqueue(task);
    this.maybeSpawnWorker();
    return task.id;
  }

  private enqueue(task: Task) {
    if (task.processing || task.completed) return;
    this.queue.push(task);
    const waiter = this.waiters.shift();
    if (waiter) waiter(task);
  }

  private async dequeue(): Promise<Task> {
    const t = this.queue.shift();
    if (t) return t;
    return new Promise(resolve => this.waiters.push(resolve));
  }

  private maybeSpawnWorker() {
    const hot = [...this.workers.values()].filter(w => w.isBusy()).length;
    const idle = this.workers.size - hot;
    if (this.queue.length > idle && this.workers.size < this.maxWorkers) {
      const id = String(Math.random()).slice(2, 8);
      const w = new Worker(id, this);
      this.workers.set(id, w);
      w.start().finally(() => this.workers.delete(id));
    }
  }

  async _getTaskForWorker(): Promise<Task> {
    const task = await this.dequeue();
    this.maybeSpawnWorker();
    task.processing = true;
    return task;
  }

  async _processTaskByWorker(workerId: string, task: Task): Promise<void> {
    task.attempts += 1;

    if (task.attempts > 1) {
      this.retries += 1;
    }

    const attempt = task.attempts;
    const start = Date.now();

    await this.logWriter.append(
      `${new Date().toISOString()} | worker-${workerId} | task-${task.id} | attempt-${attempt} | ${task.message}\n`
    );

    await sleep(this.simulatedDuration);

    const duration = Date.now() - start;
    this.totalProcessingTimeMs += duration;
    this.attemptsCount += 1;

    const failedAttempt = Math.random() * 100 < this.errorPercentage;

    if (!failedAttempt) {
      if (!task.completed) {
        this.succeeded += 1;
        this.processedTasks += 1;
      }
      task.completed = true;
      return;
    }

    else {
      // failed attempt
      if (task.attempts < this.maxRetries) {
        task.processing = false;
        setTimeout(() => {
          this.enqueue(task);
          this.maybeSpawnWorker();
        }, this.retryDelayMs);
        return;
      }

      // final failure
      if (!task.completed) {
        this.failed += 1;
        this.processedTasks += 1;
      }
      task.completed = true;

      task.completed = true;
    }
  }

  getStatistics(): Statistics {
    const avg = this.attemptsCount > 0 ? this.totalProcessingTimeMs / this.attemptsCount : 0;
    const idle = [...this.workers.values()].filter(w => !w.isBusy()).length;
    const hot = [...this.workers.values()].filter(w => w.isBusy()).length;

    return {
      processedTasks: this.processedTasks,
      retries: this.retries,
      succeeded: this.succeeded,
      failed: this.failed,
      successRate: this.processedTasks ? this.succeeded / this.processedTasks : 0,
      averageProcessingTimeMsPerAttempt: Math.round(avg),
      queueLength: this.queue.length,
      idleWorkers: idle,
      hotWorkers: hot
    };
  }
}

class Worker {
  private busy = false;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private id: string, private manager: TaskManager) { }

  isBusy() {
    return this.busy;
  }

  async start() {
    while (true) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }

      let taskPromise = this.manager._getTaskForWorker();

      const timeout = new Promise<Task>((_, rej) => {
        this.idleTimer = setTimeout(() => rej(new Error('idle-timeout')), this.manager['workerIdleTimeoutMs']);
      });

      let task: Task;
      try {
        task = await Promise.race([taskPromise, timeout]);
      } catch {
        return;
      }

      this.busy = true;
      try {
        await this.manager._processTaskByWorker(this.id, task);
      } catch (e) {
        console.error('worker process error', e);
      } finally {
        task.processing = false;
        this.busy = false;
      }
    }
  }
}
