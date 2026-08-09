const { errorJson, listPosts, sendJson } = require('./_shared');

module.exports = async function postsHandler(req, res) {
    if (req.method !== 'GET') {
        errorJson(res, 405, '只支持 GET /api/posts；草稿保存在浏览器 localStorage');
        return;
    }
    try {
        const posts = listPosts().map(({ metadata }) => metadata);
        sendJson(res, 200, { posts });
    } catch (error) {
        console.error('读取文章列表失败', error);
        errorJson(res, 500, `读取文章失败：${error.message}`);
    }
};
