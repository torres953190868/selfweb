# SelfWeb Agent Guide

## 项目概览

SelfWeb 是 Hongyu 的个人网站和写作编辑器，采用“静态网站 + Vite 构建 + Vercel API 路由”的轻量架构：

- 首页和文章页面最终以静态 HTML 发布。
- 文章正文的唯一内容源是 `content/posts/*.md`。
- `scripts/build-posts.js` 在构建时读取 Markdown，生成首页博客卡片和 `posts/*.html`。
- `admin.html` 配合 Tiptap 编辑器支持草稿、预览、公式、选区 AI 和全文 Writing Agent。
- 发布接口通过 GitHub API 将 Markdown 提交回仓库，再由 Vercel 构建部署。

除非用户明确要求，不要把这个项目改造成需要数据库或复杂 CMS 的应用。

## 目录约定

- `content/posts/`：文章 Markdown 和 frontmatter，内容修改优先改这里。
- `scripts/build-posts.js`：文章 frontmatter 校验、Markdown 渲染、首页/文章生成逻辑。
- `scripts/test-selfweb.js`：构建幂等性、文章数量、关键文案、API 和鉴权的 smoke test。
- `templates/index.html`：首页源模板；博客卡片区域由 `BLOG_POSTS_START/END` 标记包围。
- `templates/post.html`：文章页源模板。
- `index.html`：由 `templates/index.html` 生成的首页，不要把博客卡片只改在这里。
- `posts/*.html`：由 Markdown 生成的文章页，属于构建产物并被 `.gitignore` 忽略。
- `admin.html`：写作编辑器页面结构，对外路由为 `/admin`。
- `js/editor.js`：编辑器源码；构建后输出被忽略的 `js/editor.bundle.js`。
- `js/markdown.js`：Markdown 与编辑器 HTML 之间的转换、KaTeX 渲染。
- `api/`：Vercel Serverless Function 和本地 Vite 开发时复用的 API handler。
- `css/style.css`：首页样式；`css/post.css`：文章和预览样式；`css/editor.css`：编辑器样式。
- `assets/`、`images/`：网站图片和静态资源；新增文章封面时确保路径真实存在。
- `demos/`：作品集中的独立演示页面。

## 常用命令

首次安装依赖：

```bash
npm install
```

日常验证：

```bash
npm test              # 构建两次并运行仓库 smoke tests
npm run build:posts  # 只重建 content/posts 对应的首页和文章 HTML
npm run build        # 完整生产构建：文章生成 + Vite bundle
npm run dev          # 先构建，再启动 Vite 开发服务器
```

`npm run dev` 会先执行一次完整构建；编辑器页面依赖生成后的 `js/editor.bundle.js`，不要只运行一个未经构建的静态文件服务器来验证编辑器。

每次修改文章数据、模板、编辑器源码或构建脚本后，至少运行 `npm test`；涉及 Vite bundle、样式或页面交互时，再运行 `npm run build` 并在浏览器中检查对应页面。

## 文章内容规则

新文章必须创建为 `content/posts/<slug>.md`，且文件名必须与 frontmatter 的 `slug` 完全一致。 `slug` 使用小写 kebab-case，例如 `my-new-post`。

构建脚本要求以下字段存在：

```yaml
slug: my-new-post
title: "文章标题"
description: "文章摘要"
date: 2026-08-09
category: essay
categoryLabel: 随笔
cover: /assets/blog/example-cover.png
readTime: 5
author: Hongyu
published: true
```

常用可选字段包括 `cardExcerpt`、`kicker`、`deck`、`coverAlt`、`coverCaption`、`coverLoading`、`previousUrl`、`previousLabel`、`nextUrl`、`nextLabel`。涉及首页卡片文案时优先使用 `cardExcerpt`，不要在生成后的 `index.html` 中硬编码。

`published: true` 的文章才会生成公开的 `posts/<slug>.html` 并出现在首页和编辑器文章列表中；`published: false` 仍保留在 `content/posts/`，但不应出现在公开构建产物中。

当前 Markdown 渲染器支持标题、段落、引用、有序/无序列表、围栏代码块、链接、图片、粗体、斜体、行内代码、行内公式 `$...$`、块级公式 `$$...$$`，并兼容部分已有 raw HTML block。修改渲染逻辑时要同时考虑服务端构建和编辑器的 `markdownToHtml` / `htmlToMarkdown` 转换。

多行标题在 HTML `<title>` 和首页卡片中应以空格合并，不要使用空字符串直接拼接导致中文和英文粘连。

## 编辑器与 Agent 约束

- 编辑器使用 Tiptap transaction 管理内容、选区、undo/redo 和 block ID。
- 不要重新引入 `document.execCommand`，也不要通过直接替换编辑器 DOM 绕过 Tiptap history。
- AI 只能通过结构化操作修改内容，例如 `replace_selection`、`replace_block`、`insert_after`、`insert_before`、`insert_math`；不要让模型返回整篇 HTML 并直接写入 DOM。
- 文章正文仍以 Markdown 作为发布边界；编辑器负责在 Markdown 与结构化 HTML 之间转换。
- 预览区域必须继续经过现有的 HTML 清理逻辑，并调用 KaTeX 公式渲染。
- 修改编辑器 UI 时同步考虑草稿自动保存、手动保存、加载已发布文章、预览、AI 接受/拒绝、undo/redo 和未保存离开提示。

## API、鉴权与存储

现有路由：

- `GET /api/posts`：返回已发布文章列表。
- `GET /api/posts/:slug`：返回已发布文章正文和 metadata。
- `POST /api/auth/login`：校验编辑器密码并设置 HttpOnly session cookie。
- `POST /api/agent`：登录后执行选区 AI 或全文 Agent 操作；没有 OpenAI key 时使用本地 fallback。
- `POST /api/publish`：登录后校验文章并通过 GitHub API 创建或更新 `content/posts/<slug>.md`。

本地开发时，`vite.config.js` 将上述 API 映射到 `api/` handler；修改 API 时要同时保持 Vercel handler 和本地 Vite middleware 的调用方式兼容。

草稿只保存在当前浏览器的 `localStorage`，不应因为“保存草稿”创建 Git commit 或触发部署。Vercel 运行时文件系统不可用于写入仓库内容；只有“发布”才应调用 GitHub API。

生产环境需要在 Vercel 配置以下变量：

- `SELFWEB_EDITOR_SECRET`
- `SELFWEB_EDITOR_PASSWORD`
- `OPENAI_API_KEY`（可选；未配置时使用本地 Agent fallback）
- `OPENAI_MODEL`（可选，默认 `gpt-4o-mini`）
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`（可选，默认 `main`）

任何 secret 都不能写入 `index.html`、`admin.html`、`js/`、静态资源或客户端 bundle；只能从服务端环境变量读取。

## 页面与资源修改

- 首页视觉和静态内容优先改 `templates/index.html` 与 `css/style.css`，然后运行构建。
- 文章页布局改 `templates/post.html` 与 `css/post.css`。
- 编辑器布局改 `admin.html` 与 `css/editor.css`，行为改 `js/editor.js` / `js/markdown.js`。
- 根目录首页链接使用站点根路径或相对首页路径；文章页位于 `posts/`，资源和首页链接需要注意多一层 `../`。
- 保留现有的博客区域标记 `BLOG_POSTS_START` 和 `BLOG_POSTS_END`，构建脚本依赖它们定位卡片区域。
- 不要提交 `posts/*.html` 或 `js/editor.bundle.js` 这类被忽略的生成文件，除非用户明确要求提交构建产物。

## 安全与兼容性检查

处理用户输入、frontmatter、文章正文或 AI 返回值时，继续使用现有的 HTML/attribute escaping 和预览清理逻辑；不要把未清理的内容插入 `innerHTML`。

新增 slug 时避开 `admin`、`api`、`assets`、`css`、`js`、`content`、`templates`、`posts` 等保留路径。发布接口必须保留服务端校验，不能只依赖表单校验。

不要用 `git reset --hard`、`git checkout --` 或删除命令覆盖用户已有改动。仓库可能存在未提交的迁移、内容或样式变更，修改时只触碰与当前任务相关的文件。

## 完成标准

提交代码前确认：

1. `npm test` 通过。
2. `npm run build` 通过，且连续构建结果稳定、无未处理异常。
3. 文章改动会反映到 `content/posts/`，而不是只反映到生成 HTML。
4. 涉及 UI 时检查首页、文章页和 `/admin` 的实际浏览器表现。
5. 涉及 API、鉴权或发布时检查匿名请求、登录请求和错误响应，不泄露 secret。
6. 汇报中明确说明实际运行过的命令，以及尚未验证的外部依赖（例如 GitHub/OpenAI/Vercel 环境变量）。
