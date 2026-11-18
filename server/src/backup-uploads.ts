import fs from 'node:fs';
import path from 'node:path';

/**
 * Copies every uploaded picture that the backup folder does not have yet.
 * A picture never changes after upload (each upload gets a new id), so one shared folder serves
 * every database copy in the backups, and each run only copies the new pictures.
 * Nothing is ever deleted here, so an older database copy always finds its pictures.
 * Returns how many pictures were copied.
 */
export function mirrorUploads(uploadsDir: string, targetDir: string): number {
  if (!fs.existsSync(uploadsDir)) return 0;
  fs.mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(uploadsDir)) {
    const from = path.join(uploadsDir, name);
    const to = path.join(targetDir, name);
    if (!fs.statSync(from).isFile()) continue;
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
    // Written under a temporary name first, so a stopped run never leaves half a picture behind.
    fs.copyFileSync(from, `${to}.part`);
    fs.renameSync(`${to}.part`, to);
    copied++;
  }
  return copied;
}
