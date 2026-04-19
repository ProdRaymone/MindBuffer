import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

const middleware = read('middleware.ts');
const page = read('app/page.tsx');
const localEntries = read('lib/local-entries.ts');
const mindBuffer = read('components/MindBuffer.tsx');
const loginPage = read('app/login/page.tsx');

assert.match(
  middleware,
  /const isPublicHome = path === '\/';/,
  'middleware should keep the home page public'
);

assert.match(
  page,
  /hasCloudAccount=\{false\}/,
  'home page should render guest mode when no user session exists'
);

assert.match(
  localEntries,
  /mindbuffer\.localEntries\.v1/,
  'local entry helper should persist drafts under the expected storage key'
);

assert.match(
  mindBuffer,
  /appendLocalEntry\(draft\)/,
  'MindBuffer should add drafts locally before cloud sync'
);

assert.match(
  mindBuffer,
  /syncDraftToCloud/,
  'MindBuffer should define a cloud sync path for local drafts'
);

assert.match(
  mindBuffer,
  /sessionMode = hasCloudAccount \? 'authenticated' : 'guest'/,
  'MindBuffer should expose guest and authenticated modes'
);

assert.match(
  loginPage,
  /LOCAL-FIRST · CLOUD SYNC/,
  'login page should explain the new local-first positioning'
);

console.log('verify:local-first passed');
