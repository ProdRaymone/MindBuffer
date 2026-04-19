# 灵感中转站 · MindBuffer

脑海想法的中转站。快速捕获，AI 整理，送入第二大脑。

**技术栈**：Next.js 14 · Supabase · Anthropic API · PWA · TypeScript · Tailwind

---

## 部署步骤（按顺序执行）

### 0. 准备

- [Supabase](https://supabase.com) 账号（免费层够用）
- [Vercel](https://vercel.com) 账号
- [Anthropic](https://console.anthropic.com) API key 或兼容 Anthropic SDK 的中转站 token
- Node.js 18.17+

### 1. 创建 Supabase 项目

1. 登录 Supabase Dashboard → **New project**
2. 随便起个名（比如 `mindbuffer`），选离你最近的 region（东京 `ap-northeast-1` 或 新加坡 `ap-southeast-1`），设个 database password
3. 项目创建完后（约 2 分钟），进入项目，左侧菜单 **SQL Editor**
4. 新建一个 query，把 `supabase/schema.sql` 整个文件内容粘贴进去，点 **Run**
5. 确认：左侧 **Table Editor** 能看到 `entries` / `digests` / `preferences` 三张表；**Storage** 能看到 `entries-images` 和 `entries-audio` 两个 bucket
6. **Authentication → Providers → Email**：确认 "Enable Email provider" 打开，且 "Confirm email" **关掉**（magic link 模式不需要二次确认，关掉可以直接点链接登录）
7. **Project Settings → API**：记下 `Project URL` 和 `anon public` / `service_role` 两个 key

### 2. 本地跑起来

```bash
cd mindbuffer
cp .env.local.example .env.local
```

编辑 `.env.local`：

```
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的 anon key
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
AGENT_PULL_TOKEN=$(openssl rand -hex 32)   # 生成一个随机 token
```

如果你用的是兼容 Anthropic SDK 的中转站，而不是官方 `apiKey`，改成：

```
ANTHROPIC_API_KEY=
ANTHROPIC_AUTH_TOKEN=你的中转 token
ANTHROPIC_BASE_URL=https://你的中转域名
```

然后：

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`，会跳到 `/login`。输入你的邮箱，Supabase 会发一封魔法链接邮件。点链接 → 跳回 `/` → 开始用。

### 3. 部署到 Vercel

```bash
# 先 commit 代码到一个 GitHub repo
git init
git add -A
git commit -m "initial mindbuffer"
# 推到 GitHub

# 方式 A：Vercel CLI
npm i -g vercel
vercel

# 方式 B：Vercel Dashboard → Import GitHub repo
```

**环境变量**：在 Vercel 项目设置里把 `.env.local` 里的所有变量都添加进去，把 `NEXT_PUBLIC_APP_URL` 改成你的 Vercel 域名（比如 `https://mindbuffer-raymone.vercel.app`）。

**Supabase 回调设置**：Supabase Dashboard → Authentication → URL Configuration：
- Site URL: `https://mindbuffer-raymone.vercel.app`
- Redirect URLs 添加: `https://mindbuffer-raymone.vercel.app/**`

部署完访问你的 Vercel 域名，用同一个邮箱登录。搞定。

### 4. 放到桌面/任务栏

**Windows 电脑端（Chrome/Edge）**：
1. 打开你的 Vercel 域名
2. 地址栏右侧的安装图标 → "安装 MindBuffer"
3. 安装完成后会出现独立窗口，右键任务栏图标 → "固定到任务栏"

**macOS（Chrome/Safari）**：
1. Chrome: 右上三个点 → "投放、保存和分享" → "安装 MindBuffer"
2. Safari: 文件 → "添加到 Dock"

**iOS**：
1. Safari 打开域名
2. 分享按钮 → "添加到主屏幕"
3. 拖到你想要的位置

**Android**：
1. Chrome 打开域名，会自动提示安装
2. 装完之后 Android 分享面板会自动出现 MindBuffer（Web Share Target 生效）

### 5. iOS 分享配置

iOS Safari 不支持 Web Share Target，需要用 Shortcuts 代替。详见 `docs/ios-shortcut.md`。

### 6. Agent 自动 Digest（可选）

设置 Claude Code 定时 pull 未处理条目生成 digest。详见 `docs/agent-pull.md`。

---

## 核心特性

- **分类捕获**：灵感 / 待办 / 音乐 / 感受 / 日记 / 问题 / 链接 / 笔记 八个预设分类
- **多模态输入**：
  - 粘贴截图自动上传（`⌘V` 任何地方）
  - 拖拽图片到窗口
  - 粘贴 URL 自动抓取 og:tags 生成链接卡
  - 一条 entry 可以同时带文字 + 多张图 + 多个链接
- **双维度过滤**：分类（idea/todo/...）× 媒介类型（文字/图片/链接/混合）独立筛选
- **AI Digest**：一键整理当天内容成结构化 markdown，自动建议迁移到 Notion 哪个库
- **PWA**：可安装，iOS/Android 桌面图标，离线访问已加载的内容
- **导出**：Markdown / JSON / 复制为 Notion 格式
- **Agent 接入**：`/api/agent-pull` 端点 + token 认证，本地 agent 可定时拉

---

## 架构

```
┌────────────────────────────────────────┐
│ PWA (Next.js 14)                       │
│  ├─ /login         magic link          │
│  ├─ /              主界面              │
│  └─ service worker  离线 shell         │
└──────────┬─────────────────────────────┘
           │
     ┌─────▼─────────────────────────┐
     │ /api/*  (Next.js route handlers) │
     │  ├─ entries         CRUD         │
     │  ├─ digest          AI 整理       │
     │  ├─ link-preview    og 抓取      │
     │  ├─ share           Web Share Target │
     │  ├─ signed-url      私有图片 URL   │
     │  └─ agent-pull      本地 agent 入口 │
     └─────┬─────────────────────┬──────┘
           │                     │
     ┌─────▼──────┐       ┌──────▼──────┐
     │ Supabase   │       │ Anthropic   │
     │  Postgres  │       │  API        │
     │  Storage   │       └─────────────┘
     │  Auth (magic link) │
     └────────────┘
```

## 数据模型

```typescript
type Entry = {
  id: uuid
  user_id: uuid
  text: string | null                // 文字（可空）
  category: 'idea' | 'todo' | ...
  tags: string[]
  attachments: Array<                // 可组合多种
    | { type: 'image', storage_path, width, height }
    | { type: 'link',  url, title, description, image, site_name }
    | { type: 'audio', storage_path, duration_sec, transcript }
  >
  processed: boolean                 // 是否被 AI 整理过
  last_digest_id: uuid | null
  source: 'web' | 'share' | 'ios-shortcut' | 'api' | 'agent'
  created_at, updated_at
}
```

## 目录结构

```
mindbuffer/
├── supabase/schema.sql          # 一键建表脚本
├── app/
│   ├── layout.tsx               # 字体、metadata、PWA
│   ├── globals.css              # CSS 变量 + 全局样式
│   ├── page.tsx                 # 主页（server fetch）
│   ├── login/page.tsx           # magic link 登录
│   ├── auth/callback/route.ts   # OAuth callback
│   └── api/
│       ├── entries/route.ts     # GET/POST/PATCH
│       ├── entries/[id]/route.ts # PATCH/DELETE 单条
│       ├── digest/route.ts      # AI 整理
│       ├── link-preview/route.ts # og 抓取
│       ├── share/route.ts       # Web Share Target
│       ├── signed-url/route.ts  # 临时图片 URL
│       ├── preferences/route.ts # 用户偏好
│       └── agent-pull/route.ts  # agent 入口（Bearer token）
├── components/MindBuffer.tsx    # 主组件（~800 行）
├── lib/
│   ├── supabase.ts              # browser client
│   ├── supabase-server.ts       # server / service-role client
│   ├── types.ts                 # 类型 + 分类常量
│   ├── image.ts                 # 客户端压缩
│   └── native.ts                # Capacitor adapter 预埋
├── public/
│   ├── manifest.json            # PWA + share_target
│   ├── sw.js                    # service worker
│   └── icons/                   # 占位图标（建议换成你自己的）
├── middleware.ts                # auth guard
└── docs/
    ├── ios-shortcut.md          # iOS 分享配置
    └── agent-pull.md            # agent 集成指南
```

---

## 未来路径（按优先级）

### v2（建议两个月后）

- [ ] 语音输入：长按录音 → 上传 → Claude/Whisper 转文字
- [ ] Tag 系统：`#` 触发补全，跨分类找东西
- [ ] OCR：图片内文字自动提取，可全文搜索
- [ ] 自定义分类：在 preferences 里改
- [ ] Gallery 视图：图片九宫格、链接卡墙
- [ ] 暗/亮主题切换

### v3

- [ ] Notion 双向同步：digest 里勾选的条目一键推送
- [ ] Capacitor 包壳 iOS → App Store 上架
- [ ] 原生 share extension（比 Shortcut 更 first-class）
- [ ] Siri Shortcuts + 桌面 widget
- [ ] Realtime sync（Supabase Realtime，多端实时推送）

---

## 常见问题

**Q: 免费额度够用吗？**
- Supabase 免费层：500MB 数据库 + 1GB 存储 + 50MB 文件上传 + 50K auth users。个人用 2-3 年没问题。
- Vercel 免费层：100GB 带宽/月。个人用永远吃不完。
- Anthropic：按用量付费。Digest 每次约 0.01-0.03 美元（Sonnet 4），一天一次一年几十刀。

**Q: 图片存储会爆吗？**
- 客户端已经压缩（WebP 质量 88，长边 2048px）。3MB 的 4K 截图压到 ~300KB。
- 一天 20 张截图 × 300KB = 6MB/天 = 2GB/年 = 两年吃完免费额度。到时候付 Supabase Pro（$25/月，100GB 存储）或者迁移到 R2/B2。

**Q: Anthropic API key 能被前端读到吗？**
- 不能。`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 都没有 `NEXT_PUBLIC_` 前缀，只有 server-side route handlers 能读。浏览器看不到。

**Q: 如果 Vercel/Supabase 以后出问题怎么办？**
- 所有数据都是标准 Postgres + S3 兼容存储，随时能迁移。导出功能（`/api/entries` + storage 下载）一次导完。
- Code 本身是你自己的 repo，Next.js 可以部署到任何 Node.js 主机或 Cloudflare Pages。

---

## 许可

私人项目。拿去用，别卖给别人。
