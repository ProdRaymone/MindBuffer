# Agent Pull 集成

让你本地的 Claude Code / Hermes 定时从中转站拉未处理条目，跑 AI 整理后把结果回写。

---

## 架构回顾

```
[你的 PWA]  ←→  [Supabase]  ←→  [/api/agent-pull]  ←→  [本地 Claude Code]
   捕获              存储             服务端               定时 cron
```

Agent 用 `AGENT_PULL_TOKEN`（Bearer auth）调 `/api/agent-pull`，走 service-role client 绕过 RLS（agent 不是登录用户）。

---

## API

所有请求带 header：`Authorization: Bearer <AGENT_PULL_TOKEN>`

### 1. 拉未处理条目

```
GET /api/agent-pull?user_id=<你的 uuid>&processed=false&limit=100
```

返回：
```json
{ "entries": [ { "id": "...", "text": "...", "category": "...", ... }, ... ] }
```

### 2. 标记为已处理

```
PATCH /api/agent-pull
Content-Type: application/json

{ "user_id": "...", "ids": ["...", "..."], "patch": { "processed": true } }
```

### 3. 创建 digest（agent 生成）

```
POST /api/agent-pull
Content-Type: application/json

{
  "user_id": "...",
  "content": "## 今日主题\n...",
  "entry_ids": ["...", "..."],
  "kind": "agent-daily"
}
```

自动把这些 entry 标记为 processed + 关联 digest_id。

---

## 本地 Claude Code Skill 示例

假设你的 Claude Code Superpowers 目录在 `~/.claude/skills/`：

```bash
mkdir -p ~/.claude/skills/mindbuffer-digest
```

**~/.claude/skills/mindbuffer-digest/SKILL.md**

```markdown
---
name: mindbuffer-digest
description: 从灵感中转站拉取当天未处理的条目，整理成 digest 回写到数据库。
---

## Pipeline

1. curl pull 未处理条目
2. 让 Claude（你自己）读完生成 digest
3. curl POST 写回
4. 把 digest 也 append 到 Obsidian vault 的 `Daily Digest/YYYY-MM-DD.md`

## Environment

- MINDBUFFER_URL: https://your-domain.vercel.app
- MINDBUFFER_TOKEN: <AGENT_PULL_TOKEN>
- MINDBUFFER_USER_ID: <你的 supabase user uuid>
- OBSIDIAN_VAULT: /path/to/vault

## Step 1: Pull

curl -s -H "Authorization: Bearer $MINDBUFFER_TOKEN" \
  "$MINDBUFFER_URL/api/agent-pull?user_id=$MINDBUFFER_USER_ID&processed=false&limit=100"

## Step 2: Generate digest

[让 Claude 根据返回的 JSON，按照同样的 prompt 结构生成 markdown]

## Step 3: Write back

curl -s -X POST \
  -H "Authorization: Bearer $MINDBUFFER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$MINDBUFFER_USER_ID\",\"content\":$DIGEST_JSON,\"entry_ids\":$IDS_JSON,\"kind\":\"agent-daily\"}" \
  "$MINDBUFFER_URL/api/agent-pull"

## Step 4: Sync to Obsidian

echo "$DIGEST" > "$OBSIDIAN_VAULT/Daily Digest/$(date +%Y-%m-%d).md"
```

---

## Windows 任务计划

每天 23:00 触发：

```powershell
# daily-digest.ps1
$env:HTTP_PROXY = "http://127.0.0.1:16699"
$env:HTTPS_PROXY = "http://127.0.0.1:16699"
claude run mindbuffer-digest
```

任务计划：Trigger = Daily @ 23:00, Action = `powershell.exe -File C:\path\to\daily-digest.ps1`

---

## 省 API 费用

本地 Claude Code 可以走 OpenRouter / GLM Coding Plan / Hermes 本地模型，不一定非得用 Anthropic 直调。只要最后生成的 markdown 符合 digest 结构，都可以 POST 回去。
