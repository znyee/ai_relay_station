import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createJobQueue } from "../src/job-queue.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }
  throw new Error("Timed out waiting for queue state.");
}

test("job queue fills available concurrency slots and backfills as jobs finish", async () => {
  const pendingJobs = [
    { id: "job_1", user_id: "usr_1" },
    { id: "job_2", user_id: "usr_1" },
    { id: "job_3", user_id: "usr_1" },
  ];
  const runningMarks = [];
  const completed = [];
  const failures = [];
  const deferredJobs = new Map(pendingJobs.map((job) => [job.id, deferred()]));

  const queue = createJobQueue({
    config: {
      codeQueueConcurrency: 2,
      codexBin: "codex",
    },
    db: {
      claimNextPendingJob() {
        return pendingJobs.shift() || null;
      },
      getUserById(userId) {
        return {
          id: userId,
          username: "owner",
          display_name: "Owner",
        };
      },
      markJobRunning(jobId) {
        runningMarks.push(jobId);
      },
      markJobCompleted(jobId) {
        completed.push(jobId);
      },
      markJobFailed(jobId, result) {
        failures.push({ jobId, result });
      },
    },
    resolveJobPaths(_config, _user, job) {
      return {
        workspacePath: `/tmp/${job.id}`,
        finalMessagePath: `/tmp/${job.id}.txt`,
        eventsPath: `/tmp/${job.id}.log`,
      };
    },
    runJob({ job }) {
      return deferredJobs.get(job.id).promise;
    },
  });

  queue.schedule();

  await waitUntil(() => runningMarks.length === 2);
  assert.deepEqual(runningMarks, ["job_1", "job_2"]);
  assert.equal(queue.stats().running, 2);
  assert.deepEqual(failures, []);

  deferredJobs.get("job_1").resolve({ ok: true });
  await waitUntil(() => runningMarks.length === 3);
  assert.deepEqual(runningMarks, ["job_1", "job_2", "job_3"]);
  assert.equal(queue.stats().running, 2);

  deferredJobs.get("job_2").resolve({ ok: true });
  deferredJobs.get("job_3").resolve({ ok: true });
  await waitUntil(() => completed.length === 3);
  assert.deepEqual(completed, ["job_1", "job_2", "job_3"]);
  assert.equal(queue.stats().running, 0);
});

test("job queue fails claimed jobs whose users no longer exist without wedging concurrency", async () => {
  const failures = [];
  let claimed = false;
  const queue = createJobQueue({
    config: {
      codeQueueConcurrency: 1,
      codexBin: "codex",
    },
    db: {
      claimNextPendingJob() {
        if (claimed) {
          return null;
        }
        claimed = true;
        return { id: "job_missing_user", user_id: "usr_missing" };
      },
      getUserById() {
        return null;
      },
      markJobRunning() {},
      markJobCompleted() {},
      markJobFailed(jobId, result) {
        failures.push({ jobId, result });
      },
    },
    resolveJobPaths() {
      throw new Error("should not build paths for missing users");
    },
    runJob() {
      throw new Error("should not run jobs for missing users");
    },
  });

  queue.schedule();

  await waitUntil(() => failures.length === 1);
  assert.equal(failures[0].jobId, "job_missing_user");
  assert.match(failures[0].result.errorText, /user not found/i);
  assert.equal(queue.stats().running, 0);
});
