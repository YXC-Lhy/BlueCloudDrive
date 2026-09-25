/**
 * 静态自检：
 *   1) 前端 JS 引用的静态元素 id 在对应 HTML（或该 JS 动态生成的模板）中存在
 *   2) HTML 引用的静态资源文件存在
 *   node _test/check-ids.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MAP = {
  'js/admin.js': ['admin.html'],
  'js/files.js': ['files.html'],
  'js/share.js': ['share.html'],
  'js/fileform.js': ['admin.html', 'files.html'],
  'js/common.js': ['index.html', 'admin.html', 'files.html', 'share.html', '404.html'],
};

// worker 动态处理的路由，不是磁盘上的文件
const ROUTES = new Set(['/', '/files', '/admin']);

let problems = 0;
let checked = 0;

for (const [js, htmls] of Object.entries(MAP)) {
  const code = read(js);
  // 该 JS 自己动态生成的元素也算“存在”
  const haystack = htmls.map(read).join('\n') + '\n' + code;
  const ids = new Set();
  for (const m of code.matchAll(/\(\s*['"`]#([A-Za-z0-9_-]+)['"`]\s*\)/g)) ids.add(m[1]);
  for (const m of code.matchAll(/getElementById\(\s*['"`]([A-Za-z0-9_-]+)/g)) ids.add(m[1]);
  for (const id of ids) {
    checked++;
    if (!new RegExp(`id=["']${id}["']`).test(haystack)) {
      console.log(`✗ ${js} 使用了 #${id}，但 HTML 与模板中都不存在`);
      problems++;
    }
  }
  console.log(`检查 ${js}：引用 ${ids.size} 个元素 id`);
}

for (const f of ['index.html', 'admin.html', 'files.html', 'share.html', '404.html']) {
  const html = read(f);
  for (const m of html.matchAll(/(?:src|href)="(\/[^"#]*)"/g)) {
    const p = m[1].split('?')[0];
    if (ROUTES.has(p) || p.startsWith('/api/')) continue;
    checked++;
    if (!fs.existsSync(path.join(ROOT, p))) {
      console.log(`✗ ${f} 引用了不存在的静态文件 ${p}`);
      problems++;
    }
  }
}

// worker 里引用的静态资源同样检查
{
  const code = read('_worker.js');
  for (const m of code.matchAll(/serveAsset\(env, request, '(\/[^']+)'/g)) {
    checked++;
    if (!fs.existsSync(path.join(ROOT, m[1]))) {
      console.log(`✗ _worker.js 引用了不存在的页面 ${m[1]}`);
      problems++;
    }
  }
}

console.log(`\n共检查 ${checked} 项引用`);
if (problems) {
  console.log(`发现 ${problems} 个问题`);
  process.exit(1);
}
console.log('静态自检全部通过 ✅');
