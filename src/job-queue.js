import { buildCodexExecArgs, getJobPaths, runCodexJob } from "./codex-runner.js";

export function createJobQueue({
  config,
  db,
  runJob = runCodexJob,
  resolveJobPaths = getJobPaths,
} = {}) {
  const concurrency = Math.max(1, Number(config?.codeQueueConcurrency || 1));
  let running = 0;
  let scheduled = false;
  let needsPump = false;
  let pumping = false;

  async function processClaimedJob(nextJob) {
    try {
      const user = db.getUserById(nextJob.user_id);
      if (!user) {
        db.markJobFailed(nextJob.id, {
          errorText: "User not found for job.",
          changedFiles: [],
        });
        return;
      }

      const { workspacePath, finalMessagePath, eventsPath } = resolveJobPaths(config, user, nextJob);
      db.markJobRunning(
        nextJob.id,
        workspacePath,
        eventsPath,
        `${config.codexBin} ${buildCodexExecArgs(workspacePath, finalMessagePath).join(" ")}`,
      );

      const result = await runJob({
        config,
        user,
        job: nextJob,
      });

      if (result.ok) {
        db.markJobCompleted(nextJob.id, result);
      } else {
        db.markJobFailed(nextJob.id, result);
      }
    } catch (error) {
      db.markJobFailed(nextJob.id, {
        errorText: error instanceof Error ? error.message : String(error),
        changedFiles: [],
      });
    } finally {
      running -= 1;
      schedule();
    }
  }

  async function pump() {
    if (pumping) {
      needsPump = true;
      return;
    }

    pumping = true;
    try {
      do {
        needsPump = false;
        while (running < concurrency) {
          const nextJob = db.claimNextPendingJob();
          if (!nextJob) {
            break;
          }
          running += 1;
          void processClaimedJob(nextJob);
        }
      } while (needsPump && running < concurrency);
    } finally {
      pumping = false;
    }
  }

  function schedule() {
    needsPump = true;
    if (scheduled) {
      return;
    }
    scheduled = true;
    setImmediate(async () => {
      scheduled = false;
      await pump();
    });
  }

  return {
    schedule,
    stats() {
      return {
        running,
        concurrency,
      };
    },
  };
}
