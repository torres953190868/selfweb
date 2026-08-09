# SelfWeb Writing Agent 执行缺口修复清单

> 对照 `selfweb-writing-agent-plan.md` 逐项验收后生成。
>
> 验收日期：2026-08-09。本文件是给 Coding Agent 的修复任务说明。
>
> 原则：先修 P0，再决策 P1，然后按计划继续后续阶段，不得跳阶段。

---

# 0. 执行结论

```text
阶段一（数据层）   基本通过，除 F1 / F2
阶段二（首页）     部分通过，F1 / F3 待处理
阶段三（编辑器）   部分通过，F4 偏离需决策，部分验收项需浏览器复验
阶段四 ~ 阶段十五  未开始（无 api/ 目录，无 AI / 公式 / 发布 / 鉴权任何痕迹）
基础设施           F0 阻断部署，提交前必须修
```

已通过、不要重做的验收项：

```text
[x] 9 篇文章全部迁移为 content/posts/*.md，frontmatter 字段完整（构建脚本强校验）
[x] npm run build:posts 无 error
[x] 构建幂等（连续两次构建产物 checksum 一致）
[x] 单一数据源成立：改 md → 重建 → posts/*.html 变化（test-post 全生命周期验证通过）
[x] 文章 URL 不变，9 篇文章与旧版 diff 仅空白差异（类名、结构、封面图注均保留）
[x] 首页排序 date DESC 正确
[x] 首页模板注入标记 BLOG_POSTS_START/END 存在，非博客区域零改动
[x] posts/*.html 已加入 .gitignore
```

---

# 1. P0：阻断项（提交 / 部署前必须修复）

## F0：Vercel 构建命令未配置

现状：

```text
posts/*.html 已被 .gitignore 排除，且 git 中已暂存删除
```

但仓库中没有：

```text
vercel.json
```

如果 Vercel 项目设置里也没配 build command，下次部署：

```text
所有 /posts/*.html → 404
```

修复（二选一）：

```text
A. 新增 vercel.json：
   {
     "buildCommand": "npm run build",
     "outputDirectory": "."
   }
B. 在 Vercel Dashboard 项目设置中配置 Build Command: npm run build
```

验收：

```text
[ ] 提交并推送后，Vercel 构建日志包含 npm run build
[ ] /posts/ai-to-understanding.html 等 9 个旧 URL 部署后可访问
```

---

## F1：published: false 仍然生成公开 HTML

现状：`scripts/build-posts.js` 的文章生成循环不过滤 `published`，只过滤首页卡片。

实测：

```text
test-post.md 设 published: false → 首页卡片消失（正确）
                              → posts/test-post.html 仍生成（错误）
```

违反计划 5.5：

```text
公共构建默认不能发布该文章
```

修复：生成 `posts/*.html` 的循环增加 `published === true` 过滤。

注意保持计划 5.5 的其他语义：

```text
md 文件仍存在
可以用于编辑
首页不能显示
```

验收：

```text
[ ] published: false → 构建后 posts/ 中无对应 html
[ ] published: false → 首页无卡片
[ ] 改回 true → 两者恢复
[ ] 首页卡片数 = published: true 的文章数
```

---

## F2：标题折行合并时丢空格

`scripts/build-posts.js` 两处：

```js
'{{title}}': title.replaceAll('\n', ''),
// renderBlogCard 中：
escapeHtml(metadata.title).replaceAll('\n', '')
```

把多行标题合并成纯文本时用空字符串拼接，丢空格。

证据：

```text
旧版 posts/token-addiction.html：
<title>我为什么会对 Token 上瘾｜Hongyu

当前生成：
<title>我为什么会对Token 上瘾｜Hongyu

首页卡片标题同样变成「我为什么会对Token 上瘾」
```

修复：两处都改为：

```js
.replaceAll('\n', ' ')
```

验收：

```text
[ ] 重建后 posts/token-addiction.html 的 <title> 与首页卡片标题含空格
[ ] 7 篇含 \n 标题的文章，生成 <title> 与 git HEAD 旧版逐一 diff 为空
```

---

# 2. P1：验收偏差（修复或明确决策，二选一并记录）

## F3：首页卡片文案回归

迁移后首页卡片文案发生了变化（计划 5.6 要求「首页视觉无明显退化」）：

```text
categoryLabel 丢失修饰语：
  随笔 · 记忆 → 随笔
  构建 · 产品 → 构建
  随笔 · 生活 → 随笔
  随笔 · 相遇 → 随笔

多张卡片 excerpt 从手工文案替换为文章 meta description，例如 token-addiction：
  旧：当体验新模型变成一种冲动，真正稀缺的反而不是额度，而是值得被完成的想法。
  新：当购买更多 AI 额度变成一种冲动，我重新审视了体验、消费和真正想完成的东西之间的关系。
```

旧文案可从以下命令恢复查看：

```bash
git show HEAD:index.html
```

决策（二选一）：

```text
A. 把旧首页卡片的 categoryLabel / excerpt 迁移进 frontmatter
   （如需区分「卡片文案」与「文章 description」，可增加可选字段 cardExcerpt）
B. 接受现状，在阶段二报告中说明文案已统一为 frontmatter 单一来源
```

---

## F4：编辑器未按计划使用 Tiptap

计划 6.2：

```text
优先：Tiptap
如果引入 Tiptap 会导致当前纯静态架构难以维护，可以引入轻量构建系统：Vite
```

实际实现：

```text
admin.html = 原生 contenteditable + document.execCommand（已 deprecated）
无 Tiptap，无 Vite，无任何构建
```

具体问题：

```text
1. execCommand 已废弃，浏览器随时可能移除
2. js/editor.js 的 applyInlineCode() 用 extractContents/insertNode 直接改 DOM，
   不进浏览器 undo 栈 → Cmd/Ctrl+Z 在行内代码操作后行为异常
   直接影响：阶段三 undo 验收（6.5）、阶段七 10.4、最终验收 Test 7
3. 无结构化文档模型，阶段八的 block ID / replace_block / insert_after 无法实现
```

决策（必须在进入阶段四前做出并写入文档）：

```text
A. 按 6.2 换 Tiptap + Vite（推荐，阶段六~九都建立在结构化文档上）
B. 保留自研编辑器，但必须写 ADR 说明：
   - inline code 等 DOM 操作如何接入 undo 栈
   - 阶段八 block ID / tool layer 如何在 contenteditable 上实现
```

---

# 3. P2：未开始的阶段（按计划继续，不得跳阶段）

以下阶段当前无任何实现痕迹：

```text
阶段四   Markdown 导入 / 保存 / 读 API / 草稿层       （无 api/ 目录，编辑器不能打开已有文章）
阶段五   数学公式三层（8.1.1：编辑器 + 构建管线 + KaTeX 样式）
阶段六   Selection AI（浮动菜单、服务端代理、Key 不入前端）
阶段七   AI Diff / 接受 / 拒绝 / undo
阶段八   Writing Agent Tool Layer（依赖 F4 的决策结果）
阶段九   全文 Agent
阶段十   草稿自动保存（当前 editor.js 只有手动保存，无 2000ms debounce）
阶段十一 完整预览页（当前仅内联预览面板）
阶段十二 发布（GitHub API commit，15.3 校验含 slug 唯一性 / cover 回退）
阶段十三 鉴权（按 2.5.4：是阶段四部署到生产的前置条件）
阶段十四 错误处理
阶段十五 端到端验收
```

提醒：

```text
阶段四含服务端读接口 GET /api/posts，按 2.5.4，
部署到生产前必须先完成阶段十三（鉴权）。
开发期可在本地或受保护的 Preview 环境进行。
```

---

# 4. 阶段三需浏览器复验项（静态检查无法覆盖）

以下验收项本次只做静态审查，未实际运行浏览器，必须在浏览器复验：

```text
[ ] 6.5  console 0 uncaught errors
[ ] 6.6  中文输入法：无重复字符 / 光标跳动 / composition 被打断 / 字符丢失
[ ] 6.5  undo / redo 实际行为（重点测 inline code 之后再 undo，见 F4-2）
[ ] 6.5  页面刷新后 JS 不崩溃，草稿正确载入
[ ] 4.4-D / 5.6  文章页与首页视觉走查（字体 / 行距 / 封面 / 引用 / 列表 / footer）
```

---

# 5. 提交前检查清单

当前所有改动（含 posts/*.html 的删除）均未 commit。提交前确认：

```text
[ ] F0 / F1 / F2 已修复并重新构建
[ ] npm run build 无 error，且幂等
[ ] 提交内容包含：posts/*.html 的删除、content/、templates/、scripts/、
    package.json、.gitignore、admin.html、js/editor.js、css/editor.css
[ ] posts/*.html 未被重新加入 git
[ ] 推送后 Vercel 构建日志含 npm run build
[ ] 部署后抽查至少 3 个旧文章 URL + 首页
```

---

# 6. 修复执行顺序

```text
F0 → F1 → F2 → 重建 + 验收 → 提交部署
  ↓
F3 决策（首页文案）
  ↓
F4 决策（编辑器技术路线）← 阶段四的入场券
  ↓
按计划继续阶段四，且满足 2.5.4 鉴权前置
```

# 7. 本次执行决策与实现记录

## F3：首页卡片文案

采用方案 A。旧首页卡片的 `categoryLabel` 修饰语与手工摘要已迁入各文章 frontmatter 的 `categoryLabel` / `cardExcerpt`，文章页继续使用 `description` / `deck`。

## F4：编辑器技术路线

采用方案 A。编辑器改为 Tiptap + Vite：Tiptap 负责结构化文档与 history，Vite 负责浏览器 bundle；数学公式使用自定义 Tiptap 节点，Markdown round-trip 保持为编辑器与构建管线之间的边界。

## 阶段完成状态

本次已实现 P0、阶段四至十五的代码与本地验收工具：编辑器、Markdown / 公式、Selection AI、Diff、Tool Layer、全文 Agent、草稿、预览、发布、鉴权和错误处理均已接入。生产发布前仍需在 Vercel 配置 `SELFWEB_EDITOR_SECRET`、`SELFWEB_EDITOR_PASSWORD`、`OPENAI_API_KEY` 与 GitHub 发布变量，并完成真实浏览器 / 部署验收。
