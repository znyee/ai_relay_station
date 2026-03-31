import { buildCodexExecArgs, getJobPaths, runCodexJob } from "./codex-runner.js";

export function createJobQueue({ config, db }) {
  let running = 0;
  let scheduled = false;

  async function pump() {
    if (running >= config.codeQueueConcurrency) {
      return;
    }

    const nextJob = db.getNextPendingJob();
    if (!nextJob) {
      return;
    }

    const user = db.getUserById(nextJob.user_id);
    if (!user) {
      db.markJobFailed(nextJob.id, {
        errorText: "User not found for job.",
        changedFiles: [],
      });
      setImmediate(schedule);
      return;
    }

    running += 1;
    const { workspacePath, finalMessagePath, eventsPath } = getJobPaths(config, user, nextJob);
    db.markJobRunning(
      nextJob.id,
      workspacePath,
      eventsPath,
      `${config.codexBin} ${buildCodexExecArgs(workspacePath, finalMessagePath).join(" ")}`,
    );

    try {
      const result = await runCodexJob({
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
      setImmediate(schedule);
    }
  }

  function schedule() {
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
        concurrency: config.codeQueueConcurrency,
      };
    },
  };
}
