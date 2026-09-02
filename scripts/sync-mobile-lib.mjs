import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'history-key.js',
  'session-expiry.js',
  'scan-classify.js',
  'catalog-sync.js',
  'lookup-queue.js',
  'scan-cooldown.js',
  'es-event.js',
  'es-reconnect.js',
  'random-id.js',
];
mkdirSync(join(root, 'mobile', 'lib'), { recursive: true });
for (const file of files) {
  copyFileSync(join(root, 'lib', file), join(root, 'mobile', 'lib', file));
}
