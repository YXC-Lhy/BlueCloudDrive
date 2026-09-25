/**
 * 本地后端自测：用 node:sqlite 模拟 D1，直接调用 _worker.js 的 fetch
 * 运行： node _test/run-tests.mjs
 */
import { D1 } from './d1.mjs';
import worker from '../_worker.js';

/* ---------------- 测试框架 ---------------- */
let pass = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name} ${extra}`);
    console.log(`  ✗ ${name} ${extra}`);
  }
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

const env = { DB: new D1(), ASSETS: null };

async function call(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let body;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  if (opts.cookie) headers['cookie'] = opts.cookie;
  const req = new Request('https://pan.example.com' + path, { method, headers, body });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  let cookie = opts.cookie || '';
  for (const sc of setCookies) {
    const kv = sc.split(';')[0];
    if (kv.startsWith('bcd_token=')) cookie = kv;
  }
  return { status: res.status, data, text, cookie, headers: res.headers };
}

/* ---------------- 用例 ---------------- */
const BASE = {
  name: '测试文档.pdf',
  folder: '/文件分享/文档',
  links: [{ kind: 'direct', url: 'https://cdn.example.com/a.pdf' }],
  size: { mode: 'custom', value: '12.34', unit: 'MB' },
  passwordAction: 'set',
  password: '',
};

section('站点初始化 / 建表');
{
  const r = await call('GET', '/api/site');
  check('GET /api/site 200', r.status === 200, r.text.slice(0, 200));
  check('默认站点名称', r.data?.data?.siteName === '蓝云网盘');
  check('默认访客开放', r.data?.data?.guestBrowse === true);
  check('默认访客根目录 /文件分享', r.data?.data?.guestRoot === '/文件分享');
  check('默认允许搜索', r.data?.data?.allowSearch === true);
  check('默认统计下载', r.data?.data?.countDownload === true);
  check('站点信息不含域名配置', r.data?.data?.siteDomain === undefined);
  const h = await call('GET', '/api/health');
  check('GET /api/health 200', h.status === 200);
}

section('登录鉴权');
let adminCookie = '';
{
  const bad = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
  check('错误密码 401', bad.status === 401);
  const noUser = await call('POST', '/api/auth/login', { body: { username: '', password: 'x' } });
  check('空用户名 400 且带字段错误', noUser.status === 400 && !!noUser.data?.error?.fields?.username);
  const good = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  check('正确密码 200', good.status === 200, good.text.slice(0, 200));
  check('返回角色 total', good.data?.data?.role === 'total');
  check('下发 cookie', !!good.cookie);
  adminCookie = good.cookie;
  const me = await call('GET', '/api/auth/me', { cookie: adminCookie });
  check('GET /api/auth/me', me.status === 200 && me.data.data.username === 'admin');
  const guarded = await call('GET', '/api/admin/settings');
  check('未登录访问后台 401', guarded.status === 401);
}

section('全局设置校验');
{
  const bad = await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { siteName: '', guestRoot: '/a/../b' } });
  check('非法设置 400', bad.status === 400, bad.text.slice(0, 160));
  check('返回 siteName 错误', !!bad.data?.error?.fields?.siteName);
  check('返回 guestRoot 错误', !!bad.data?.error?.fields?.guestRoot);
  const good = await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { siteName: '蓝云网盘', guestRoot: '/文件分享' } });
  check('合法设置 200', good.status === 200, good.text.slice(0, 160));
}

section('新增文件：字段校验');
{
  const cases = [
    ['空名称', { ...BASE, name: '' }, 'name'],
    ['名称含斜杠', { ...BASE, name: 'a/b.pdf' }, 'name'],
    ['路径不合法', { ...BASE, folder: '/./x' }, 'folder'],
    ['无地址', { ...BASE, links: [] }, 'links'],
    ['地址非法', { ...BASE, links: [{ kind: 'direct', url: 'ftp://x/y' }] }, 'links'],
    ['站外链接缺来源', { ...BASE, links: [{ kind: 'external', url: 'https://pan.other.com/s/1' }] }, 'links'],
    ['大小超 4 位整数', { ...BASE, size: { mode: 'custom', value: '12345', unit: 'MB' } }, 'size'],
    ['大小 3 位小数', { ...BASE, size: { mode: 'custom', value: '1.234', unit: 'MB' } }, 'size'],
    ['大小单位为 TB', { ...BASE, size: { mode: 'custom', value: '1', unit: 'TB' } }, 'size'],
    ['密码 11 位', { ...BASE, password: '12345678901' }, 'password'],
    ['密码含空格', { ...BASE, password: 'abc def' }, 'password'],
  ];
  for (const [label, body, field] of cases) {
    const r = await call('POST', '/api/admin/files', { cookie: adminCookie, body });
    check(`驳回：${label}`, r.status === 400 && !!r.data?.error?.fields?.[field], `status=${r.status} ${r.text.slice(0, 200)}`);
  }
}

section('新增文件：成功 & 自动建文件夹');
let fileA = null;
let fileB = null;
{
  const a = await call('POST', '/api/admin/files', { cookie: adminCookie, body: BASE });
  check('新增成功', a.status === 200, a.text.slice(0, 200));
  fileA = a.data?.data?.shareId;
  check('分享编号长度 10', typeof fileA === 'string' && fileA.length === 10);
  check('分享时间精确到分钟', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(a.data?.data?.createdAt || ''), a.data?.data?.createdAt);

  const dup = await call('POST', '/api/admin/files', { cookie: adminCookie, body: BASE });
  check('同路径同名 409', dup.status === 409);

  const b = await call('POST', '/api/admin/files', {
    cookie: adminCookie,
    body: {
      name: '蓝云客户端.apk',
      folder: '/文件分享/文档/子目录',
      links: [
        { kind: 'external', url: 'https://pan.other.com/s/abc', source: '某网盘' },
        { kind: 'direct', url: 'https://cdn.example.com/app.apk' },
      ],
      size: { mode: 'unknown' },
      password: 'abc123',
    },
  });
  check('新增第二个文件成功', b.status === 200, b.text.slice(0, 200));
  fileB = b.data?.data?.shareId;

  const list = await call('GET', '/api/files/list?path=/文件分享', { cookie: adminCookie });
  check('自动创建文件夹', list.data?.data?.folders?.some((f) => f.path === '/文件分享/文档'));
  const deep = await call('GET', '/api/files/list?path=/文件分享/文档/子目录', { cookie: adminCookie });
  check('多级文件夹自动创建', deep.data?.data?.folders?.length === 0 && deep.data?.data?.files?.length === 1, JSON.stringify(deep.data?.data?.files));
  check('未知大小显示', deep.data?.data?.files?.[0]?.sizeText === '未知');
  check('linkCount=2', deep.data?.data?.files?.[0]?.linkCount === 2);
}

section('所有文件浏览：访客与管理员');
{
  const guest = await call('GET', '/api/files/list');
  check('访客默认进入 /文件分享', guest.data?.data?.path === '/文件分享');
  check('访客不能越权到上级', guest.data?.data?.parent === null);
  const escape = await call('GET', '/api/files/list?path=/etc');
  check('访客越权路径被夹回根目录', escape.data?.data?.path === '/文件分享', JSON.stringify(escape.data?.data?.path));
  const admin = await call('GET', '/api/files/list?path=/', { cookie: adminCookie });
  check('管理员看到根目录', admin.data?.data?.path === '/' && admin.data?.data?.isAdmin === true);
  const search = await call('GET', '/api/files/list?search=测试', { cookie: adminCookie });
  check('搜索命中', search.data?.data?.files?.length === 1);
  const badPath = await call('GET', '/api/files/list?path=//a//b', { cookie: adminCookie });
  check('路径归一化', badPath.status === 200 && badPath.data?.data?.path === '/a/b');
}

section('关闭搜索 / 关闭访客浏览');
{
  await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { allowSearch: false } });
  const s = await call('GET', '/api/files/list?search=测试');
  check('关闭后访客搜索 403', s.status === 403, String(s.status));
  const adminSearch = await call('GET', '/api/files/list?search=测试', { cookie: adminCookie });
  check('关闭后管理员仍可搜索', adminSearch.status === 200 && adminSearch.data.data.files.length === 1);
  await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { allowSearch: true } });

  await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { guestBrowse: false } });
  const g = await call('GET', '/api/files/list');
  check('关闭访客浏览 403', g.status === 403, String(g.status));
  const still = await call('GET', '/api/files/list', { cookie: adminCookie });
  check('管理员不受影响', still.status === 200);
  await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { guestBrowse: true } });
}

section('分享页：无密码单文件');
{
  const info = await call('GET', `/api/share/file/${fileA}`);
  check('分享信息 200', info.status === 200, info.text.slice(0, 200));
  check('hasPassword=false', info.data?.data?.hasPassword === false);
  check('大小文本 12.34 MB', info.data?.data?.file?.sizeText === '12.34 MB', info.data?.data?.file?.sizeText);
  check('返回所属文件夹分享号', !!info.data?.data?.file?.folderShareId);
  const links = await call('GET', `/api/share/file/${fileA}/links`);
  check('获取直链 200', links.status === 200 && links.data.data.links.length === 1);
  const token = links.data.data.token;
  const dl = await call('GET', `/api/dl/${info.data.data.file.id}/${links.data.data.links[0].id}?token=${encodeURIComponent(token)}`);
  check('直链下载 302', dl.status === 302, String(dl.status));
  check('302 指向原直链', dl.headers.get('location') === 'https://cdn.example.com/a.pdf');
  const noToken = await call('GET', `/api/dl/${info.data.data.file.id}/${links.data.data.links[0].id}`);
  check('无密码文件可无 token 下载', noToken.status === 302);
  const after = await call('GET', `/api/share/file/${fileA}`);
  check('下载次数 +2', after.data?.data?.file?.downloadCount === 2, String(after.data?.data?.file?.downloadCount));
  const bad = await call('GET', '/api/share/file/notexist00');
  check('不存在的分享 404', bad.status === 404);
}

section('分享页：带密码');
{
  const info = await call('GET', `/api/share/file/${fileB}`);
  check('hasPassword=true', info.data?.data?.hasPassword === true);
  const links = await call('GET', `/api/share/file/${fileB}/links`);
  check('未解锁取直链 403', links.status === 403);
  const wrong = await call('POST', `/api/share/file/${fileB}/unlock`, { body: { password: 'x' } });
  check('密码错误 403', wrong.status === 403 && !!wrong.data?.error?.fields?.password);
  const right = await call('POST', `/api/share/file/${fileB}/unlock`, { body: { password: 'abc123' } });
  check('密码正确返回 token 与地址', right.status === 200 && right.data.data.links.length === 2, right.text.slice(0, 200));
  const fileId = info.data.data.file.id;
  const noToken = await call('GET', `/api/dl/${fileId}/${right.data.data.links[0].id}`);
  check('带密码文件无 token 403', noToken.status === 403);
  const withToken = await call('GET', `/api/dl/${fileId}/${right.data.data.links[0].id}?token=${encodeURIComponent(right.data.data.token)}`);
  check('带 token 下载 302', withToken.status === 302);
  const forged = await call('GET', `/api/dl/${fileId}/${right.data.data.links[0].id}?token=aaa.bbb`);
  check('伪造 token 403', forged.status === 403);
  const ext = await call('POST', '/api/dl/count', { body: { fileId, linkId: right.data.data.links[0].id, token: right.data.data.token } });
  check('外部链接计数 200', ext.status === 200, ext.text.slice(0, 160));
}

section('文件夹分享页 /sf/<id>');
{
  const info = await call('GET', `/api/share/file/${fileA}`);
  const sf = info.data.data.file.folderShareId;
  const r = await call('GET', `/api/share/folder/${sf}`);
  check('文件夹分享 200', r.status === 200, r.text.slice(0, 200));
  check('文件夹内包含文件', r.data?.data?.files?.length === 1);
  check('文件夹内包含子文件夹', r.data?.data?.folders?.length === 1);
  const sub = await call('GET', `/api/share/folder/${sf}?path=/文件分享/文档/子目录`);
  check('可下钻子目录', sub.status === 200 && sub.data.data.files.length === 1);
  const escape = await call('GET', `/api/share/folder/${sf}?path=/`);
  check('不能越出分享目录', escape.data?.data?.path === '/文件分享/文档', escape.data?.data?.path);
  const search = await call('GET', `/api/share/folder/${sf}?search=apk`);
  check('文件夹分享内搜索', search.data?.data?.files?.length === 1);
}

section('编辑 / 移动 / 删除');
{
  const detail = await call('GET', `/api/admin/files/${fileA}`, { cookie: adminCookie });
  check('后台读取详情', detail.status === 200 && detail.data.data.file.links.length === 1);
  check('详情不含密码哈希', detail.data.data.file.passwordHash === undefined && detail.data.data.file.password === undefined);

  const bad = await call('PUT', `/api/admin/files/${fileA}`, { cookie: adminCookie, body: { ...BASE, passwordAction: 'set', password: '12345678901' } });
  check('编辑时密码超长被驳回', bad.status === 400 && !!bad.data.error.fields.password);

  const upd = await call('PUT', `/api/admin/files/${fileA}`, {
    cookie: adminCookie,
    body: { name: '测试文档v2.pdf', folder: '/文件分享/文档', links: [{ kind: 'direct', url: 'https://cdn.example.com/b.pdf' }], size: { mode: 'custom', value: '1', unit: 'GB' }, passwordAction: 'set', password: 'pw12' },
  });
  check('编辑成功', upd.status === 200, upd.text.slice(0, 200));
  const after = await call('GET', `/api/share/file/${fileA}`);
  check('名称已更新', after.data.data.file.name === '测试文档v2.pdf');
  check('大小 1 GB', after.data.data.file.sizeText === '1 GB', after.data.data.file.sizeText);
  check('密码已设置', after.data.data.hasPassword === true);
  const created = after.data.data.file.createdAt;
  check('分享时间保持不变', created === detail.data.data.file.createdAt);

  const clear = await call('PUT', `/api/admin/files/${fileA}`, {
    cookie: adminCookie,
    body: { name: '测试文档v2.pdf', folder: '/文件分享/文档', links: [{ kind: 'direct', url: 'https://cdn.example.com/b.pdf' }], size: { mode: 'unknown' }, passwordAction: 'clear' },
  });
  check('清除密码成功', clear.status === 200);
  const after2 = await call('GET', `/api/share/file/${fileA}`);
  check('密码已清除', after2.data.data.hasPassword === false);

  const conflict = await call('PUT', `/api/admin/files/${fileA}`, {
    cookie: adminCookie,
    body: { name: '蓝云客户端.apk', folder: '/文件分享/文档/子目录', links: [{ kind: 'direct', url: 'https://cdn.example.com/b.pdf' }], size: { mode: 'unknown' } },
  });
  check('重名冲突 409', conflict.status === 409);

  const mv = await call('POST', `/api/admin/files/${fileA}/move`, { cookie: adminCookie, body: { folder: '/归档/2024' } });
  check('移动成功', mv.status === 200, mv.text.slice(0, 160));
  const moved = await call('GET', '/api/files/list?path=/归档/2024', { cookie: adminCookie });
  check('移动后出现在新目录', moved.data.data.files.length === 1);
  const mvBad = await call('POST', `/api/admin/files/${fileA}/move`, { cookie: adminCookie, body: { folder: 'bad//..' } });
  check('非法目标路径 400', mvBad.status === 400);
}

section('管理员账号管理');
let subCookie = '';
{
  const bad = await call('POST', '/api/admin/admins', { cookie: adminCookie, body: { username: 'a', password: '123', displayName: 'x'.repeat(40) } });
  check('子管理员字段校验', bad.status === 400 && !!bad.data.error.fields.username && !!bad.data.error.fields.password && !!bad.data.error.fields.displayName);
  const okr = await call('POST', '/api/admin/admins', { cookie: adminCookie, body: { username: 'editor01', password: 'editor123', displayName: '编辑员' } });
  check('新建子管理员', okr.status === 200, okr.text.slice(0, 160));
  const dup = await call('POST', '/api/admin/admins', { cookie: adminCookie, body: { username: 'editor01', password: 'editor123' } });
  check('用户名重复 409', dup.status === 409);
  const login = await call('POST', '/api/auth/login', { body: { username: 'editor01', password: 'editor123' } });
  check('子管理员登录', login.status === 200 && login.data.data.role === 'sub');
  subCookie = login.cookie;
  const forbidden = await call('POST', '/api/admin/admins', { cookie: subCookie, body: { username: 'x1234', password: 'x12345' } });
  check('子管理员无权新建账号 403', forbidden.status === 403);
  const self = await call('GET', '/api/admin/admins', { cookie: subCookie });
  check('任何人可列出账号', self.status === 200);
  check('列表不含哈希', self.data.data.admins.every((a) => a.passwordHash === undefined));
  const totalRow = self.data.data.admins.find((a) => a.username === 'admin');
  const delTotal = await call('DELETE', `/api/admin/admins/${totalRow.id}`, { cookie: adminCookie });
  check('不能删除最后一个总管理员', delTotal.status === 400, delTotal.text.slice(0, 120));
  const subRow = self.data.data.admins.find((a) => a.username === 'editor01');
  const disable = await call('PUT', `/api/admin/admins/${subRow.id}`, { cookie: adminCookie, body: { status: 'disabled' } });
  check('禁用子管理员', disable.status === 200);
  const blocked = await call('GET', '/api/admin/settings', { cookie: subCookie });
  check('被禁用后会话失效', blocked.status === 401, String(blocked.status));
  const re = await call('PUT', `/api/admin/admins/${subRow.id}`, { cookie: adminCookie, body: { status: 'active', password: 'newpass123' } });
  check('重新启用并改密', re.status === 200);
  const relogin = await call('POST', '/api/auth/login', { body: { username: 'editor01', password: 'newpass123' } });
  check('新密码可登录', relogin.status === 200);
  const selfDel = await call('DELETE', `/api/admin/admins/${totalRow.id}`, { cookie: adminCookie });
  check('不能删除自己', selfDel.status === 400);
}

section('修改本人账号');
{
  const bad = await call('PUT', '/api/auth/me', { cookie: adminCookie, body: { displayName: '总管理员', newPassword: 'newadmin123', oldPassword: 'wrong' } });
  check('原密码错误拦截', bad.status === 400 && !!bad.data.error.fields.oldPassword);
  const okd = await call('PUT', '/api/auth/me', { cookie: adminCookie, body: { displayName: '超级管理员' } });
  check('修改昵称', okd.status === 200 && okd.data.data.displayName === '超级管理员');
}

section('备份 / 恢复');
{
  const backup = await call('GET', '/api/admin/backup', { cookie: adminCookie });
  check('备份 200', backup.status === 200);
  let parsed = null;
  try {
    parsed = JSON.parse(backup.text);
  } catch (_) {}
  check('备份结构完整', !!parsed && !!parsed.data && Array.isArray(parsed.data.bcd_files) && parsed.data.bcd_files.length === 2, JSON.stringify(parsed && Object.keys(parsed.data || {})));
  const denied = await call('POST', '/api/admin/restore', { cookie: subCookie, body: { mode: 'replace', data: parsed } });
  check('子管理员无权恢复 403', denied.status === 403 || denied.status === 401);

  const restored = await call('POST', '/api/admin/restore', { cookie: adminCookie, body: { mode: 'replace', data: parsed } });
  check('恢复成功', restored.status === 200, restored.text.slice(0, 200));
  const after = await call('GET', '/api/files/list?path=/', { cookie: adminCookie });
  check('恢复后文件仍在', after.data.data.folders.length >= 1);
  const me = await call('GET', '/api/auth/me', { cookie: adminCookie });
  check('恢复后当前会话仍有效', me.status === 200);
  const badData = await call('POST', '/api/admin/restore', { cookie: adminCookie, body: { mode: 'replace', data: { foo: 1 } } });
  check('非法备份数据 400', badData.status === 400);
}

section('下载统计开关');
{
  await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { countDownload: false } });
  const info = await call('GET', `/api/share/file/${fileA}`);
  const links = await call('GET', `/api/share/file/${fileA}/links`);
  const before = info.data.data.file.downloadCount;
  await call('GET', `/api/dl/${info.data.data.file.id}/${links.data.data.links[0].id}?token=${encodeURIComponent(links.data.data.token)}`);
  const after = await call('GET', `/api/share/file/${fileA}`);
  check('关闭统计后计数不变', after.data.data.file.downloadCount === before, `${before} -> ${after.data.data.file.downloadCount}`);
  await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { countDownload: true } });
}

section('删除文件 / 文件夹');
{
  const detail = await call('GET', `/api/admin/files/${fileB}`, { cookie: adminCookie });
  const fileId = detail.data.data.file.id;
  const del = await call('DELETE', `/api/admin/files/${fileB}`, { cookie: adminCookie });
  check('删除文件 200', del.status === 200);
  const gone = await call('GET', `/api/share/file/${fileB}`);
  check('删除后分享 404', gone.status === 404);
  const sf = await call('GET', `/api/share/file/${fileA}`);
  const folderShare = sf.data.data.file.folderShareId;
  const badDel = await call('DELETE', `/api/admin/folders/${folderShare}`, { cookie: adminCookie });
  check('非空文件夹不能删除', badDel.status === 400, badDel.text.slice(0, 120));
  const newFolder = await call('POST', '/api/admin/folders', { cookie: adminCookie, body: { path: '/空目录' } });
  check('新建空文件夹', newFolder.status === 200, newFolder.text.slice(0, 160));
  const delFolder = await call('DELETE', `/api/admin/folders/${newFolder.data.data.folder.shareId}`, { cookie: adminCookie });
  check('删除空文件夹', delFolder.status === 200);
  const dupFolder = await call('POST', '/api/admin/folders', { cookie: adminCookie, body: { path: '/归档' } });
  check('重复文件夹 409', dupFolder.status === 409);
}

section('后台文件分享列表');
{
  const r = await call('GET', '/api/admin/files?sort=time&order=desc', { cookie: adminCookie });
  check('列表 200', r.status === 200);
  check('按新到旧排序', (r.data.data.files[0].createdAt || '') >= (r.data.data.files[1]?.createdAt || ''));
  const s = await call('GET', '/api/admin/files?search=v2', { cookie: adminCookie });
  check('列表搜索', s.data.data.total === 1, JSON.stringify(s.data?.data?.total));
  const unauth = await call('GET', '/api/admin/files');
  check('未登录 401', unauth.status === 401);
}

section('下载记录与日志');
{
  const logs = await call('GET', '/api/admin/logs', { cookie: adminCookie });
  check('日志可读', logs.status === 200 && logs.data.data.logs.length > 0);
  check('日志返回总数', typeof logs.data.data.total === 'number' && logs.data.data.total > 0);
  const row = env.DB.raw.prepare('SELECT COUNT(*) AS c FROM bcd_downloads').get();
  check('下载记录已写入（删除文件会清掉对应记录）', Number(row.c) >= 2, String(row.c));

  const denied = await call('DELETE', '/api/admin/logs');
  check('未登录不能清空日志', denied.status === 401);
  const cleared = await call('DELETE', '/api/admin/logs', { cookie: adminCookie });
  check('清空日志 200', cleared.status === 200, cleared.text.slice(0, 160));
  check('返回清除条数', cleared.data?.data?.removed > 0);
  const after = await call('GET', '/api/admin/logs', { cookie: adminCookie });
  check('清空后只剩一条清空记录', after.data.data.total === 1 && after.data.data.logs[0].action === 'clear_logs', JSON.stringify(after.data.data));
  // 复位：清空后再产生日志不影响后续断言
  const refill = await call('PUT', '/api/admin/settings', { cookie: adminCookie, body: { siteName: '蓝云网盘' } });
  check('清空后仍可正常写日志', refill.status === 200);
}

section('站点名称兜底');
{
  env.DB.raw.prepare("UPDATE bcd_settings SET value='' WHERE key='site_name'").run();
  const r = await call('GET', '/api/site');
  check('空站点名称回落到默认「蓝云网盘」', r.data?.data?.siteName === '蓝云网盘', JSON.stringify(r.data?.data?.siteName));
  const s = await call('GET', '/api/admin/settings', { cookie: adminCookie });
  check('后台设置接口同样兜底', s.data?.data?.siteName === '蓝云网盘', JSON.stringify(s.data?.data?.siteName));
  const sh = await call('GET', `/api/share/file/${fileA}`);
  check('分享页同样兜底', sh.status === 404 || sh.data?.data?.siteName === '蓝云网盘');
  env.DB.raw.prepare("UPDATE bcd_settings SET value='蓝云网盘' WHERE key='site_name'").run();
}

/* ---------------- 汇总 ---------------- */console.log(`\n通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log('失败明细：');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
