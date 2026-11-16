import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// End-to-end tests run the real server against a throwaway database and the built web app.
const PORT = 3199;
const dataDir = path.resolve(import.meta.dirname, 'server/data');

// Each run gets its own database file, so it always starts from first-run setup.
// Files left by earlier runs are removed; one still held open by a running server is skipped.
if (fs.existsSync(dataDir))
  for (const f of fs.readdirSync(dataDir))
    if (f.startsWith('e2e-')) {
      try {
        fs.rmSync(path.join(dataDir, f));
      } catch {
        /* in use */
      }
    }
const dbFile = path.join(dataDir, `e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: 'npm run build -w web && npm run start -w server',
    url: `http://127.0.0.1:${PORT}/trpc/auth.status`,
    env: { PORT: String(PORT), DB_FILE: dbFile },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
