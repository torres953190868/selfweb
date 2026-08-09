const { errorJson, login } = require('../_shared');

module.exports = async function loginHandler(req, res) {
    if (req.method !== 'POST') {
        errorJson(res, 405, '只支持 POST');
        return;
    }
    try {
        await login(req, res);
    } catch (error) {
        console.error('登录失败', error);
        errorJson(res, 400, `登录失败：${error.message}`);
    }
};
