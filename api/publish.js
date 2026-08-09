const {
    errorJson,
    githubCommit,
    listPosts,
    readJson,
    requireAuth,
    sendJson,
    validatePublishPayload
} = require('./_shared');

module.exports = async function publishHandler(req, res) {
    if (req.method !== 'POST') {
        errorJson(res, 405, '只支持 POST');
        return;
    }
    if (!requireAuth(req, res)) return;
    try {
        const payload = await readJson(req);
        const existingSlugs = new Set(listPosts().map(({ metadata }) => metadata.slug));
        const metadata = validatePublishPayload(payload, existingSlugs);
        const result = await githubCommit({
            metadata,
            body: payload.body,
            isUpdate: existingSlugs.has(metadata.slug)
        });
        sendJson(res, 200, { ok: true, message: '已提交 GitHub，等待 Vercel 构建', ...result });
    } catch (error) {
        console.error('发布失败', error);
        errorJson(res, 400, `发布失败：${error.message}`);
    }
};
