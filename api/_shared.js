const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { loadPosts } = require('../scripts/build-posts');
const SESSION_COOKIE = 'selfweb_editor_session';
const RESERVED_SLUGS = new Set(['admin', 'api', 'assets', 'css', 'js', 'content', 'templates', 'posts']);

function sendJson(res, status, payload, headers = {}) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
    res.end(JSON.stringify(payload));
}

function errorJson(res, status, message) {
    sendJson(res, status, { error: message });
}

function readJson(req) {
    if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
    if (typeof req.body === 'string') {
        try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.reject(new Error('请求 JSON 无效')); }
    }
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 2_000_000) {
                reject(new Error('请求体过大'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!raw.trim()) return resolve({});
            try { resolve(JSON.parse(raw)); } catch { reject(new Error('请求 JSON 无效')); }
        });
        req.on('error', reject);
    });
}

function parseCookies(req) {
    return String(req.headers?.cookie || '').split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return cookies;
        cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
        return cookies;
    }, {});
}

function getSecret() {
    if (process.env.SELFWEB_EDITOR_SECRET) return process.env.SELFWEB_EDITOR_SECRET;
    return process.env.NODE_ENV === 'production' ? null : 'local-development-secret-change-me';
}

function getPassword() {
    if (process.env.SELFWEB_EDITOR_PASSWORD) return process.env.SELFWEB_EDITOR_PASSWORD;
    return process.env.NODE_ENV === 'production' ? null : 'local-development-only';
}

function signSession() {
    const secret = getSecret();
    if (!secret) return null;
    return crypto.createHmac('sha256', secret).update('editor').digest('hex');
}

function isAuthenticated(req) {
    const expected = signSession();
    if (!expected) return false;
    const actual = parseCookies(req)[SESSION_COOKIE] || '';
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function requireAuth(req, res) {
    if (isAuthenticated(req)) return true;
    errorJson(res, 401, '需要登录后才能执行此操作');
    return false;
}

async function login(req, res) {
    const body = await readJson(req);
    const expectedPassword = getPassword();
    const suppliedPassword = String(body.password || '');
    if (!expectedPassword || !suppliedPassword || suppliedPassword !== expectedPassword) {
        errorJson(res, 401, '密码不正确或服务端尚未配置编辑器密码');
        return;
    }
    const session = signSession();
    sendJson(res, 200, { ok: true }, {
        'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(session)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    });
}

function listPosts() {
    return loadPosts()
        .filter((post) => post.metadata.published)
        .sort((left, right) => String(right.metadata.date).localeCompare(String(left.metadata.date)));
}

function getPost(slug) {
    return listPosts().find((post) => post.metadata.slug === slug) || null;
}

function validatePublishPayload(payload, existingSlugs = new Set()) {
    const metadata = payload?.metadata || {};
    const body = String(payload?.body || '').trim();
    const slug = String(metadata.slug || '').trim();
    const title = String(metadata.title || '').trim();
    const description = String(metadata.description || '').trim();
    const date = String(metadata.date || '').trim();
    if (!title) throw new Error('标题不能为空');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Slug 必须是小写 kebab-case');
    if (RESERVED_SLUGS.has(slug)) throw new Error('Slug 与保留路径冲突');
    if (existingSlugs.has(slug) && !payload.allowUpdate) throw new Error('Slug 已存在，请改名或明确更新已有文章');
    if (!description) throw new Error('摘要不能为空');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error('日期必须是有效的 YYYY-MM-DD');
    if (!body) throw new Error('正文不能为空');
    return {
        slug,
        title: metadata.title,
        description,
        date,
        category: metadata.category || 'essay',
        categoryLabel: metadata.categoryLabel || '随笔',
        cardExcerpt: metadata.cardExcerpt || description,
        cover: metadata.cover || '/assets/blog/ai-understanding-cover.png',
        coverAlt: metadata.coverAlt || title,
        readTime: Number(metadata.readTime) || 5,
        author: metadata.author || 'Hongyu',
        published: true
    };
}

function frontmatterValue(value) {
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    return JSON.stringify(String(value));
}

function serializePost(metadata, body) {
    const fields = ['slug', 'title', 'description', 'date', 'category', 'categoryLabel', 'cardExcerpt', 'cover', 'coverAlt', 'readTime', 'author', 'published'];
    const frontmatter = fields.map((field) => `${field}: ${frontmatterValue(metadata[field])}`).join('\n');
    return `---\n${frontmatter}\n---\n\n${String(body).trim()}\n`;
}

function githubConfig() {
    const config = {
        token: process.env.GITHUB_TOKEN,
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        branch: process.env.GITHUB_BRANCH || 'main'
    };
    if (!config.token || !config.owner || !config.repo) throw new Error('服务端尚未配置 GitHub 发布变量');
    return config;
}

async function githubCommit({ metadata, body, isUpdate }) {
    const config = githubConfig();
    const apiPath = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/content/posts/${encodeURIComponent(metadata.slug)}.md`;
    const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'selfweb-writing-editor'
    };
    let sha;
    const existingResponse = await fetch(`${apiPath}?ref=${encodeURIComponent(config.branch)}`, { headers });
    if (existingResponse.ok) sha = (await existingResponse.json()).sha;
    else if (existingResponse.status !== 404) throw new Error(`读取 GitHub 文章失败（${existingResponse.status}）`);

    const response = await fetch(apiPath, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: `${isUpdate ? 'update' : 'publish'}: ${metadata.slug}`,
            content: Buffer.from(serializePost(metadata, body), 'utf8').toString('base64'),
            branch: config.branch,
            ...(sha ? { sha } : {})
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `GitHub commit 失败（${response.status}）`);
    return { commit: result.commit?.sha || null, url: result.content?.html_url || null };
}

module.exports = {
    ROOT,
    RESERVED_SLUGS,
    errorJson,
    getPost,
    githubCommit,
    isAuthenticated,
    listPosts,
    login,
    readJson,
    requireAuth,
    sendJson,
    serializePost,
    validatePublishPayload
};
