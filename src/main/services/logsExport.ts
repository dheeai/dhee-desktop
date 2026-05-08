/**
 * Bundle the logs directory into a zip the user can email to support.
 *
 * The directory we zip is whatever main.ts pointed `KSHANA_LOGS_DIR` at
 * — `app.getPath('userData')/logs` for the packaged app, the
 * kshana-core checkout's `logs/` for dev. DesktopLogger, kshana-core's
 * loggers, and ComfyUIClient.debugLog all converge there.
 *
 * Output goes to Downloads with a timestamped name so multiple exports
 * don't overwrite each other.
 */

import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { app } from 'electron';

export interface ExportLogsResult {
  zipPath: string;
  bytes: number;
  fileCount: number;
}

function timestampSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function getLogsDirAbs(): string {
  return (
    process.env['KSHANA_LOGS_DIR'] || path.join(app.getPath('userData'), 'logs')
  );
}

/**
 * Zip the entire logs dir into `<Downloads>/kshana-logs-<ts>.zip` and
 * return metadata about the result. Throws if the logs dir is missing
 * or empty so the UI can surface a meaningful message.
 */
export async function exportLogsZip(): Promise<ExportLogsResult> {
  const logsDir = getLogsDirAbs();
  if (!fs.existsSync(logsDir)) {
    throw new Error(`Logs directory not found: ${logsDir}`);
  }

  const downloads = app.getPath('downloads');
  const zipPath = path.join(downloads, `kshana-logs-${timestampSuffix()}.zip`);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  let fileCount = 0;
  archive.on('entry', () => {
    fileCount += 1;
  });

  return await new Promise<ExportLogsResult>((resolve, reject) => {
    output.on('close', () => {
      if (fileCount === 0) {
        // Clean up the empty zip — better to error than to hand the user
        // a useless 22-byte file.
        try {
          fs.unlinkSync(zipPath);
        } catch {
          /* best effort */
        }
        reject(new Error(`No log files found in ${logsDir}`));
        return;
      }
      resolve({ zipPath, bytes: archive.pointer(), fileCount });
    });
    output.on('error', reject);
    archive.on('error', reject);
    // archiver's 'warning' covers ENOENT for symlinks etc — ignore so a
    // partially-readable logs dir still produces a usable zip.
    archive.on('warning', () => {});

    archive.pipe(output);
    archive.directory(logsDir, false);
    archive.finalize();
  });
}
