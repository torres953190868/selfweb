# SelfWeb Writing Agent 实施计划

> 目标：把当前 `selfweb` 静态个人网站升级为一个支持**文章编辑、AI 选区改写、数学公式、全文理解、预览、发布**的 Writing Agent 系统。
>
> 该文档是给 Coding Agent（Codex / Claude Code / Cursor Agent 等）执行的工程任务说明。
>
> 核心原则：**每个阶段独立完成、独立验收。未通过当前阶段验收，不允许进入下一阶段。**

---

# 0. 项目背景

当前仓库：

```text
https://github.com/torres953190868/selfweb
```

当前技术形态：

```text
index.html
css/
js/
posts/*.html
assets/
```

当前特点：

- 网站是静态 HTML/CSS/JS；
- 每篇文章是独立的 `posts/*.html`；
- 首页博客卡片写死在 `index.html`；
- 发布新文章时，需要同时修改文章 HTML 和首页；
- 当前没有文章后台；
- 当前没有统一内容数据源；
- 当前没有 AI 编辑能力；
- 当前部署在 Vercel。

目标不是一次性重构成复杂 CMS。

目标是逐步增加：

```text
结构化文章内容
    ↓
浏览器编辑器
    ↓
Markdown / JSON 保存
    ↓
文章预览
    ↓
AI Selection Editing
    ↓
Writing Agent Tools
    ↓
发布
```

---

# 1. 总体产品目标

最终用户应该能够访问：

```text
/editor
```

并完成：

1. 创建文章；
2. 编辑标题；
3. 编辑正文；
4. 使用标题、列表、引用、代码块等格式；
5. 插入数学公式；
6. 选中文字；
7. 调用 AI：
   - 润色；
   - 简化；
   - 扩写；
   - 更专业；
   - 自定义指令；
8. 查看 AI 修改前后差异；
9. 接受或拒绝修改；
10. 让 Agent 阅读全文并修改指定部分；
11. 保存草稿；
12. 预览文章；
13. 发布文章；
14. 发布后首页自动出现对应博客卡片。

---

# 2. 总体技术原则

## 2.1 内容与页面必须分离

禁止继续把文章正文直接作为唯一数据源写死在：

```text
posts/*.html
```

文章正文必须迁移到：

```text
content/posts/
```

建议优先使用 Markdown：

```text
content/posts/my-post.md
```

文章 HTML 应成为构建产物，而不是主要内容源。

---

## 2.2 Agent 不直接操作页面 DOM

禁止让 AI 返回：

```html
<div>...</div>
```

然后直接替换浏览器 DOM。

Agent 必须操作：

```text
document
selection
block
range
```

编辑器负责：

```text
DOM 渲染
光标
选区
undo / redo
transaction
```

---

## 2.3 Agent 必须通过 Tool 修改内容

后期 Agent 不应该直接返回整篇文章。

推荐 Tool：

```text
get_document
get_selection
replace_selection
replace_block
insert_after
insert_before
insert_math
find_text
```

---

## 2.4 AI Key 不得进入前端

禁止：

```js
const OPENAI_API_KEY = "..."
const GITHUB_TOKEN = "..."
```

出现在：

```text
index.html
js/
public/
client bundle
```

所有 Secret 必须保存在：

```text
Vercel Environment Variables
```

并通过服务器 API 使用。

---

# 2.5 存储与部署架构决策

以下四项是后续所有阶段的前提，执行前必须先定死，不允许中途改方案。

## 2.5.1 Vercel 文件系统只读

Vercel Serverless Functions 除：

```text
/tmp
```

以外，文件系统只读。

任何 API 都不能在运行时直接写：

```text
content/posts/*.md
```

---

## 2.5.2 草稿与发布分层

草稿（编辑器保存、自动保存）：

```text
浏览器 localStorage
```

可选增强：Vercel KV / Blob。

草稿必须满足：

```text
不产生 Git commit
不触发 Vercel 部署
刷新 / 重开浏览器后不丢
```

发布（点击"发布"按钮）：

```text
服务端 API 通过 GitHub API 将 Markdown commit 到仓库
```

只有发布才产生 commit。

打开文章时如果存在本地草稿：

```text
加载草稿
提示"存在未发布的修改"
```

---

## 2.5.3 HTML 只在构建时生成

以下内容是构建产物：

```text
posts/*.html
index.html 的博客卡片区
```

规则：

- 构建产物不再手写，不再提交进 git；
- 仓库只保留 `content/posts/*.md`、`templates/`、站点骨架；
- 构建脚本接入 Vercel build command：

```bash
npm run build
```

- `.gitignore` 排除 `posts/*.html`；
- 阶段一迁移时从 git 删除现有 `posts/*.html`，并确认部署后旧 URL 不变。

---

## 2.5.4 鉴权前置

第一个服务端写接口上线前，鉴权必须先就位。

"阶段十三：编辑器鉴权"虽然编号靠后，但它是以下所有阶段的前置：

```text
阶段四（保存 API）
阶段六（Selection AI）
阶段十二（发布）
```

在鉴权完成前：

```text
禁止把含服务端写接口的版本部署到生产域名
```

可以在本地或受保护的 Vercel Preview 环境开发。

---

# 3. 推荐目录结构

完成基础改造后，目标结构建议为：

```text
selfweb/
│
├── index.html
├── editor.html
│
├── content/
│   └── posts/
│       ├── ai-to-understanding.md
│       ├── crossroads.md
│       └── ...
│
├── templates/
│   ├── post.html
│   └── index.html
│
├── posts/                      # 构建产物，不提交进 git
│   ├── ai-to-understanding.html
│   └── ...
│
├── scripts/
│   ├── build-posts.js
│   └── build-blog-index.js
│
├── js/
│   ├── main.js
│   ├── editor.js
│   ├── agent.js
│   └── diff.js
│
├── css/
│   ├── style.css
│   ├── post.css
│   └── editor.css
│
├── api/
│   ├── posts.js                # GET 列表 / POST 创建
│   ├── posts/
│   │   └── [slug].js           # GET 单篇 / PUT 更新（发布时）
│   ├── agent.js
│   └── publish.js
│
└── package.json
```

Agent 可以根据实际构建方案微调目录，但必须满足：

- 内容源独立；
- 页面模板独立；
- 编辑器逻辑独立；
- Agent API 独立；
- Secret 仅存在服务端。

---

# 4. 阶段一：文章数据层改造

## 4.1 目标

把现有：

```text
posts/*.html
```

从“文章数据源”改造成“文章输出页面”。

新增：

```text
content/posts/*.md
```

作为唯一文章内容源。

---

## 4.2 Markdown 格式

每篇文章需要 frontmatter。

示例：

```md
---
slug: ai-to-understanding
title: 把 AI 的答案变成自己的理解
description: AI 可以无限生成，但生成不等于理解。
date: 2026-05-01
category: building
categoryLabel: 构建
cover: /assets/blog/ai-understanding-cover.png
readTime: 7
author: Hongyu
published: true
---

我很喜欢和 AI 聊天。

## 知识是网状的，对话却是线性的

正文……
```

必须至少支持字段：

```text
slug
title
description
date
category
categoryLabel
cover
readTime
author
published
```

可选字段：

```text
coverCaption    # 封面图注
```

---

## 4.3 任务

Agent 必须：

1. 创建 `content/posts/`；
2. 将现有文章内容迁移为 Markdown；
3. 保留现有文章：
   - 标题；
   - 副标题/description；
   - 日期；
   - 分类；
   - 阅读时间；
   - 封面与封面图注；
   - 正文；
   - 正文内图片；
   - 引用；
   - 列表；
   - 链接；
4. 创建文章构建脚本；
5. 建立统一 `post` 模板；
6. 从 Markdown 生成 `posts/*.html`；
7. 保持现有文章 URL 不变。

例如：

```text
/posts/ai-to-understanding.html
```

仍然必须可访问。

---

## 4.4 验收标准

### A. 数据源

满足：

```text
content/posts/*.md
```

已经存在。

现有文章全部完成迁移。

---

### B. 单一数据源

随机修改一篇：

```text
content/posts/*.md
```

运行构建命令后：

```text
posts/*.html
```

对应内容发生变化。

不允许手动修改 HTML 才能生效。

---

### C. URL 不变

以下旧链接必须继续可访问：

```text
/posts/ai-to-understanding.html
/posts/crossroads.html
...
```

---

### D. 页面视觉

文章页面与改造前相比：

- 字体正常；
- 行距正常；
- 标题正常；
- 封面正常；
- 引用正常；
- 列表正常；
- footer 正常。

不可出现明显视觉退化。

---

### E. 构建

必须提供明确命令，例如：

```bash
npm run build:posts
```

运行后无 error。

---

## 4.5 阶段完成定义

只有以下全部通过，才能进入阶段二：

```text
[ ] 所有旧文章已经迁移
[ ] Markdown 是唯一正文数据源
[ ] 构建脚本可重复执行
[ ] URL 保持不变
[ ] 页面视觉基本一致
[ ] 构建无报错
```

---

# 5. 阶段二：首页文章列表自动生成

## 5.1 目标

移除首页 `index.html` 中手工维护博客列表的问题。

首页博客卡片必须来自文章 metadata。

---

## 5.2 任务

读取：

```text
content/posts/*.md
```

中的 frontmatter。

根据：

```text
published: true
```

生成首页文章列表。

排序规则：

```text
date DESC
```

即最新文章在最前面。

首页由模板生成：

```text
templates/index.html
```

博客卡片区使用注入标记，构建脚本必须幂等：

```text
重复执行构建，结果不变
```

---

## 5.3 首页卡片字段

卡片需要自动生成：

```text
title
description
date
category
categoryLabel
cover
readTime
slug
```

URL：

```text
/posts/{slug}.html
```

---

## 5.4 验收标准

创建：

```text
content/posts/test-post.md
```

配置：

```yaml
published: true
```

执行构建后：

首页必须自动出现文章。

删除测试文章后重新构建：

首页对应文章消失。

---

## 5.5 published 验收

如果：

```yaml
published: false
```

则：

- 文件仍存在；
- 可以用于编辑；
- 首页不能显示；
- 公共构建默认不能发布该文章。

---

## 5.6 阶段完成定义

```text
[ ] 首页不再需要手工添加文章卡片
[ ] 新文章可自动进入首页
[ ] 日期排序正确
[ ] published=false 不显示
[ ] 首页视觉无明显退化
```

---

# 6. 阶段三：基础浏览器编辑器

## 6.1 目标

新增：

```text
/editor
```

或：

```text
/editor.html
```

用户可以直接编辑文章。

纯静态部署下 `/editor` 依赖 Vercel `cleanUrls` 配置，或直接提供 `editor.html`。二选一，全站链接保持一致。

---

## 6.2 推荐编辑器

优先：

```text
Tiptap
```

如果引入 Tiptap 会导致当前纯静态架构难以维护，可以引入轻量构建系统。

允许：

```text
Vite
```

但禁止为了编辑器整体迁移成大型 Next.js 项目。

---

## 6.3 必须支持

编辑器最低能力：

```text
普通段落
H1
H2
H3
bold
italic
blockquote
ordered list
bullet list
code
code block
undo
redo
```

---

## 6.4 UI

至少包含：

```text
文章标题
正文编辑器
保存按钮
预览按钮
发布按钮（本阶段可暂时 disabled）
```

---

## 6.5 验收标准

用户进入：

```text
/editor
```

可以：

1. 输入文章；
2. 修改文章；
3. 使用标题；
4. 使用列表；
5. 使用引用；
6. 使用 code；
7. undo；
8. redo。

浏览器 console：

```text
0 uncaught errors
```

---

## 6.6 输入法验收

必须测试中文输入法。

输入：

```text
这是一个中文输入测试。
```

不能出现：

- 重复字符；
- 光标跳动；
- composition 被打断；
- 输入字符丢失。

---

## 6.7 阶段完成定义

```text
[ ] /editor 可访问
[ ] 中文输入正常
[ ] 基础格式正常
[ ] undo / redo 正常
[ ] 页面刷新不会立即导致 JS 崩溃
[ ] console 无 uncaught error
```

---

# 7. 阶段四：Markdown 导入和保存

## 7.1 目标

编辑器能够操作真实文章。

实现：

```text
Markdown → Editor
Editor → Markdown
```

---

## 7.2 任务

支持：

```text
打开文章
保存文章
创建文章
```

建议提供文章列表：

```text
/editor
```

左侧：

```text
文章列表
```

右侧：

```text
Editor
```

---

## 7.3 保存 API

遵循 2.5.2 的分层决策。

读接口（读取 git 中已 commit 的 Markdown）：

```text
GET  /api/posts
GET  /api/posts/:slug
```

保存与自动保存：

```text
写入草稿层（localStorage），不调用写文件 API
```

真正写回仓库只发生在发布（阶段十二）。

如果后续需要跨设备草稿，可以增加：

```text
POST /api/drafts
PUT  /api/drafts/:slug
```

存 Vercel KV / Blob，同样不产生 commit。

打开文章时若草稿层存在该文章的草稿：

```text
加载草稿
提示"存在未发布的修改"
```

---

## 7.3.1 前置条件

本阶段开始含服务端接口。按 2.5.4，部署到生产前必须先完成鉴权（阶段十三）。

---

## 7.4 验收标准

打开现有文章：

```text
ai-to-understanding
```

编辑器必须正确显示正文。

修改一句话：

```text
AAA
```

保存。

重新刷新。

必须仍然显示：

```text
AAA
```

---

## 7.5 Markdown round-trip 验收

执行：

```text
Markdown A
↓
Editor
↓
Markdown B
```

要求：

- 正文内容不丢；
- heading 不丢；
- list 不丢；
- blockquote 不丢；
- code block 不丢。

允许格式化细节变化。

不允许语义内容丢失。

---

# 8. 阶段五：数学公式支持

## 8.1 目标

支持 LaTeX 数学公式。

---

## 8.1.1 三层必须同步支持

数学公式不是只在编辑器里实现，必须同时覆盖：

```text
1. 编辑器：Tiptap 数学节点（所见即所得）
2. 构建管线：Markdown → HTML 支持 $...$ / $$...$$
   （remark-math + rehype-katex 或等价方案）
3. 页面样式：post.css 引入 KaTeX CSS
```

阶段一选择 Markdown 构建管线时，必须确认其支持插件扩展，避免本阶段返工。

---

## 8.2 必须支持

inline：

```text
$E = mc^2$
```

block：

```text
$$
\operatorname{Attention}(Q,K,V)
=
\operatorname{softmax}
\left(
\frac{QK^T}{\sqrt{d_k}}
\right)V
$$
```

---

## 8.3 编辑器行为

用户可以：

1. 插入 block math；
2. 编辑 LaTeX；
3. 看到渲染结果；
4. 保存；
5. 刷新后公式仍存在。

---

## 8.4 验收公式

使用：

```latex
\operatorname{Attention}(Q,K,V)
=
\operatorname{softmax}
\left(
\frac{QK^T}{\sqrt{d_k}}
\right)V
```

验收：

```text
[ ] 编辑器正确渲染
[ ] 预览正确渲染
[ ] 发布页面正确渲染
[ ] 刷新后公式不丢
```

---

# 9. 阶段六：Selection AI

## 9.1 目标

实现第一版 AI 编辑能力。

用户选择文字后，可以让 AI 修改该选区。

---

## 9.2 UI

选中文字后显示浮动菜单。

至少：

```text
润色
简化
扩写
更专业
自定义指令
```

---

## 9.3 AI 请求

前端传：

```json
{
  "selectedText": "...",
  "instruction": "...",
  "beforeContext": "...",
  "afterContext": "..."
}
```

不允许将 API Key 传给浏览器。

---

## 9.4 AI 返回格式

第一版可以：

```json
{
  "replacement": "..."
}
```

不允许 AI 返回整个 HTML 页面。

---

## 9.5 上下文

选区 AI 至少提供：

```text
选中文字
前一个段落
后一个段落
用户指令
```

---

## 9.6 验收测试

原文：

```text
Transformer通过Attention机制处理输入。
```

选中。

点击：

```text
更专业
```

返回后：

- 只影响选中文字；
- 其他段落不能改变；
- 光标状态不能导致全文丢失。

---

## 9.7 自定义指令

用户输入：

```text
改得更适合初学者，但不要增加篇幅。
```

Agent 必须只根据该指令修改 selection。

---

# 10. 阶段七：AI Diff / 接受 / 拒绝

## 10.1 目标

AI 不能直接静默覆盖用户内容。

AI 修改后必须允许：

```text
接受
拒绝
```

---

## 10.2 UI

至少显示：

```diff
- 原内容
+ 新内容
```

然后：

```text
接受
拒绝
```

---

## 10.3 验收标准

点击：

```text
拒绝
```

文章必须 100% 恢复原选区。

点击：

```text
接受
```

新文本成为正文。

---

## 10.4 Undo

接受 AI 修改后：

```text
Ctrl/Cmd + Z
```

必须可以撤销。

---

# 11. 阶段八：Writing Agent Tool Layer

## 11.1 目标

从“AI 改选区”升级到真正的 Writing Agent。

Agent 可以读取整篇文章并主动选择修改位置。

---

## 11.2 第一版 Tool

必须实现：

```text
get_document
get_selection
find_text
replace_selection
replace_block
insert_after
insert_before
insert_math
```

---

## 11.3 get_document

返回文章结构。

禁止仅返回 HTML。

建议：

```json
{
  "title": "...",
  "blocks": [
    {
      "id": "block_1",
      "type": "paragraph",
      "text": "..."
    },
    {
      "id": "block_2",
      "type": "heading",
      "level": 2,
      "text": "..."
    }
  ]
}
```

---

## 11.4 Block ID

每个 block 必须有稳定 ID。

例如：

```text
block_x8a92
```

要求：

- 普通编辑时尽量稳定；
- Agent 使用 block ID 定位；
- 不依赖 DOM index。

注意：Markdown round-trip 不保留 block ID。

block ID 的有效范围：

```text
由编辑器在加载文档时生成
仅在当前编辑会话内稳定
保存-刷新后允许重新分配
```

因此 Agent 的 tool 调用限定在一次编辑会话内完成。

---

## 11.5 replace_block

参数：

```json
{
  "blockId": "block_123",
  "content": "..."
}
```

必须只替换对应 block。

---

## 11.6 insert_after

参数：

```json
{
  "blockId": "block_123",
  "content": "..."
}
```

必须插入在目标 block 后。

---

## 11.7 insert_math

参数：

```json
{
  "blockId": "block_123",
  "latex": "..."
}
```

插入公式。

---

# 12. 阶段九：全文 Agent

## 12.1 目标

用户无需选择文字。

用户可以输入：

```text
第三部分和第二部分衔接有点生硬，帮我改一下。
```

Agent：

```text
get_document
↓
找到第二、第三部分
↓
replace_block / insert_after
↓
生成修改
```

---

## 12.2 Agent 行为约束

Agent 必须：

1. 先读取文档；
2. 再决定修改位置；
3. 修改尽量局部；
4. 不得无理由重写全文。

---

## 12.3 修改数量

每次 Agent 最多执行：

```text
10 个写操作
```

超过需要停止并告诉用户：

```text
本次修改范围较大，建议分步骤处理。
```

---

## 12.4 验收任务 A

文章有：

```text
## Attention

...

## Multi-Head Attention

...
```

用户：

```text
在这两个章节之间补一段过渡。
```

验收：

```text
[ ] Agent 找到正确章节
[ ] Agent 插入一段
[ ] 其他章节不变化
```

---

## 12.5 验收任务 B

用户：

```text
全文看看哪里需要加数学公式，最多补两个。
```

验收：

```text
[ ] Agent 读取全文
[ ] 最多插入两个公式
[ ] 公式与上下文相关
[ ] 不修改无关段落
```

---

# 13. 阶段十：草稿与自动保存

## 13.1 目标

避免编辑内容丢失。

---

## 13.2 自动保存

用户停止输入：

```text
2 秒
```

后自动保存草稿。

建议 debounce：

```text
2000ms
```

保存目标是草稿层（见 2.5.2）：

```text
不产生 Git commit
不触发 Vercel 部署
```

---

## 13.3 状态显示

编辑器顶部显示：

```text
正在保存...
已保存
保存失败
```

---

## 13.4 验收

输入：

```text
测试自动保存
```

等待保存成功。

关闭标签页。

重新进入。

内容仍存在。

---

# 14. 阶段十一：预览

## 14.1 目标

用户发布前可以看到最终文章。

---

## 14.2 预览必须复用正式文章 CSS

禁止编辑器预览和正式文章完全两套样式。

预览必须尽可能复用：

```text
css/post.css
```

---

## 14.3 验收

同一篇文章：

```text
Preview
```

和最终：

```text
/posts/slug.html
```

应基本一致。

检查：

```text
title
paragraph
heading
list
blockquote
code
math
image
```

---

# 15. 阶段十二：发布

## 15.1 目标

用户点击：

```text
发布
```

完成文章上线。

---

## 15.2 发布流程

推荐：

```text
Editor
↓
服务端生成 Markdown
↓
GitHub API commit（仅 content/posts/*.md）
↓
Vercel 自动构建 + 部署（build 在此发生）
```

---

## 15.3 发布前校验

必须检查：

```text
title 非空
slug 非空
slug 唯一，且不与保留路径冲突（editor / api / assets 等）
description 非空
date 合法
正文非空
cover 缺失时回退默认封面
```

---

## 15.4 GitHub

发布操作只能由服务端执行。

Token 不得泄露到前端。

---

## 15.5 commit message

推荐：

```text
publish: {slug}
```

更新：

```text
update: {slug}
```

---

## 15.6 验收

新建：

```text
agent-test-post
```

点击发布。

验收：

```text
[ ] GitHub 出现对应 commit
[ ] content/posts/agent-test-post.md 存在于仓库
[ ] 部署完成后 /posts/agent-test-post.html 可访问（构建产物，无需提交进 git）
[ ] 首页出现文章
[ ] Vercel 页面可访问
```

---

# 16. 阶段十三：编辑器鉴权

> 注意：本阶段编号虽靠后，但按 2.5.4 的决策，它是阶段四、六、十二等所有含服务端写接口阶段的前置条件。未完成本阶段，禁止把含写接口的版本部署到生产域名。

## 16.1 目标

不能允许所有访客进入编辑器并发布。

---

## 16.2 最低要求

以下接口必须受到保护：

```text
save
publish
agent
```

至少需要登录或 server-side secret/session。

---

## 16.3 禁止方案

禁止单纯在前端：

```js
if (password === "123456")
```

这种方式没有实际安全性。

---

## 16.4 验收

匿名访问：

```text
/api/publish
```

必须返回：

```text
401
```

或：

```text
403
```

已授权用户才能发布。

---

# 17. 阶段十四：错误处理

所有重要操作必须显示失败状态。

包括：

```text
读取文章失败
保存失败
AI 请求失败
发布失败
GitHub API 失败
Markdown parse 失败
```

禁止：

```text
catch(e) {}
```

静默吞掉异常。

---

## 验收

主动让 AI API 返回 500。

页面：

```text
不能崩溃
不能丢正文
必须显示错误信息
可以重新尝试
```

---

# 18. 阶段十五：最终端到端验收

Agent 完成全部开发后，必须执行以下测试。

---

## Test 1：创建文章

创建：

```text
标题：Writing Agent Test
slug: writing-agent-test
```

输入 3 段内容。

验收：

```text
PASS / FAIL
```

---

## Test 2：格式

插入：

```text
H2
blockquote
bullet list
code block
```

全部正确显示。

---

## Test 3：公式

插入：

```latex
E = mc^2
```

以及：

```latex
\operatorname{Attention}(Q,K,V)
=
\operatorname{softmax}
\left(
\frac{QK^T}{\sqrt{d_k}}
\right)V
```

全部正常。

---

## Test 4：AI Selection

选中文字：

```text
AI可以帮助人类写作。
```

指令：

```text
写得更专业。
```

验收：

```text
只修改 selection
```

---

## Test 5：拒绝 AI

点击拒绝。

必须恢复原文。

---

## Test 6：接受 AI

重新生成。

点击接受。

正文更新。

---

## Test 7：Undo

执行：

```text
Cmd/Ctrl + Z
```

恢复修改前版本。

---

## Test 8：全文 Agent

用户：

```text
找一个适合的位置补一段关于 Attention 的解释。
```

Agent 必须：

```text
读取全文
找到位置
插入内容
```

---

## Test 9：保存

刷新页面。

所有内容仍存在。

---

## Test 10：发布

点击发布。

最终：

```text
/posts/writing-agent-test.html
```

可访问。

---

## Test 11：首页

首页自动出现：

```text
Writing Agent Test
```

---

## Test 12：安全

检查浏览器：

```text
View Source
DevTools
Network
JS bundle
```

不得发现：

```text
OPENAI_API_KEY
GITHUB_TOKEN
```

---

# 19. Agent 开发纪律

Coding Agent 执行该项目时必须遵守：

## 19.1 不允许跨阶段

例如阶段三没有完成：

```text
Markdown editor
```

则禁止直接做全文 Agent。

---

## 19.2 每阶段结束必须汇报

格式：

```md
## Phase X Result

### Implemented
- ...
- ...

### Files Changed
- ...

### Verification
- [x] ...
- [x] ...

### Known Issues
- ...

### Ready for Next Phase
YES / NO
```

---

## 19.3 NO 时禁止继续

如果：

```text
Ready for Next Phase: NO
```

必须先修复。

---

# 20. 每阶段代码质量要求

必须：

```text
无明显重复代码
无 hard-coded secret
无 console error
无未处理 Promise rejection
无明显 XSS 注入点
保存操作有失败处理
Agent 操作可 undo
```

---

# 21. 优先级

## P0

必须完成：

```text
Markdown 数据源
自动构建文章
自动首页
Editor
保存
Selection AI
Diff
公式
发布
鉴权
```

---

## P1

完成 P0 后：

```text
全文 Agent
Block Tools
自动保存
```

---

## P2

以后再考虑：

```text
RAG
Memory
多 Agent
知识库
Web Search
版本历史
多人协作
评论
Agent 自动配图
SEO Agent
```

禁止在 P0 阶段提前实现 P2。

---

# 22. 非目标

当前版本不要做：

```text
完整 CMS
多人协作
Notion 克隆
Google Docs 克隆
复杂 RBAC
多租户
Vector DB
LangGraph
复杂 Agent Workflow
```

---

# 23. Definition of Done

整个项目只有满足以下条件才算完成：

```text
[ ] 文章已经脱离手写 HTML
[ ] Markdown 为内容源
[ ] 首页自动生成
[ ] Editor 可编辑真实文章
[ ] 中文输入正常
[ ] Markdown 可读写
[ ] 数学公式正常
[ ] Selection AI 正常
[ ] AI 修改支持接受/拒绝
[ ] AI 修改支持 undo
[ ] Agent 可以读取全文
[ ] Agent 可以使用工具修改局部内容
[ ] 草稿自动保存
[ ] Preview 正常
[ ] Publish 正常
[ ] GitHub commit 正常
[ ] Vercel 页面上线
[ ] Secret 不泄露
[ ] 编辑接口有鉴权
[ ] 浏览器 console 无明显错误
[ ] 所有 E2E Test PASS
```

---

# 24. Coding Agent 首次执行指令

将本文件交给 Coding Agent 后，第一条指令建议使用：

```text
Read this entire implementation plan first.

Then inspect the current repository before changing anything.

Start with Phase 1 only.

Do not implement later phases early.

Before coding:
1. inspect the current post structure;
2. inspect index.html blog cards;
3. inspect post CSS;
4. propose the minimum Phase 1 changes.

Then implement Phase 1.

After implementation, run the Phase 1 acceptance tests.

Finally report using the required Phase Result format.

Do not start Phase 2 unless every Phase 1 acceptance criterion passes.
```

---

# 25. 核心设计原则回顾

整个系统应该始终遵循：

```text
用户
↓
Editor
↓
Structured Document
↓
Agent
↓
Tools
↓
Editor Transaction
↓
Diff
↓
Accept / Reject
↓
Save
↓
Publish
```

而不是：

```text
用户
↓
把整个 HTML 发给 AI
↓
AI 返回另一份 HTML
↓
覆盖整个页面
```

最终目标：

> 构建一个面向文章和知识内容的 Coding Agent 体验。

即：

```text
Cursor : Code
Writing Agent : Document
```
