import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger";

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function runBackup(): void {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(thisDir, "../../../../");
  const scriptPath = path.join(projectRoot, "backup.sh");

  logger.info("Running scheduled auto-backup...");

  exec(`bash "${scriptPath}"`, { cwd: projectRoot }, (err, stdout, stderr) => {
    if (err) {
      logger.warn({ err, stderr: stderr.trim() }, "Auto-backup failed");
      return;
    }
    logger.info({ output: stdout.trim() }, "Auto-backup completed successfully");
  });
}

export function startAutoBackup(): void {
  logger.info("Auto-backup scheduler started — runs every 24 hours");
  setInterval(runBackup, BACKUP_INTERVAL_MS);
}
