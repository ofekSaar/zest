## High-Level Goal
Design and implement a self-contained microservice exposing an HTTP API that allows clients to enqueue tasks for asynchronous processing and retrieve real-time processing metrics. Each task must append a message to a shared log file, with proper synchronization for concurrent access. Implementation details (language, frameworks, storage, and queue type) are left to your discretion.
This microservice exposes three HTTP endpoints:

## Context
Your job is to implement the core business logic of a new microservice with two endpoints (`POST /tasks` and `GET /statistics`) —`createTask` and `getStatistics`.
A task represents a job to be performed by an external asynchronous worker. For our use case, the client sends a new task object with the format {“message”: string}.
A worker should receive tasks and execute them in the following manner:
- Append a log entry to a shared file (with the timestamp, the worker ID, the task ID, and the message), handling concurrent writes safely.
- Simulate processing time by sleeping for a configured duration.
- Simulate random failures by a configured failure rate.
- Trigger retries with a configured delay on failures.
Workers should be created upon need with the following caveats:
- The maximum number of workers is the number of CPU cores.
- Workers remain alive and ready to process new tasks for a configurable duration.
After this idle time, they exit.

## HTTP Endpoints
POST /tasks
- Accepts a JSON payload in the format {“message”: string}.
- Add a new task to the processing pipeline.
-  Returns the new task ID
 
 GET /statistics
- Returns current processing metrics in JSON:
- Number of tasks processed.
- Number of task retries.
- Number succeeded vs. number failed.
- Average processing time per attempt.
- Current queue length.
- Idle workers count.
- Hot (In use) workers count.

## Environment Variables
Configure the service via environment variables as defined in the existing README:
- SERVER_PORT — HTTP server port
- TASK_SIMULATED_DURATION — Simulated duration (ms) per task attempt
- TASK_SIMULATED_ERROR_PERCENTAGE - Simulated task error percentage
- TASK_ERROR_RETRY_DELAY — delay (ms) between retries
- WORKER_TIMEOUT — the time the worker needs to be idle before it is cleaned up
- TASK_MAX_RETRIES — maximum retry attempts per task

## Operate instruction
Build & Run (local):
```bash
npm install
npm run build
npm start
```

Dev (live reload):
```bash
npm install
npm run dev
```

Docker:
- `Dockerfile` and `docker-compose.yml` included.
```bash
docker compose build
docker compose run
```

Testing:
- Jest + Supertest tests included. Run with `npm test`.
