const path = require('node:path');
const { defineConfig, loadEnv } = require('vite');

const SERVER_ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_THINKING',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'SELFWEB_EDITOR_SECRET',
  'SELFWEB_EDITOR_PASSWORD',
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_BRANCH'
];

function loadLocalServerEnv(mode) {
  const localEnv = loadEnv(mode, process.cwd(), '');
  SERVER_ENV_KEYS.forEach((key) => {
    if (!process.env[key] && localEnv[key]) process.env[key] = localEnv[key];
  });
}

function apiDevPlugin() {
  return {
    name: 'selfweb-api-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const pathname = parsedUrl.pathname;
        if (!pathname.startsWith('/api/')) {
          next();
          return;
        }

        let handler;
        if (pathname === '/api/posts') handler = require('./api/posts');
        else if (pathname === '/api/publish') handler = require('./api/publish');
        else if (pathname === '/api/agent') handler = require('./api/agent');
        else if (pathname === '/api/auth/login') handler = require('./api/auth/login');
        else if (pathname.startsWith('/api/posts/')) {
          handler = require('./api/posts/[slug]');
          req.params = { slug: pathname.slice('/api/posts/'.length) };
        }

        if (!handler) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'API route not found' }));
          return;
        }

        req.query = Object.fromEntries(parsedUrl.searchParams.entries());
        Promise.resolve(handler(req, res)).catch((error) => {
          console.error('Local API error', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: error.message }));
          }
        });
      });
    }
  };
}

module.exports = defineConfig(({ mode }) => {
  loadLocalServerEnv(mode);
  return {
    plugins: [apiDevPlugin()],
    build: {
      lib: {
        entry: path.resolve(__dirname, 'js/editor.js'),
        formats: ['iife'],
        fileName: () => 'editor.bundle.js',
        name: 'SelfWebEditor'
      },
      outDir: path.resolve(__dirname, 'js'),
      emptyOutDir: false,
      sourcemap: false,
      minify: true
    }
  };
});
