const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const { loadPosts } = require('./build-posts');

function checksum(paths) {
    const hash = crypto.createHash('sha256');
    paths.sort().forEach((file) => hash.update(fs.readFileSync(file)));
    return hash.digest('hex');
}

function responseRecorder() {
    return {
        statusCode: 200,
        headers: {},
        body: '',
        setHeader(name, value) { this.headers[name] = value; },
        end(value = '') { this.body += value; }
    };
}

async function main() {
    const firstBuild = spawnSync(process.execPath, ['scripts/build-posts.js'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(firstBuild.status, 0, firstBuild.stderr);
    const generated = fs.readdirSync(path.join(ROOT, 'posts')).filter((file) => file.endsWith('.html')).map((file) => path.join(ROOT, 'posts', file));
    const firstChecksum = checksum([path.join(ROOT, 'index.html'), ...generated]);
    const secondBuild = spawnSync(process.execPath, ['scripts/build-posts.js'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(secondBuild.status, 0, secondBuild.stderr);
    const secondGenerated = fs.readdirSync(path.join(ROOT, 'posts')).filter((file) => file.endsWith('.html')).map((file) => path.join(ROOT, 'posts', file));
    assert.equal(firstChecksum, checksum([path.join(ROOT, 'index.html'), ...secondGenerated]), '构建不是幂等的');

    const posts = loadPosts();
    const publishedCount = posts.filter(({ metadata }) => metadata.published).length;
    assert.equal(generated.length, publishedCount, '公开 HTML 数量必须等于 published: true');
    assert.match(fs.readFileSync(path.join(ROOT, 'posts', 'token-addiction.html'), 'utf8'), /Token 上瘾/);
    assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /随笔 · 记忆/);
    assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /当体验新模型变成一种冲动/);
    assert.equal(fs.existsSync(path.join(ROOT, 'vercel.json')), true);
    assert.equal(fs.readFileSync(path.join(ROOT, 'js', 'editor.js'), 'utf8').includes('execCommand'), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'api', 'posts.js')), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'api', 'agent.js')), true);

    const publish = require('../api/publish');
    const response = responseRecorder();
    await publish({ method: 'POST', headers: {} }, response);
    assert.equal(response.statusCode, 401, '匿名发布必须返回 401');

    const agent = require('../api/agent');
    const agentResponse = responseRecorder();
    await agent({ method: 'POST', headers: {} }, agentResponse);
    assert.equal(agentResponse.statusCode, 401, '匿名 Agent 请求必须返回 401');
    console.log(`SelfWeb smoke tests passed (${publishedCount} published posts)`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
