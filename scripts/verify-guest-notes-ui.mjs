import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

const mindBuffer = read('components/MindBuffer.tsx');

assert.match(
  mindBuffer,
  /const isGuestMode = sessionMode === 'guest';/,
  'MindBuffer should define an explicit guest mode view branch'
);

assert.match(
  mindBuffer,
  /const \[showGuestFilters, setShowGuestFilters\] = useState\(false\);/,
  'MindBuffer should track collapsed guest filters'
);

assert.match(
  mindBuffer,
  /const guestBannerCopy = \{/,
  'MindBuffer should provide guest banner copy for the local-first note surface'
);

assert.match(
  mindBuffer,
  /!isGuestMode && \(/,
  'MindBuffer should hide guest-incompatible top-level tools behind a non-guest branch'
);

assert.match(
  mindBuffer,
  /sessionMode=\{sessionMode\}/,
  'MindBuffer should pass session mode into entry rows for guest-specific rendering'
);

assert.match(
  mindBuffer,
  /const showEntryStatusBadge = !isGuestMode/,
  'Entry rows should hide local-only badges in guest mode while keeping syncing and failed states visible'
);

assert.match(
  mindBuffer,
  /showGuestFilters \? '收起筛选' : '筛选'/,
  'Guest mode should expose a lightweight filter toggle instead of showing the full filter bar by default'
);

console.log('verify:guest-notes-ui passed');
