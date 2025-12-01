import os from "os";
import fs from "fs/promises";
import path from "path";
import { Worker } from "worker_threads";
import { v4 as uuidv4 } from "uuid";

export const config = {
  TASK_SIMULATED_DURATION: Number(process.env.TASK_SIMULATED_DURATION ?? 500),
  TASK_SIMULATED_ERROR_PERCENTAGE: Number(process.env.TASK_SIMULATED_ERROR_PERCENTAGE ?? 20),
  TASK_ERROR_RETRY_DELAY: Number(process.env.TASK_ERROR_RETRY_DELAY ?? 1000),
  WORKER_TIMEOUT: Number(process.env.WORKER_TIMEOUT ?? 5000),
  TASK_MAX_RETRIES: Number(process.env.TASK_MAX_RETRIES ?? 3),
  LOG_PATH: process.env.LOG_PATH ?? "./logs/task_service.log",
};

type Task = {
  id: string;
  message: string;
  attempts: number;
  createdAt: number;
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
  busyWorkers: number;
};

class LogWriter {
  private queue = Promise.resolve();

  constructor(private path: string) {}

  append(line: string) {
    this.queue = this.queue
      .then(() => fs.appendFile(this.path, line))
      .catch((e) => console.error("Log write error:", e));
  }
}

export class TaskManager {
  private queue: Task[] = [];
  private tasks = new Map<string, Task>();
  private workers: Worker[] = [];
  private busyWorkers = new Set<Worker>();

  private maxWorkers = Math.max(1, os.cpus().length);
  private logWriter = new LogWriter(config.LOG_PATH);

  private processedTasks = 0;
  private retries = 0;
  private succeeded = 0;
  private failed = 0;
  private totalProcessingTimeMs = 0;
  private attemptsCount = 0;

  constructor() {
    fs.mkdir("./logs", { recursive: true }).catch(() => {});
    fs.appendFile(config.LOG_PATH, `--- Service start ${new Date().toISOString()} ---\n`).catch(() => {});

    this.startWorkers();
  }

  private startWorkers() {
    const workerPath = path.resolve(__dirname, "worker.js");

    for (let i = 0; i < this.maxWorkers; i++) {
      const w = new Worker(workerPath);

      w.on("message", (result) => this.onWorkerDone(w, result));
      w.on("error", (e) => console.error("Worker error:", e));
      w.on("exit", (code) => {
        if (code !== 0) console.error("Worker exited with code", code);
      });

      this.workers.push(w);
    }

    console.log(`TaskManager started with ${this.maxWorkers} workers`);
  }

  createTask(message: string): string {
    const task: Task = {
      id: uuidv4(),
      message,
      attempts: 0,
      createdAt: Date.now(),
      completed: false,
    };

    this.tasks.set(task.id, task);
    this.queue.push(task);

    this.dispatch();

    return task.id;
  }

  private dispatch() {
    while (this.queue.length > 0) {
      const worker = this.workers.find((w) => !this.busyWorkers.has(w));
      if (!worker) break;

      const task = this.queue.shift()!;
      this.busyWorkers.add(worker);

      const attempt = task.attempts + 1;
      task.attempts = attempt;

      this.logWriter.append(
        `${new Date().toISOString()} | worker | task-${task.id} | attempt-${attempt} | ${task.message}\n`
      );

      worker.postMessage({
        id: task.id,
        message: task.message,
        attempt,
        simulatedDuration: config.TASK_SIMULATED_DURATION,
        errorPercentage: config.TASK_SIMULATED_ERROR_PERCENTAGE,
      });
    }
  }

  private onWorkerDone(worker: Worker, result: any) {
    this.busyWorkers.delete(worker);

    const { id, ok, duration, attempt } = result;
    const task = this.tasks.get(id);
    if (!task) return;

    this.attemptsCount += 1;
    this.totalProcessingTimeMs += duration;

    if (ok) {
      if (!task.completed) {
        task.completed = true;
        this.succeeded += 1;
        this.processedTasks += 1;
      }
    } else {
      if (attempt < config.TASK_MAX_RETRIES) {
        this.retries += 1;
        setTimeout(() => {
          this.queue.push(task);
          this.dispatch();
        }, config.TASK_ERROR_RETRY_DELAY);
      } else {
        if (!task.completed) {
          task.completed = true;
          this.failed += 1;
          this.processedTasks += 1;
        }
      }
    }

    this.dispatch();
  }

  getStatistics(): Statistics {
    const avg = this.attemptsCount > 0 ? this.totalProcessingTimeMs / this.attemptsCount : 0;

    return {
      processedTasks: this.processedTasks,
      retries: this.retries,
      succeeded: this.succeeded,
      failed: this.failed,
      successRate: this.processedTasks ? this.succeeded / this.processedTasks : 0,
      averageProcessingTimeMsPerAttempt: Math.round(avg),
      queueLength: this.queue.length,
      idleWorkers: this.workers.length - this.busyWorkers.size,
      busyWorkers: this.busyWorkers.size,
    };
  }
}
