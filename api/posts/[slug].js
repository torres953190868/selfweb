const { errorJson, getPost, sendJson } = require('../_shared');

module.exports = async function postHandler(req, res) {
    if (req.method !== 'GET') {
        errorJson(res, 405, '只支持 GET /api/posts/:slug');
        return;
    }
    try {
        const slug = req.query?.slug || req.params?.slug || String(req.url || '').split('/').pop().split('?')[0];
        const post = getPost(decodeURIComponent(slug));
        if (!post) {
            errorJson(res, 404, '文章不存在或尚未发布');
            return;
        }
        sendJson(res, 200, { post: { metadata: post.metadata, body: post.body } });
    } catch (error) {
        console.error('读取文章失败', error);
        errorJson(res, 500, `读取文章失败：${error.message}`);
    }
};
