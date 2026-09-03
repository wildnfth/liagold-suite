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
  'camera-tune.js',
  'camera-power.js',
  'qr-overlay.js',
  'scan-latest.js',
  'scan-suggest.js',
  'scan-filter.js',
  'scan-stats.js',
  'photo-caption.js',
  'photo-overlay.js',
  'es-event.js',
  'es-reconnect.js',
  'random-id.js',
];
mkdirSync(join(root, 'mobile', 'lib'), { recursive: true });
for (const file of files) {
  copyFileSync(join(root, 'lib', file), join(root, 'mobile', 'lib', file));
}
