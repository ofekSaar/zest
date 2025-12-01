import { parentPort } from "worker_threads";

if (!parentPort) throw new Error("This file must be run inside a worker thread");

type WorkerTask = {
  id: string;
  message: string;
  attempt: number;
  simulatedDuration: number;
  errorPercentage: number;
};

type WorkerResult = {
  id: string;
  attempt: number;
  ok: boolean;
  duration: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

parentPort!.on("message", async (task: WorkerTask) => {
  const start = Date.now();

  await sleep(task.simulatedDuration);

  const failed = Math.random() * 100 < task.errorPercentage;

  const result: WorkerResult = {
    id: task.id,
    attempt: task.attempt,
    ok: !failed,
    duration: Date.now() - start,
  };

  parentPort!.postMessage(result);
});
