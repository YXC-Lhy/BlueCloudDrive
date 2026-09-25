/**
 * 本地预览服务器（非 Cloudflare 环境，仅用于开发预览）
 *   node _test/serve.mjs            # http://127.0.0.1:8787
 *   PORT=9000 node _test/serve.mjs
 * 数据保存在 _test/local.db（删除该文件即可重置）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { D1 } from './d1.mjs';
import worker from '../_worker.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const DB_FILE = process.env.BCD_DB || path.join(ROOT, '_test', 'local.db');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('Not Found', { status: 404 });
    }
    const buf = fs.readFileSync(file);
    return new Response(buf, {
      status: 200,
      headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' },
    });
  },
};

const env = { DB: new D1(DB_FILE), ASSETS };

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const hasBody = chunks.length > 0 && !['GET', 'HEAD'].includes(req.method);
    const request = new Request('http://127.0.0.1:' + PORT + req.url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
      duplex: 'half',
    });
    const response = await worker.fetch(request, env, {});
    const headers = {};
    response.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'set-cookie') return;
      headers[k] = v;
    });
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('本地服务器错误：' + (e && e.stack ? e.stack : e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`蓝云网盘本地预览：http://127.0.0.1:${PORT}`);
  console.log(`主页 http://127.0.0.1:${PORT}/   所有文件 http://127.0.0.1:${PORT}/files   后台 http://127.0.0.1:${PORT}/admin`);
  console.log(`数据库文件：${DB_FILE}（删除即可重置，初始账号 admin / admin123）`);
});
