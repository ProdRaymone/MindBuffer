# MindBuffer Guest Notes Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make guest mode feel like a calm, native notes surface without changing local-first data behavior or destabilizing authenticated mode.

**Architecture:** Keep the existing data flow intact and add a guest-focused presentation branch inside `components/MindBuffer.tsx`. Use a small source-verification script as the repository-native test harness for this UI pass, then validate the full app with the existing local-first verification, type-check, lint, and build commands.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Node verification scripts

---

### Task 1: Add a failing guest UI verification harness

**Files:**
- Modify: `E:/AI/Mindbuffer/mindbuffer/package.json`
- Create: `E:/AI/Mindbuffer/mindbuffer/scripts/verify-guest-notes-ui.mjs`
- Test: `E:/AI/Mindbuffer/mindbuffer/scripts/verify-guest-notes-ui.mjs`

- [ ] **Step 1: Write the failing verification script**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = readFileSync(path.join(root, 'components/MindBuffer.tsx'), 'utf8');

assert.match(source, /const isGuestMode = sessionMode === 'guest';/);
assert.match(source, /const \[showGuestFilters, setShowGuestFilters\] = useState\(false\);/);
assert.match(source, /guestBannerCopy/);
assert.match(source, /!isGuestMode && \(/);
assert.match(source, /sessionMode=\{sessionMode\}/);
assert.match(source, /showEntryStatusBadge/);

console.log('verify:guest-notes-ui passed');
```

- [ ] **Step 2: Add the npm script**

```json
{
  "scripts": {
    "verify:guest-notes-ui": "node scripts/verify-guest-notes-ui.mjs"
  }
}
```

- [ ] **Step 3: Run the verification and confirm RED**

Run: `npm run verify:guest-notes-ui`

Expected: FAIL because `MindBuffer.tsx` does not yet define the guest-only banner/filter/action branches.

- [ ] **Step 4: Commit the failing test harness**

```bash
git add package.json scripts/verify-guest-notes-ui.mjs
git commit -m "test: add guest notes ui verification"
```

### Task 2: Implement guest-only header, banner, filters, and composer

**Files:**
- Modify: `E:/AI/Mindbuffer/mindbuffer/components/MindBuffer.tsx`
- Test: `E:/AI/Mindbuffer/mindbuffer/scripts/verify-guest-notes-ui.mjs`

- [ ] **Step 1: Introduce explicit guest UI state and copy**

```tsx
const isGuestMode = sessionMode === 'guest';
const [showGuestFilters, setShowGuestFilters] = useState(false);

const guestBannerCopy = {
  title: '内容保存在本机',
  detail: hasCloudAccount
    ? '登录后可把这些记录同步到你的账号'
    : '现在就能先记下来，登录后再同步到云端',
};
```

- [ ] **Step 2: Simplify the top bar for guest mode**

```tsx
{!isGuestMode ? (
  <>
    <IconBtn ...>
      <FileText size={15} />
    </IconBtn>
    <IconBtn ...>
      <Sparkles size={15} />
    </IconBtn>
    <IconBtn ...>
      <Download size={15} />
    </IconBtn>
  </>
) : null}
```

- [ ] **Step 3: Replace the guest badge row with a single banner**

```tsx
{isGuestMode ? (
  <div className="px-4 md:px-5 py-3 border-b border-[var(--border-soft)] bg-[var(--bg)]">
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3">
      <div className="text-[13px] font-medium">{guestBannerCopy.title}</div>
      <div className="text-[12px] text-[var(--text-dim)] mt-1">{guestBannerCopy.detail}</div>
    </div>
  </div>
) : (
  <div>{/* existing authenticated status strip */}</div>
)}
```

- [ ] **Step 4: Collapse guest filters behind a lightweight toggle**

```tsx
{isGuestMode ? (
  <div className="px-4 md:px-5 pt-3">
    <button
      onClick={() => setShowGuestFilters((value) => !value)}
      className="text-[12px] px-3 py-1.5 rounded-full border border-[var(--border)]"
    >
      {showGuestFilters ? '收起筛选' : '筛选'}
    </button>
  </div>
) : null}
```

```tsx
{(!isGuestMode || showGuestFilters) ? (
  <div>{/* existing filter chips */}</div>
) : null}
```

- [ ] **Step 5: Turn the guest composer into a note card**

```tsx
<textarea
  placeholder={
    isGuestMode
      ? `写下${selectedCategoryDef.label}，回头再整理`
      : `输入${selectedCategoryDef.label}...（Cmd/Ctrl + Enter 发送）`
  }
  className="flex-1 bg-transparent outline-none resize-none text-[15px] leading-[1.6] py-2 min-h-[72px]"
/>
```

```tsx
{!isGuestMode ? (
  <>
    <button ...>
      <ImageIcon size={14} />
    </button>
    <button ...>
      <Paperclip size={14} />
    </button>
  </>
) : null}
```

- [ ] **Step 6: Run the verification and confirm GREEN for the new UI hooks**

Run: `npm run verify:guest-notes-ui`

Expected: PASS

### Task 3: Implement guest text-first entry rows, empty state, and mobile-friendly actions

**Files:**
- Modify: `E:/AI/Mindbuffer/mindbuffer/components/MindBuffer.tsx`
- Test: `E:/AI/Mindbuffer/mindbuffer/scripts/verify-guest-notes-ui.mjs`

- [ ] **Step 1: Pass session mode into entry rows**

```tsx
<EntryRow
  ...
  sessionMode={sessionMode}
/>
```

- [ ] **Step 2: Add guest-specific status and action visibility rules**

```tsx
const isGuestMode = sessionMode === 'guest';
const showEntryStatusBadge = !isGuestMode
  ? entry.sync_state !== 'synced'
  : entry.sync_state === 'syncing' || entry.sync_state === 'failed';
```

```tsx
<div
  className={`flex gap-0.5 self-center transition-opacity ${
    isGuestMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
  }`}
>
```

- [ ] **Step 3: Move guest metadata below the note body**

```tsx
{isGuestMode ? (
  <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
    <span>{fmtTime(entry.created_at)}</span>
    {showEntryStatusBadge ? <StatusBadge tone={syncStateTone(entry.sync_state)}>{syncStateLabel(entry.sync_state)}</StatusBadge> : null}
  </div>
) : (
  <div>{/* existing structured metadata layout */}</div>
)}
```

- [ ] **Step 4: Replace the guest empty state with a left-aligned first-note prompt**

```tsx
{isGuestMode && entries.length === 0 ? (
  <div className="rounded-[28px] border border-[var(--border)] bg-[var(--bg-elev)] px-5 py-6">
    <div className="text-[15px] font-medium">第一条先写下来</div>
    <div className="mt-2 text-[13px] leading-[1.7] text-[var(--text-dim)]">
      想到什么就先记什么，稍后再登录同步或整理。
    </div>
  </div>
) : (
  <div>{/* existing empty or filtered state */}</div>
)}
```

- [ ] **Step 5: Run targeted verification and full project verification**

Run: `npm run verify:guest-notes-ui`
Expected: PASS

Run: `npm run verify:local-first`
Expected: PASS

Run: `npm run type-check`
Expected: PASS

Run: `npm run lint`
Expected: PASS (existing non-blocking warnings may remain)

Run: `npm run build`
Expected: PASS (existing non-blocking warnings may remain)

- [ ] **Step 6: Commit the implementation**

```bash
git add components/MindBuffer.tsx package.json scripts/verify-guest-notes-ui.mjs
git commit -m "feat: polish guest notes mode"
```
