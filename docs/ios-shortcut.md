# iOS Shortcut 配置

因为 iOS Safari 不支持 Web Share Target API，我们用 Shortcuts app 做替代方案。配完之后，你就能在任何 app 的分享面板里点 "MindBuffer" 把内容直接丢进中转站。

---

## 准备工作

1. 部署好 MindBuffer，拿到你的域名，比如 `https://mindbuffer-raymone.vercel.app`
2. 在中转站网页版登录一次（Shortcut 需要 cookie 才能 POST 到 `/api/share`）
3. 打开 iOS **Shortcuts (快捷指令)** app

---

## 方案 A：用 cookie（推荐，最简单）

**原理**：调用 `/api/share?url=...&text=...&title=...`（GET 路径），浏览器 cookie 已存在，服务端自动识别用户。

### 步骤

1. 在 Shortcuts app 里点右上角 **+** 新建
2. 重命名为 **MindBuffer**
3. 添加动作（按顺序）：

   **a. 接收分享输入**
   - 点 "Receive" → 设置 *Receive: URLs, Text, Images From Share Sheet*
   - 勾选 *Show in Share Sheet*

   **b. 设置变量**
   - "Set Variable" → Name: `SharedInput`, Value: Shortcut Input

   **c. 拼 URL**
   - "URL" 动作 → 输入：`https://你的域名.vercel.app/api/share`
   - "Get Contents of URL" 动作：
     - Method: `GET`
     - URL: 上一步的 URL
     - Query parameters:
       - `url` = SharedInput (当输入是 URL 时)
       - `text` = SharedInput (当输入是文本时)
     - （可留空其他字段，服务端会智能处理）

   **d. 可选 Haptic**
   - "Vibrate Device" 动作 → 确认反馈

4. 测试：任意 app 分享页 → 选 MindBuffer → 打开你的中转站网页，应该能看到新条目

---

## 方案 B：用 Agent Pull Token（更稳，支持后台）

**原理**：Shortcut 用 `AGENT_PULL_TOKEN` 直接调 `/api/agent-pull`（POST entries），不依赖 cookie，即使没登录也能发送。

### 步骤

1. 从 `.env.local` 拷贝 `AGENT_PULL_TOKEN`（一串随机 hex）
2. 从 Supabase Dashboard → Authentication → Users 找到你的 user_id（uuid 格式）
3. Shortcut 流程：

   **a. Receive from Share Sheet** (同上)

   **b. 构造 JSON body**
   - "Dictionary" 动作，添加键值：
     - `user_id` = 你的 uuid
     - `text` = SharedInput
     - `category` = `note`（或 `link`，看你的分享对象）
     - `source` = `ios-shortcut`

   **c. Get Contents of URL**
   - URL: `https://你的域名.vercel.app/api/entries` （注意：这个目前还要 cookie，如果你想用 token 走 agent-pull，需要扩展 agent-pull 接受 POST 创建 entry；v1 先用方案 A）

---

## 把 Shortcut 放到分享面板最上

1. 长按 Shortcut 选 "Edit Shortcut"
2. 右上角 (ⓘ) → "Show in Share Sheet" 确认开启
3. "Share Sheet Types" 选 URLs, Text, Images

完事之后，在 Safari / 小红书 / X / 抖音里长按内容 → 分享 → 第一排就能看到 MindBuffer。

---

## 已知限制

- iOS Safari 里直接点击 PWA 桌面图标打开的是一个独立窗口，cookie 和 Safari 浏览器不共享。第一次用方案 A 时，如果你平时都在 PWA 独立窗口里登录，Shortcut 调 `/api/share` 可能 401。解决：用 Safari 浏览器登录一次（不用 PWA 窗口），给 Safari 存一份 cookie。
- 如果你要在 iOS 锁屏 widget / Action Button 里触发 Shortcut，iOS 16+ 支持。

---

## Android 用户

不用这套。Android PWA 支持 Web Share Target，装完之后自动出现在分享面板里（我们已经在 `manifest.json` 里声明了 share_target）。
