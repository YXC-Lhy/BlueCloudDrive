/**
 * ============================================================================
 *  蓝云网盘 BlueCloudDrive (BCD) —— Cloudflare Worker 单文件后端
 * ----------------------------------------------------------------------------
 *  运行环境 : Cloudflare Workers / Pages Functions（高级模式）
 *  数据存储 : D1（绑定变量名必须为 DB）
 *  静态资源 : 同目录下的 html / css / js / img（通过 ASSETS 绑定或 Pages 直出）
 *  首次启动 : 自动建表 + 写入默认配置 + 创建总管理员账号
 * ============================================================================
 */

const VERSION = '1.1.0';
const REPO_URL = 'https://github.com/YXC-Lhy/BlueCloudDrive';
const COOKIE_NAME = 'bcd_token';
const SESSION_DAYS = 7;

/* ------------------------------ 默认配置 ------------------------------ */
const HOME_TEXT_DEFAULT = '主页内容建设中…… 你可以先前往「所有文件」浏览或下载已分享的文件。';
const DEFAULT_SETTINGS = {
  site_name: '蓝云网盘',
  home_desc: HOME_TEXT_DEFAULT, // 主页简介（纯文本）
  home_notice: HOME_TEXT_DEFAULT, // 主页公告（Markdown，留空则不显示）
  guest_browse: '1', // 「所有文件」是否对未登录访客开放
  guest_root: '/文件分享', // 未登录访客根目录
  user_root: '/文件分享', // 普通用户（已登录）根目录
  allow_search: '1', // 是否允许搜索
  count_download: '1', // 是否统计下载次数
};

/** 日志最多保存条数 */
const LOG_LIMIT = 50;

const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', display_name: '总管理员' };

/* ------------------------------ 建表语句（专表专用） ------------------------------ */
const MIGRATIONS = [
  // 全局设置（键值对）
  `CREATE TABLE IF NOT EXISTS bcd_settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL DEFAULT ''
   )`,
  // 管理员账号（total = 总管理员 / sub = 子管理员）
  `CREATE TABLE IF NOT EXISTS bcd_admins (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     username      TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     salt          TEXT NOT NULL,
     display_name  TEXT NOT NULL DEFAULT '',
     role          TEXT NOT NULL DEFAULT 'sub',
     status        TEXT NOT NULL DEFAULT 'active',
     created_by    TEXT NOT NULL DEFAULT '',
     created_at    TEXT NOT NULL DEFAULT '',
     last_login_at TEXT NOT NULL DEFAULT ''
   )`,
  // 登录会话
  `CREATE TABLE IF NOT EXISTS bcd_sessions (
     token      TEXT PRIMARY KEY,
     admin_id   INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT '',
     expires_at TEXT NOT NULL DEFAULT '',
     ip         TEXT NOT NULL DEFAULT '',
     user_agent TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bcd_sessions_admin ON bcd_sessions(admin_id)`,
  // 文件夹（由文件路径自动创建）
  `CREATE TABLE IF NOT EXISTS bcd_folders (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     path       TEXT NOT NULL UNIQUE,
     name       TEXT NOT NULL,
     parent     TEXT NOT NULL DEFAULT '/',
     share_id   TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bcd_folders_parent ON bcd_folders(parent)`,
  // 分享文件
  `CREATE TABLE IF NOT EXISTS bcd_files (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     share_id       TEXT NOT NULL UNIQUE,
     name           TEXT NOT NULL,
     folder         TEXT NOT NULL DEFAULT '/',
     path           TEXT NOT NULL,
     ext            TEXT NOT NULL DEFAULT '',
     size_bytes     INTEGER,
     size_text      TEXT NOT NULL DEFAULT '未知',
     description    TEXT NOT NULL DEFAULT '',
     password_hash  TEXT,
     password_salt  TEXT,
     download_count INTEGER NOT NULL DEFAULT 0,
     created_at     TEXT NOT NULL DEFAULT '',
     updated_at     TEXT NOT NULL DEFAULT '',
     UNIQUE(folder, name)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bcd_files_folder ON bcd_files(folder)`,
  `CREATE INDEX IF NOT EXISTS idx_bcd_files_path ON bcd_files(path)`,
  `CREATE INDEX IF NOT EXISTS idx_bcd_files_created ON bcd_files(created_at DESC)`,
  // 文件下载地址（一个文件可配置多个直链 / 站外分享链接）
  `CREATE TABLE IF NOT EXISTS bcd_links (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     file_id    INTEGER NOT NULL,
     kind       TEXT NOT NULL DEFAULT 'direct',
     url        TEXT NOT NULL,
     source     TEXT NOT NULL DEFAULT '',
     sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bcd_links_file ON bcd_links(file_id)`,
  // 下载记录（统计用）
  `CREATE TABLE IF NOT EXISTS bcd_downloads (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     file_id    INTEGER NOT NULL,
     link_id    INTEGER NOT NULL DEFAULT 0,
     kind       TEXT NOT NULL DEFAULT '',
     ip         TEXT NOT NULL DEFAULT '',
     country    TEXT NOT NULL DEFAULT '',
     user_agent TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bcd_downloads_file ON bcd_downloads(file_id)`,
  // 操作日志
  `CREATE TABLE IF NOT EXISTS bcd_logs (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     actor      TEXT NOT NULL DEFAULT '',
     action     TEXT NOT NULL DEFAULT '',
     target     TEXT NOT NULL DEFAULT '',
     detail     TEXT NOT NULL DEFAULT '',
     ip         TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT ''
   )`,
];

/* 老库升级：补充后加的列（列已存在时会报错，忽略即可） */
const ALTERS = [`ALTER TABLE bcd_files ADD COLUMN description TEXT NOT NULL DEFAULT ''`];

/* ============================ 通用工具 ============================ */
const enc = new TextEncoder();
const dec = new TextDecoder();

/** 北京时间（精确到分钟）: YYYY-MM-DD HH:mm */
function nowBeijing() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 时间戳（毫秒）→ 北京时间 */
function tsToBeijing(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function ok(data = {}) {
  return json({ ok: true, data });
}

/** 业务错误：可携带字段级错误，前端直接定位到输入框 */
class ApiError extends Error {
  constructor(message, status = 400, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
function fail(message, status = 400, fields = null) {
  throw new ApiError(message, status, fields);
}
function jsonError(message, status = 400, fields = null) {
  return json({ ok: false, error: { message, fields: fields || {} } }, status);
}

function randomToken(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return s;
}

function b64urlEncode(str) {
  return btoa(String.fromCharCode(...enc.encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return dec.decode(bytes);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password, salt) {
  return sha256Hex(`${salt}::${password}::bcd`);
}
async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

function parseCookies(request) {
  const raw = request.headers.get('Cookie') || '';
  const out = {};
  raw.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '';
}
function clientCountry(request) {
  return request.headers.get('CF-IPCountry') || '';
}
function userAgent(request) {
  return (request.headers.get('User-Agent') || '').slice(0, 300);
}

/* ============================ 数据库初始化 ============================ */
let __dbReady = null;

function db(env) {
  if (!env || !env.DB) {
    throw new ApiError('未绑定 D1 数据库：请把绑定变量名设置为 DB', 500);
  }
  return env.DB;
}

function ensureDb(env) {
  db(env);
  if (!__dbReady) {
    __dbReady = initDb(env).catch((e) => {
      __dbReady = null;
      throw e;
    });
  }
  return __dbReady;
}

async function initDb(env) {
  const DB = db(env);
  await DB.batch(MIGRATIONS.map((sql) => DB.prepare(sql)));

  // 兼容老库：补充后加的列
  for (const sql of ALTERS) {
    try {
      await DB.prepare(sql).run();
    } catch (_) {
      /* 列已存在 */
    }
  }

  const now = nowBeijing();
  const existing = await DB.prepare('SELECT key FROM bcd_settings').all();
  const have = new Set(((existing && existing.results) || []).map((r) => r.key));
  const inserts = [];
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (have.has(key)) continue;
    inserts.push(DB.prepare('INSERT OR IGNORE INTO bcd_settings(key,value,updated_at) VALUES(?,?,?)').bind(key, value, now));
  }
  if (!have.has('secret_key')) {
    inserts.push(DB.prepare('INSERT OR IGNORE INTO bcd_settings(key,value,updated_at) VALUES(?,?,?)').bind('secret_key', randomToken(48), now));
  }
  if (!have.has('initialized_at')) {
    inserts.push(DB.prepare('INSERT OR IGNORE INTO bcd_settings(key,value,updated_at) VALUES(?,?,?)').bind('initialized_at', now, now));
  }
  if (inserts.length) await DB.batch(inserts);

  // 站点名称兜底：默认「蓝云网盘」，若被清空则恢复默认值
  await DB.prepare("UPDATE bcd_settings SET value=?, updated_at=? WHERE key='site_name' AND (value IS NULL OR TRIM(value)='')")
    .bind(DEFAULT_SETTINGS.site_name, now)
    .run();

  const cnt = await DB.prepare('SELECT COUNT(*) AS c FROM bcd_admins').first();
  if (!cnt || Number(cnt.c) === 0) {
    const salt = randomToken(16);
    const hash = await hashPassword(DEFAULT_ADMIN.password, salt);
    await DB.prepare(
      `INSERT OR IGNORE INTO bcd_admins(username,password_hash,salt,display_name,role,status,created_by,created_at,last_login_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    )
      .bind(DEFAULT_ADMIN.username, hash, salt, DEFAULT_ADMIN.display_name, 'total', 'active', 'system', now, '')
      .run();
  }
}

async function getSettings(env) {
  const res = await db(env).prepare('SELECT key,value FROM bcd_settings').all();
  const map = {};
  ((res && res.results) || []).forEach((r) => (map[r.key] = r.value));
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (map[k] === undefined) map[k] = v;
  return map;
}

async function getSetting(env, key) {
  const row = await db(env).prepare('SELECT value FROM bcd_settings WHERE key=?').bind(key).first();
  return row ? row.value : DEFAULT_SETTINGS[key];
}

/**
 * 写操作日志。
 * - actor 可传字符串或 { username, role }
 * - 「用户」账号产生的日志不记录
 * - 只保留最近 LOG_LIMIT 条
 */
async function logAction(env, actor, action, target, detail, request) {
  try {
    const name = typeof actor === 'string' ? actor : (actor && actor.username) || '';
    const role = typeof actor === 'string' ? '' : (actor && actor.role) || '';
    if (role === 'user') return; // 与「用户」有关的操作不记录
    await db(env)
      .prepare('INSERT INTO bcd_logs(actor,action,target,detail,ip,created_at) VALUES(?,?,?,?,?,?)')
      .bind(name, action || '', target || '', String(detail || '').slice(0, 500), clientIp(request || {}), nowBeijing())
      .run();
    await db(env)
      .prepare(`DELETE FROM bcd_logs WHERE id NOT IN (SELECT id FROM bcd_logs ORDER BY id DESC LIMIT ${LOG_LIMIT})`)
      .run();
  } catch (_) {
    /* 日志失败不影响主流程 */
  }
}

/* ============================ 校验工具 ============================ */
const ILLEGAL_CHARS = /[\\:*?"<>|\u0000-\u001f]/;
const NAME_ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

/** 归一路径：仅允许 / 分隔，禁止 . 与 .. 与非法字符 */
function normalizePath(input, fieldName = '文件路径') {
  if (input === undefined || input === null || String(input).trim() === '') {
    return { error: `${fieldName}不能为空` };
  }
  let p = String(input).trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  const segs = p.split('/').filter((s) => s !== '');
  const out = [];
  for (const seg of segs) {
    if (seg === '.' || seg === '..') return { error: `${fieldName}不能包含 . 或 ..` };
    if (ILLEGAL_CHARS.test(seg)) return { error: `${fieldName}不能包含 \\ : * ? " < > | 等特殊字符` };
    if ([...seg].length > 80) return { error: `${fieldName}的每一级目录名不能超过 80 个字符` };
    out.push(seg);
  }
  if (out.length > 12) return { error: `${fieldName}层级过深（最多 12 级）` };
  return { value: '/' + out.join('/') };
}

/** 校验文件/文件夹名 */
function validateName(input, fieldName = '文件名称') {
  if (input === undefined || input === null || String(input).trim() === '') return { error: `${fieldName}不能为空` };
  const name = String(input).trim();
  if (name === '.' || name === '..') return { error: `${fieldName}不合法` };
  if (NAME_ILLEGAL_CHARS.test(name)) return { error: `${fieldName}不能包含 \\ / : * ? " < > | 等特殊字符` };
  if ([...name].length > 128) return { error: `${fieldName}不能超过 128 个字符` };
  if (/\s{2,}/.test(name)) return { error: `${fieldName}不能包含连续空格` };
  return { value: name };
}

/** 校验分享密码：可空，最长 10 个字符 */
function validatePassword(input, fieldName = '下载密码') {
  if (input === undefined || input === null || String(input) === '') return { value: null };
  const pw = String(input);
  if (/\s/.test(pw)) return { error: `${fieldName}不能包含空格` };
  if (ILLEGAL_CHARS.test(pw)) return { error: `${fieldName}不能包含 \\ : * ? " < > | 等特殊字符` };
  if ([...pw].length > 10) return { error: `${fieldName}最长 10 个字符（当前 ${[...pw].length} 个）` };
  if ([...pw].length < 1) return { error: `${fieldName}不合法` };
  return { value: pw };
}

/** 校验管理员账号密码：6-64 位，不含空白与控制字符 */
function validateAdminPassword(input, fieldName = '密码') {
  if (input === undefined || input === null || String(input) === '') return { error: `请输入${fieldName}` };
  const pw = String(input);
  if (/\s/.test(pw)) return { error: `${fieldName}不能包含空格` };
  if (/[\u0000-\u001f]/.test(pw)) return { error: `${fieldName}包含非法字符` };
  if ([...pw].length < 6) return { error: `${fieldName}至少 6 个字符` };
  if ([...pw].length > 64) return { error: `${fieldName}不能超过 64 个字符` };
  return { value: pw };
}

/** 校验文件大小：unknown 或 数字(最多 4 位整数 + 2 位小数) + 单位 */
const SIZE_UNITS = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
function validateSize(size) {
  const s = size || {};
  const mode = s.mode === 'custom' ? 'custom' : 'unknown';
  if (mode === 'unknown') return { value: { mode: 'unknown', bytes: null, text: '未知' } };
  const raw = String(s.value === undefined || s.value === null ? '' : s.value).trim();
  const unit = String(s.unit || '').toUpperCase();
  if (raw === '') return { error: '请输入文件大小数值' };
  if (!SIZE_UNITS[unit]) return { error: '文件大小单位只能是 B / KB / MB / GB' };
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(raw)) {
    return { error: '文件大小格式错误：最多 4 位整数、最多 2 位小数（例如 1024 或 12.34）' };
  }
  const num = Number(raw);
  if (!(num > 0)) return { error: '文件大小必须大于 0' };
  const bytes = Math.round(num * SIZE_UNITS[unit]);
  return { value: { mode: 'custom', bytes, text: formatSize(bytes) } };
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '未知';
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const text = i === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  return `${text} ${units[i]}`;
}

/** 校验下载地址列表 */
function validateLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return { error: '请至少添加一个文件地址（直链或站外分享链接）' };
  if (links.length > 20) return { error: '一个文件最多添加 20 个地址' };
  const out = [];
  const seen = new Set();
  for (let i = 0; i < links.length; i++) {
    const item = links[i] || {};
    const kind = item.kind === 'external' ? 'external' : 'direct';
    const url = String(item.url || '').trim();
    const label = `第 ${i + 1} 个地址`;
    if (!url) return { error: `${label}不能为空` };
    if (url.length > 2000) return { error: `${label}过长` };
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return { error: `${label}不是合法的 URL（需以 http:// 或 https:// 开头）` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: `${label}只支持 http / https 协议` };
    }
    let source = String(item.source || '').trim();
    if (kind === 'external') {
      if (!source) return { error: `${label}为站外分享链接，必须填写来源` };
      if ([...source].length > 64) return { error: `${label}的来源不能超过 64 个字符` };
    } else {
      source = '';
    }
    const key = kind + '|' + url;
    if (seen.has(key)) return { error: `${label}与其他地址重复` };
    seen.add(key);
    out.push({ kind, url, source, sort_order: i });
  }
  return { value: out };
}

/* ============================ 鉴权 ============================ */
async function createSession(env, adminId, request) {
  const token = randomToken(48);
  const now = nowBeijing();
  const expires = tsToBeijing(Date.now() + SESSION_DAYS * 86400 * 1000);
  await db(env)
    .prepare('INSERT INTO bcd_sessions(token,admin_id,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)')
    .bind(token, adminId, now, expires, clientIp(request), userAgent(request))
    .run();
  return { token, expires };
}

async function currentAdmin(request, env) {
  const cookies = parseCookies(request);
  let token = cookies[COOKIE_NAME];
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
  if (!token) return null;
  const row = await db(env)
    .prepare(
      `SELECT s.token AS session_token, s.expires_at AS session_expires, a.id AS admin_id, a.username, a.display_name, a.role, a.status
       FROM bcd_sessions s JOIN bcd_admins a ON a.id = s.admin_id WHERE s.token = ?`
    )
    .bind(token)
    .first();
  if (!row) return null;
  if (String(row.session_expires) < nowBeijing()) {
    await db(env).prepare('DELETE FROM bcd_sessions WHERE token=?').bind(token).run();
    return null;
  }
  if (row.status !== 'active') return null;
  const role = row.role === 'total' ? 'total' : row.role === 'user' ? 'user' : 'sub';
  return {
    id: Number(row.admin_id),
    username: row.username,
    displayName: row.display_name || row.username,
    role,
    isStaff: role === 'total' || role === 'sub',
    token,
  };
}

/** 任意已登录账号（总管理员 / 子管理员 / 用户） */
async function requireLogin(request, env) {
  const account = await currentAdmin(request, env);
  if (!account) throw new ApiError('登录状态已失效，请重新登录', 401);
  return account;
}

/** 管理员（总管理员 / 子管理员）；「用户」无权访问后台接口 */
async function requireAdmin(request, env) {
  const account = await requireLogin(request, env);
  if (!account.isStaff) throw new ApiError('当前账号没有管理权限', 403);
  return account;
}
async function requireTotal(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin.role !== 'total') throw new ApiError('只有总管理员可以执行该操作', 403);
  return admin;
}

/* ============================ 序列化 ============================ */
function fileExt(name) {
  const i = String(name).lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

function serializeFile(row, linkCount) {
  return {
    id: Number(row.id),
    shareId: row.share_id,
    name: row.name,
    folder: row.folder,
    path: row.path,
    ext: row.ext || '',
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    sizeText: row.size_text || '未知',
    description: row.description || '',
    hasPassword: !!row.password_hash,
    downloadCount: Number(row.download_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    linkCount: linkCount === undefined ? undefined : Number(linkCount),
  };
}

function serializeFolder(row) {
  const out = {
    id: Number(row.id),
    name: row.name,
    path: row.path,
    parent: row.parent,
    shareId: row.share_id,
    createdAt: row.created_at,
  };
  if (row.sub_count !== undefined && row.sub_count !== null) {
    out.subCount = Number(row.sub_count);
    out.fileCount = Number(row.file_count || 0);
    out.empty = out.subCount === 0 && out.fileCount === 0;
  }
  return out;
}

function serializeLink(row) {
  return { id: Number(row.id), kind: row.kind, url: row.url, source: row.source || '', sortOrder: Number(row.sort_order || 0) };
}

/* ============================ 分享令牌 ============================ */
async function makeShareToken(env, fileId, ttlMinutes = 120) {
  const secret = await getSetting(env, 'secret_key');
  const payload = b64urlEncode(JSON.stringify({ f: Number(fileId), exp: Date.now() + ttlMinutes * 60000 }));
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}
async function verifyShareToken(env, token, fileId) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const secret = await getSetting(env, 'secret_key');
  const sig = await hmacSign(parts[0], secret);
  if (sig !== parts[1]) return false;
  try {
    const payload = JSON.parse(b64urlDecode(parts[0]));
    if (Number(payload.f) !== Number(fileId)) return false;
    if (Number(payload.exp) < Date.now()) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/* ============================ 文件夹辅助 ============================ */
async function uniqueShareId(env) {
  for (let i = 0; i < 8; i++) {
    const id = randomToken(10);
    const a = await db(env).prepare('SELECT 1 AS x FROM bcd_files WHERE share_id=?').bind(id).first();
    if (a) continue;
    const b = await db(env).prepare('SELECT 1 AS x FROM bcd_folders WHERE share_id=?').bind(id).first();
    if (b) continue;
    return id;
  }
  return randomToken(16);
}

/** 确保路径上的所有文件夹存在，返回叶子文件夹路径 */
async function ensureFolders(env, folderPath) {
  const norm = normalizePath(folderPath);
  if (norm.error) return norm;
  const path = norm.value;
  if (path === '/') return { value: '/' };
  const now = nowBeijing();
  const segs = path.split('/').filter(Boolean);
  let cur = '';
  const stmts = [];
  for (const seg of segs) {
    const parent = cur === '' ? '/' : cur;
    cur = cur + '/' + seg;
    const exists = await db(env).prepare('SELECT id FROM bcd_folders WHERE path=?').bind(cur).first();
    if (exists) continue;
    const sid = await uniqueShareId(env);
    stmts.push(
      db(env)
        .prepare('INSERT OR IGNORE INTO bcd_folders(path,name,parent,share_id,created_at) VALUES(?,?,?,?,?)')
        .bind(cur, seg, parent, sid, now)
    );
  }
  if (stmts.length) await db(env).batch(stmts);
  return { value: path };
}

function breadcrumbFor(rootPath, currentPath) {
  const root = rootPath === '/' ? '/' : rootPath;
  const out = [{ name: root === '/' ? '根目录' : root.split('/').filter(Boolean).pop(), path: root }];
  if (currentPath === root) return out;
  const rel = currentPath.slice(root === '/' ? 1 : root.length + 1);
  let cur = root === '/' ? '' : root;
  for (const seg of rel.split('/').filter(Boolean)) {
    cur = cur + '/' + seg;
    out.push({ name: seg, path: cur });
  }
  return out;
}

function isInside(root, path) {
  if (root === '/') return true;
  return path === root || path.startsWith(root + '/');
}

/* ============================ API 路由 ============================ */
async function handleApi(request, env, url) {
  await ensureDb(env);
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const method = request.method.toUpperCase();
  const q = url.searchParams;

  /* ---------- 站点信息（公开） ---------- */
  if (path === '/api/site' && method === 'GET') {
    const s = await getSettings(env);
    const admin = await currentAdmin(request, env);
    return ok({
      version: VERSION,
      repoUrl: REPO_URL,
      siteName: s.site_name || DEFAULT_SETTINGS.site_name,
      homeDesc: s.home_desc === undefined ? DEFAULT_SETTINGS.home_desc : s.home_desc,
      homeNotice: s.home_notice === undefined ? DEFAULT_SETTINGS.home_notice : s.home_notice,
      guestBrowse: s.guest_browse === '1',
      guestRoot: s.guest_root || DEFAULT_SETTINGS.guest_root,
      userRoot: s.user_root || DEFAULT_SETTINGS.user_root,
      allowSearch: s.allow_search === '1',
      countDownload: s.count_download === '1',
      isAdmin: !!(admin && admin.isStaff),
      isUser: !!(admin && admin.role === 'user'),
      role: admin ? admin.role : 'guest',
      admin: admin ? { username: admin.username, displayName: admin.displayName, role: admin.role } : null,
    });
  }

  /* ---------- 登录 ---------- */
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJson(request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username) fail('请输入用户名', 400, { username: '请输入用户名' });
    if (!password) fail('请输入密码', 400, { password: '请输入密码' });
    const row = await db(env).prepare('SELECT * FROM bcd_admins WHERE username=?').bind(username).first();
    if (!row) fail('用户名或密码错误', 401);
    if (row.status !== 'active') fail('该账号已被禁用', 403);
    const hash = await hashPassword(password, row.salt);
    if (hash !== row.password_hash) fail('用户名或密码错误', 401);
    const { token, expires } = await createSession(env, Number(row.id), request);
    await db(env).prepare('UPDATE bcd_admins SET last_login_at=? WHERE id=?').bind(nowBeijing(), Number(row.id)).run();
    const role = row.role === 'total' ? 'total' : row.role === 'user' ? 'user' : 'sub';
    await logAction(env, { username, role }, 'login', username, '登录成功', request);
    return json(
      {
        ok: true,
        data: { username: row.username, displayName: row.display_name || row.username, role, expires },
      },
      200,
      { 'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` }
    );
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const admin = await currentAdmin(request, env);
    if (admin) await db(env).prepare('DELETE FROM bcd_sessions WHERE token=?').bind(admin.token).run();
    return json({ ok: true, data: {} }, 200, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  }

  if (path === '/api/auth/me' && method === 'GET') {
    const admin = await currentAdmin(request, env);
    if (!admin) return jsonError('未登录', 401);
    return ok({ username: admin.username, displayName: admin.displayName, role: admin.role });
  }

  /* ---------- 修改自己的账号（包括「用户」，只能改自己的昵称与密码） ---------- */
  if (path === '/api/auth/me' && method === 'PUT') {
    const admin = await requireLogin(request, env);
    const body = await readJson(request);
    const fields = {};
    const displayName = String(body.displayName === undefined ? admin.displayName : body.displayName).trim();
    if ([...displayName].length > 32) fields.displayName = '昵称不能超过 32 个字符';
    let newHash = null;
    let newSalt = null;
    if (body.newPassword) {
      const pv = validateAdminPassword(body.newPassword, '新密码');
      if (pv.error) fields.newPassword = pv.error;
      else {
        const row = await db(env).prepare('SELECT salt,password_hash FROM bcd_admins WHERE id=?').bind(admin.id).first();
        const oldHash = await hashPassword(String(body.oldPassword || ''), row.salt);
        if (oldHash !== row.password_hash) fields.oldPassword = '原密码不正确';
        else {
          newSalt = randomToken(16);
          newHash = await hashPassword(String(body.newPassword), newSalt);
        }
      }
    }
    if (Object.keys(fields).length) fail('请检查填写内容', 400, fields);
    if (newHash) {
      await db(env).prepare('UPDATE bcd_admins SET display_name=?, password_hash=?, salt=? WHERE id=?').bind(displayName, newHash, newSalt, admin.id).run();
      await db(env).prepare('DELETE FROM bcd_sessions WHERE admin_id=? AND token<>?').bind(admin.id, admin.token).run();
    } else {
      await db(env).prepare('UPDATE bcd_admins SET display_name=? WHERE id=?').bind(displayName, admin.id).run();
    }
    await logAction(env, admin, 'update_profile', admin.username, '修改个人资料', request);
    return ok({ displayName });
  }

  /* ---------- 全局设置 ---------- */
  if (path === '/api/admin/settings' && method === 'GET') {
    await requireAdmin(request, env);
    const s = await getSettings(env);
    return ok({
      siteName: s.site_name || DEFAULT_SETTINGS.site_name,
      version: VERSION,
      repoUrl: REPO_URL,
      homeDesc: s.home_desc === undefined ? DEFAULT_SETTINGS.home_desc : s.home_desc,
      homeNotice: s.home_notice === undefined ? DEFAULT_SETTINGS.home_notice : s.home_notice,
      guestBrowse: s.guest_browse === '1',
      guestRoot: s.guest_root,
      userRoot: s.user_root || DEFAULT_SETTINGS.user_root,
      allowSearch: s.allow_search === '1',
      countDownload: s.count_download === '1',
      initializedAt: s.initialized_at || '',
      adminCount: Number((await db(env).prepare("SELECT COUNT(*) AS c FROM bcd_admins WHERE role<>'user'").first()).c),
      userCount: Number((await db(env).prepare("SELECT COUNT(*) AS c FROM bcd_admins WHERE role='user'").first()).c),
      fileCount: Number((await db(env).prepare('SELECT COUNT(*) AS c FROM bcd_files').first()).c),
    });
  }

  if (path === '/api/admin/settings' && method === 'PUT') {
    const admin = await requireAdmin(request, env);
    const body = await readJson(request);
    const fields = {};
    const updates = [];
    const now = nowBeijing();
    const put = (k, v) => updates.push(db(env).prepare('INSERT INTO bcd_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind(k, String(v), now));

    if (body.siteName !== undefined) {
      const name = String(body.siteName).trim();
      if (!name) fields.siteName = '站点名称不能为空';
      else if ([...name].length > 32) fields.siteName = '站点名称不能超过 32 个字符';
      else put('site_name', name);
    }
    if (body.guestRoot !== undefined) {
      const r = normalizePath(body.guestRoot, '未登录访客根目录');
      if (r.error) fields.guestRoot = r.error;
      else put('guest_root', r.value);
    }
    if (body.userRoot !== undefined) {
      const r = normalizePath(body.userRoot, '用户根目录');
      if (r.error) fields.userRoot = r.error;
      else put('user_root', r.value);
    }
    if (body.homeDesc !== undefined) {
      const v = String(body.homeDesc).trim();
      if ([...v].length > 200) fields.homeDesc = '主页简介不能超过 200 个字符';
      else put('home_desc', v);
    }
    if (body.homeNotice !== undefined) {
      const v = String(body.homeNotice);
      if ([...v].length > 5000) fields.homeNotice = '公告内容不能超过 5000 个字符';
      else put('home_notice', v);
    }
    if (body.guestBrowse !== undefined) put('guest_browse', body.guestBrowse ? '1' : '0');
    if (body.allowSearch !== undefined) put('allow_search', body.allowSearch ? '1' : '0');
    if (body.countDownload !== undefined) put('count_download', body.countDownload ? '1' : '0');

    if (Object.keys(fields).length) fail('请检查填写内容', 400, fields);
    if (!updates.length) fail('没有需要保存的设置', 400);
    await db(env).batch(updates);
    await logAction(env, admin, 'update_settings', 'global', JSON.stringify(body).slice(0, 300), request);
    const s = await getSettings(env);
    return ok({
      siteName: s.site_name || DEFAULT_SETTINGS.site_name,
      version: VERSION,
      homeDesc: s.home_desc === undefined ? DEFAULT_SETTINGS.home_desc : s.home_desc,
      homeNotice: s.home_notice === undefined ? DEFAULT_SETTINGS.home_notice : s.home_notice,
      guestBrowse: s.guest_browse === '1',
      guestRoot: s.guest_root,
      userRoot: s.user_root || DEFAULT_SETTINGS.user_root,
      allowSearch: s.allow_search === '1',
      countDownload: s.count_download === '1',
    });
  }

  /* ---------- 账号列表（仅总管理员） ---------- */
  if (path === '/api/admin/admins' && method === 'GET') {
    await requireTotal(request, env);
    const res = await db(env)
      .prepare("SELECT id,username,display_name,role,status,created_by,created_at,last_login_at FROM bcd_admins ORDER BY CASE role WHEN 'total' THEN 0 WHEN 'sub' THEN 1 ELSE 2 END, id ASC")
      .all();
    return ok({
      admins: ((res && res.results) || []).map((r) => ({
        id: Number(r.id),
        username: r.username,
        displayName: r.display_name || r.username,
        role: r.role === 'total' ? 'total' : r.role === 'user' ? 'user' : 'sub',
        status: r.status,
        createdBy: r.created_by,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at || '',
      })),
    });
  }

  if (path === '/api/admin/admins' && method === 'POST') {
    const admin = await requireTotal(request, env);
    const body = await readJson(request);
    const fields = {};
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim();
    const role = body.role === 'user' ? 'user' : 'sub';
    if (!username) fields.username = '请输入用户名';
    else if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) fields.username = '用户名只能包含字母、数字、_ . -，长度 3-32';
    const pv = validateAdminPassword(body.password, '密码');
    if (pv.error) fields.password = pv.error;
    if ([...displayName].length > 32) fields.displayName = '昵称不能超过 32 个字符';
    if (Object.keys(fields).length) fail('请检查填写内容', 400, fields);
    const dup = await db(env).prepare('SELECT id FROM bcd_admins WHERE username=?').bind(username).first();
    if (dup) fail('该用户名已存在', 409, { username: '该用户名已存在' });
    const salt = randomToken(16);
    const hash = await hashPassword(String(body.password), salt);
    await db(env)
      .prepare('INSERT INTO bcd_admins(username,password_hash,salt,display_name,role,status,created_by,created_at,last_login_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(username, hash, salt, displayName || username, role, 'active', admin.username, nowBeijing(), '')
      .run();
    await logAction(env, admin, 'create_admin', username, role === 'user' ? '新建用户' : '新建子管理员', request);
    return ok({ username, role });
  }

  const adminIdMatch = path.match(/^\/api\/admin\/admins\/(\d+)$/);
  if (adminIdMatch) {
    const id = Number(adminIdMatch[1]);
    const admin = await requireTotal(request, env);
    const target = await db(env).prepare('SELECT * FROM bcd_admins WHERE id=?').bind(id).first();
    if (!target) fail('账号不存在', 404);
    const isSelf = Number(target.id) === Number(admin.id);

    if (method === 'PUT') {
      const body = await readJson(request);
      const fields = {};
      const sets = [];
      const binds = [];
      if (body.displayName !== undefined) {
        const dn = String(body.displayName).trim();
        if ([...dn].length > 32) fields.displayName = '昵称不能超过 32 个字符';
        else {
          sets.push('display_name=?');
          binds.push(dn || target.username);
        }
      }
      if (body.password) {
        // 安全要求：在账号列表里改密必须验证「当前登录账号」的原密码，避免会话被盗后直接改密
        const pv = validateAdminPassword(body.password, '新密码');
        if (pv.error) fields.password = pv.error;
        const current = String(body.currentPassword || '');
        if (!current) fields.currentPassword = '请输入你当前登录账号的密码';
        else {
          const me = await db(env).prepare('SELECT salt,password_hash FROM bcd_admins WHERE id=?').bind(admin.id).first();
          const okPw = (await hashPassword(current, me.salt)) === me.password_hash;
          if (!okPw) fields.currentPassword = '当前登录账号的密码不正确';
        }
        if (!fields.password && !fields.currentPassword) {
          const salt = randomToken(16);
          sets.push('password_hash=?', 'salt=?');
          binds.push(await hashPassword(String(body.password), salt), salt);
        }
      }
      if (body.status !== undefined) {
        const st = body.status === 'disabled' ? 'disabled' : 'active';
        if (target.role === 'total' && st === 'disabled') fields.status = '总管理员账号不能被禁用';
        else {
          sets.push('status=?');
          binds.push(st);
        }
      }
      if (body.role !== undefined && !isSelf) {
        if (target.role === 'total') fields.role = '总管理员账号的角色不能修改';
        else {
          sets.push('role=?');
          binds.push(body.role === 'user' ? 'user' : 'sub');
        }
      }
      if (Object.keys(fields).length) fail('请检查填写内容', 400, fields);
      if (!sets.length) fail('没有需要修改的内容', 400);
      await db(env).prepare(`UPDATE bcd_admins SET ${sets.join(', ')} WHERE id=?`).bind(...binds, id).run();
      if (body.password || body.status === 'disabled') {
        if (isSelf) {
          await db(env).prepare('DELETE FROM bcd_sessions WHERE admin_id=? AND token<>?').bind(id, admin.token).run();
        } else {
          await db(env).prepare('DELETE FROM bcd_sessions WHERE admin_id=?').bind(id).run();
        }
      }
      await logAction(env, admin, 'update_admin', target.username, JSON.stringify(Object.keys(body)).slice(0, 200), request);
      return ok({ id });
    }

    if (method === 'DELETE') {
      if (isSelf) fail('不能删除当前登录的账号', 400);
      if (target.role === 'total') {
        const c = await db(env).prepare("SELECT COUNT(*) AS c FROM bcd_admins WHERE role='total' AND status='active'").first();
        if (Number(c.c) <= 1) fail('必须保留至少一个总管理员账号', 400);
      }
      await db(env).batch([
        db(env).prepare('DELETE FROM bcd_sessions WHERE admin_id=?').bind(id),
        db(env).prepare('DELETE FROM bcd_admins WHERE id=?').bind(id),
      ]);
      await logAction(env, admin, 'delete_admin', target.username, target.role === 'user' ? '删除用户' : '删除账号', request);
      return ok({ id });
    }
  }

  /* ---------- 全部文件浏览（访客 / 用户 / 管理员） ---------- */
  if (path === '/api/files/list' && method === 'GET') {
    const s = await getSettings(env);
    const account = await currentAdmin(request, env);
    const isStaff = !!(account && account.isStaff);
    const isUser = !!(account && account.role === 'user');
    const guestBrowse = s.guest_browse === '1';
    if (!account && !guestBrowse) fail('管理员未开放文件浏览', 403);
    const root = isStaff ? '/' : isUser ? s.user_root || DEFAULT_SETTINGS.user_root : s.guest_root || DEFAULT_SETTINGS.guest_root;
    let reqPath = q.get('path') || root;
    const np = normalizePath(reqPath, '目录路径');
    if (np.error) fail(np.error, 400, { path: np.error });
    let cur = np.value;
    if (!isStaff && !isInside(root, cur)) cur = root;

    const search = (q.get('search') || '').trim();
    if (search && !isStaff && s.allow_search !== '1') fail('管理员未开放搜索功能', 403);
    const sort = ['name', 'size', 'time', 'type', 'downloads'].includes(q.get('sort')) ? q.get('sort') : 'name';
    const order = q.get('order') === 'desc' ? 'DESC' : 'ASC';
    const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(q.get('pageSize') || '200', 10) || 200));

    const orderSql = {
      name: `f.name COLLATE NOCASE ${order}`,
      size: `CASE WHEN f.size_bytes IS NULL THEN -1 ELSE f.size_bytes END ${order}`,
      time: `f.created_at ${order}`,
      type: `f.ext ${order}, f.name COLLATE NOCASE ASC`,
      downloads: `f.download_count ${order}`,
    }[sort];

    let folders = [];
    let files = [];
    let total = 0;

    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      const scope = root === '/' ? '' : ` AND (f.path = ? OR f.path LIKE ?)`;
      const scopeBinds = root === '/' ? [] : [root, root + '/%'];
      const fSql = `SELECT f.*, (SELECT COUNT(*) FROM bcd_links l WHERE l.file_id=f.id) AS link_count FROM bcd_files f WHERE f.name LIKE ? ESCAPE '\\'${scope}`;
      const cnt = await db(env).prepare(`SELECT COUNT(*) AS c FROM bcd_files f WHERE f.name LIKE ? ESCAPE '\\'${scope}`).bind(like, ...scopeBinds).first();
      total = Number(cnt.c);
      const res = await db(env).prepare(`${fSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`).bind(like, ...scopeBinds, pageSize, (page - 1) * pageSize).all();
      files = ((res && res.results) || []).map((r) => serializeFile(r, r.link_count));
      const fRes = await db(env)
        .prepare(
          `SELECT f.*, (SELECT COUNT(*) FROM bcd_folders c WHERE c.parent=f.path) AS sub_count,
                  (SELECT COUNT(*) FROM bcd_files x WHERE x.folder=f.path) AS file_count
           FROM bcd_folders f WHERE f.name LIKE ? ESCAPE '\\'${root === '/' ? '' : ` AND (f.path = ? OR f.path LIKE ?)`} ORDER BY f.name COLLATE NOCASE ASC LIMIT 200`
        )
        .bind(like, ...scopeBinds)
        .all();
      folders = ((fRes && fRes.results) || []).map(serializeFolder);
    } else {
      const fRes = await db(env)
        .prepare(
          `SELECT f.*, (SELECT COUNT(*) FROM bcd_folders c WHERE c.parent=f.path) AS sub_count,
                  (SELECT COUNT(*) FROM bcd_files x WHERE x.folder=f.path) AS file_count
           FROM bcd_folders f WHERE f.parent=? ORDER BY f.name COLLATE NOCASE ASC`
        )
        .bind(cur)
        .all();
      folders = ((fRes && fRes.results) || []).map(serializeFolder);
      const cnt = await db(env).prepare('SELECT COUNT(*) AS c FROM bcd_files WHERE folder=?').bind(cur).first();
      total = Number(cnt.c);
      const res = await db(env)
        .prepare(`SELECT f.*, (SELECT COUNT(*) FROM bcd_links l WHERE l.file_id=f.id) AS link_count FROM bcd_files f WHERE f.folder=? ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
        .bind(cur, pageSize, (page - 1) * pageSize)
        .all();
      files = ((res && res.results) || []).map((r) => serializeFile(r, r.link_count));
    }

    let parent = cur === '/' ? null : cur.split('/').filter(Boolean).slice(0, -1).join('/') || '/';
    if (parent !== null && !isInside(root, parent)) parent = null;
    return ok({
      path: cur,
      parent,
      root,
      isAdmin: isStaff,
      isUser,
      role: account ? account.role : 'guest',
      breadcrumb: breadcrumbFor(root, cur),
      folders,
      files,
      total,
      page,
      pageSize,
      allowSearch: isStaff ? true : s.allow_search === '1',
      countDownload: s.count_download === '1',
    });
  }

  /* ---------- 分享：单文件 ---------- */
  const shareFileMatch = path.match(/^\/api\/share\/file\/([A-Za-z0-9_-]+)$/);
  if (shareFileMatch && method === 'GET') {
    const row = await db(env).prepare('SELECT * FROM bcd_files WHERE share_id=?').bind(shareFileMatch[1]).first();
    if (!row) fail('分享不存在或已被取消', 404);
    const s = await getSettings(env);
    const linkCount = Number((await db(env).prepare('SELECT COUNT(*) AS c FROM bcd_links WHERE file_id=?').bind(row.id).first()).c);
    const out = serializeFile(row, linkCount);
    out.folderShareId = (await db(env).prepare('SELECT share_id FROM bcd_folders WHERE path=?').bind(row.folder).first() || {}).share_id || null;
    return ok({ file: out, hasPassword: !!row.password_hash, countDownload: s.count_download === '1', siteName: s.site_name || DEFAULT_SETTINGS.site_name });
  }

  const shareUnlockMatch = path.match(/^\/api\/share\/file\/([A-Za-z0-9_-]+)\/unlock$/);
  if (shareUnlockMatch && method === 'POST') {
    const row = await db(env).prepare('SELECT * FROM bcd_files WHERE share_id=?').bind(shareUnlockMatch[1]).first();
    if (!row) fail('分享不存在或已被取消', 404);
    if (!row.password_hash) fail('该分享无需密码', 400);
    const body = await readJson(request);
    const pw = String(body.password || '');
    if (!pw) fail('请输入下载密码', 400, { password: '请输入下载密码' });
    const hash = await hashPassword(pw, row.password_salt);
    if (hash !== row.password_hash) fail('下载密码错误', 403, { password: '下载密码错误' });
    const token = await makeShareToken(env, row.id);
    const res = await db(env).prepare('SELECT * FROM bcd_links WHERE file_id=? ORDER BY sort_order ASC, id ASC').bind(row.id).all();
    return ok({ token, links: ((res && res.results) || []).map(serializeLink) });
  }

  const shareLinksMatch = path.match(/^\/api\/share\/file\/([A-Za-z0-9_-]+)\/links$/);
  if (shareLinksMatch && method === 'GET') {
    const row = await db(env).prepare('SELECT * FROM bcd_files WHERE share_id=?').bind(shareLinksMatch[1]).first();
    if (!row) fail('分享不存在或已被取消', 404);
    let token = q.get('token') || '';
    if (row.password_hash) {
      const valid = await verifyShareToken(env, token, row.id);
      if (!valid) fail('需要下载密码', 403, { password: '需要下载密码' });
      token = await makeShareToken(env, row.id);
    } else {
      token = await makeShareToken(env, row.id);
    }
    const res = await db(env).prepare('SELECT * FROM bcd_links WHERE file_id=? ORDER BY sort_order ASC, id ASC').bind(row.id).all();
    return ok({ token, links: ((res && res.results) || []).map(serializeLink) });
  }

  /* ---------- 分享：文件夹（/sf/<id>） ---------- */
  const shareFolderMatch = path.match(/^\/api\/share\/folder\/([A-Za-z0-9_-]+)$/);
  if (shareFolderMatch && method === 'GET') {
    const s = await getSettings(env);
    const folder = await db(env).prepare('SELECT * FROM bcd_folders WHERE share_id=?').bind(shareFolderMatch[1]).first();
    if (!folder) fail('分享不存在或已被取消', 404);
    const root = folder.path;
    let cur = q.get('path') || root;
    const np = normalizePath(cur, '目录路径');
    if (np.error) fail(np.error, 400);
    cur = np.value;
    if (!isInside(root, cur)) cur = root;
    const search = (q.get('search') || '').trim();
    const allowSearch = s.allow_search === '1';
    if (search && !allowSearch) fail('管理员未开放搜索功能', 403);

    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      const res = await db(env)
        .prepare(`SELECT f.*, (SELECT COUNT(*) FROM bcd_links l WHERE l.file_id=f.id) AS link_count FROM bcd_files f WHERE f.name LIKE ? ESCAPE '\\' AND (f.path=? OR f.path LIKE ?) ORDER BY f.name COLLATE NOCASE ASC LIMIT 300`)
        .bind(like, root, root + '/%')
        .all();
      const fRes = await db(env).prepare('SELECT * FROM bcd_folders WHERE name LIKE ? ESCAPE \'\\\' AND (path=? OR path LIKE ?) ORDER BY name COLLATE NOCASE ASC LIMIT 300').bind(like, root, root + '/%').all();
      return ok({
        folder: serializeFolder(folder),
        path: cur,
        root,
        search,
        breadcrumb: breadcrumbFor(root, cur),
        folders: ((fRes && fRes.results) || []).map(serializeFolder),
        files: ((res && res.results) || []).map((r) => serializeFile(r, r.link_count)),
        allowSearch,
        countDownload: s.count_download === '1',
      });
    }

    const fRes = await db(env).prepare('SELECT * FROM bcd_folders WHERE parent=? ORDER BY name COLLATE NOCASE ASC').bind(cur).all();
    const res = await db(env)
      .prepare(`SELECT f.*, (SELECT COUNT(*) FROM bcd_links l WHERE l.file_id=f.id) AS link_count FROM bcd_files f WHERE f.folder=? ORDER BY f.name COLLATE NOCASE ASC LIMIT 300`)
      .bind(cur)
      .all();
    return ok({
      folder: serializeFolder(folder),
      path: cur,
      root,
      search: '',
      breadcrumb: breadcrumbFor(root, cur),
      folders: ((fRes && fRes.results) || []).map(serializeFolder),
      files: ((res && res.results) || []).map((r) => serializeFile(r, r.link_count)),
      allowSearch,
      countDownload: s.count_download === '1',
    });
  }

  /* ---------- 下载跳转 ---------- */
  const dlMatch = path.match(/^\/api\/dl\/(\d+)\/(\d+)$/);
  if (dlMatch && method === 'GET') {
    const fileId = Number(dlMatch[1]);
    const linkId = Number(dlMatch[2]);
    const file = await db(env).prepare('SELECT * FROM bcd_files WHERE id=?').bind(fileId).first();
    if (!file) fail('文件不存在', 404);
    if (file.password_hash) {
      const valid = await verifyShareToken(env, q.get('token') || '', fileId);
      if (!valid) fail('需要下载密码', 403);
    }
    const link = await db(env).prepare('SELECT * FROM bcd_links WHERE id=? AND file_id=?').bind(linkId, fileId).first();
    if (!link) fail('下载地址不存在', 404);
    await recordDownload(env, file, link, request);
    return new Response(null, { status: 302, headers: { Location: link.url, 'cache-control': 'no-store' } });
  }

  /* ---------- 外部链接计数 ---------- */
  if (path === '/api/dl/count' && method === 'POST') {
    const body = await readJson(request);
    const fileId = Number(body.fileId || 0);
    const linkId = Number(body.linkId || 0);
    const file = await db(env).prepare('SELECT * FROM bcd_files WHERE id=?').bind(fileId).first();
    if (!file) fail('文件不存在', 404);
    if (file.password_hash) {
      const valid = await verifyShareToken(env, String(body.token || ''), fileId);
      if (!valid) fail('需要下载密码', 403);
    }
    const link = await db(env).prepare('SELECT * FROM bcd_links WHERE id=? AND file_id=?').bind(linkId, fileId).first();
    if (!link) fail('下载地址不存在', 404);
    await recordDownload(env, file, link, request);
    return ok({});
  }

  /* ---------- 管理员：文件分享列表 ---------- */
  if (path === '/api/admin/files' && method === 'GET') {
    await requireAdmin(request, env);
    const search = (q.get('search') || '').trim();
    const sort = ['name', 'size', 'time', 'type', 'downloads'].includes(q.get('sort')) ? q.get('sort') : 'time';
    const order = q.get('order') === 'asc' ? 'ASC' : (q.get('order') === 'desc' ? 'DESC' : sort === 'time' ? 'DESC' : 'ASC');
    const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(q.get('pageSize') || '60', 10) || 60));
    const orderSql = {
      name: `f.name COLLATE NOCASE ${order}`,
      size: `CASE WHEN f.size_bytes IS NULL THEN -1 ELSE f.size_bytes END ${order}`,
      time: `f.created_at ${order}, f.id ${order}`,
      type: `f.ext ${order}, f.name COLLATE NOCASE ASC`,
      downloads: `f.download_count ${order}`,
    }[sort];
    let where = '';
    let binds = [];
    if (search) {
      where = `WHERE f.name LIKE ? ESCAPE '\\' OR f.path LIKE ? ESCAPE '\\'`;
      const like = `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      binds = [like, like];
    }
    const cnt = await db(env).prepare(`SELECT COUNT(*) AS c FROM bcd_files f ${where}`).bind(...binds).first();
    const res = await db(env)
      .prepare(`SELECT f.*, (SELECT COUNT(*) FROM bcd_links l WHERE l.file_id=f.id) AS link_count FROM bcd_files f ${where} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, (page - 1) * pageSize)
      .all();
    const s = await getSettings(env);
    return ok({
      files: ((res && res.results) || []).map((r) => serializeFile(r, r.link_count)),
      total: Number(cnt.c),
      page,
      pageSize,
      countDownload: s.count_download === '1',
    });
  }

  /* ---------- 管理员：新增分享文件 ---------- */
  if (path === '/api/admin/files' && method === 'POST') {
    const admin = await requireAdmin(request, env);
    const body = await readJson(request);
    const v = await validateFilePayload(body, { isCreate: true });
    if (v.error) fail(v.error.message, 400, v.error.fields);
    const d = v.value;

    const dup = await db(env).prepare('SELECT id FROM bcd_files WHERE folder=? AND name=?').bind(d.folder, d.name).first();
    if (dup) fail('该路径下已存在同名文件', 409, { name: '该路径下已存在同名文件' });

    await ensureFolders(env, d.folder);
    const shareId = await uniqueShareId(env);
    const now = nowBeijing();
    const res = await db(env)
      .prepare(
        `INSERT INTO bcd_files(share_id,name,folder,path,ext,size_bytes,size_text,description,password_hash,password_salt,download_count,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`
      )
      .bind(shareId, d.name, d.folder, (d.folder === '/' ? '' : d.folder) + '/' + d.name, d.ext, d.sizeBytes, d.sizeText, d.description, d.passwordHash, d.passwordSalt, now, now)
      .run();
    const fileId = Number((res && res.meta && res.meta.last_row_id) || 0) || Number((await db(env).prepare('SELECT id FROM bcd_files WHERE share_id=?').bind(shareId).first()).id);
    const stmts = d.links.map((l) =>
      db(env).prepare('INSERT INTO bcd_links(file_id,kind,url,source,sort_order) VALUES(?,?,?,?,?)').bind(fileId, l.kind, l.url, l.source, l.sort_order)
    );
    if (stmts.length) await db(env).batch(stmts);
    return ok({ shareId, id: fileId, createdAt: now });
  }

  const adminFileMatch = path.match(/^\/api\/admin\/files\/([A-Za-z0-9_-]+)$/);
  if (adminFileMatch) {
    const admin = await requireAdmin(request, env);
    const row = await db(env).prepare('SELECT * FROM bcd_files WHERE share_id=?').bind(adminFileMatch[1]).first();
    if (!row) fail('文件不存在', 404);

    if (method === 'GET') {
      const res = await db(env).prepare('SELECT * FROM bcd_links WHERE file_id=? ORDER BY sort_order ASC, id ASC').bind(row.id).all();
      const out = serializeFile(row, ((res && res.results) || []).length);
      out.links = ((res && res.results) || []).map(serializeLink);
      out.parentFolderShareId = (await db(env).prepare('SELECT share_id FROM bcd_folders WHERE path=?').bind(row.folder).first() || {}).share_id || null;
      return ok({ file: out });
    }

    if (method === 'PUT') {
      const body = await readJson(request);
      const v = await validateFilePayload(body, { isCreate: false, current: row });
      if (v.error) fail(v.error.message, 400, v.error.fields);
      const d = v.value;
      const dup = await db(env).prepare('SELECT id FROM bcd_files WHERE folder=? AND name=? AND id<>?').bind(d.folder, d.name, row.id).first();
      if (dup) fail('该路径下已存在同名文件', 409, { name: '该路径下已存在同名文件' });
      await ensureFolders(env, d.folder);
      const now = nowBeijing();
      await db(env)
        .prepare(
          `UPDATE bcd_files SET name=?, folder=?, path=?, ext=?, size_bytes=?, size_text=?, description=?, password_hash=?, password_salt=?, updated_at=? WHERE id=?`
        )
        .bind(d.name, d.folder, (d.folder === '/' ? '' : d.folder) + '/' + d.name, d.ext, d.sizeBytes, d.sizeText, d.description, d.passwordHash, d.passwordSalt, now, row.id)
        .run();
      await db(env).prepare('DELETE FROM bcd_links WHERE file_id=?').bind(row.id).run();
      const stmts = d.links.map((l) =>
        db(env).prepare('INSERT INTO bcd_links(file_id,kind,url,source,sort_order) VALUES(?,?,?,?,?)').bind(row.id, l.kind, l.url, l.source, l.sort_order)
      );
      if (stmts.length) await db(env).batch(stmts);
      return ok({ shareId: row.share_id });
    }

    if (method === 'DELETE') {
      await db(env).batch([
        db(env).prepare('DELETE FROM bcd_links WHERE file_id=?').bind(row.id),
        db(env).prepare('DELETE FROM bcd_downloads WHERE file_id=?').bind(row.id),
        db(env).prepare('DELETE FROM bcd_files WHERE id=?').bind(row.id),
      ]);
      await logAction(env, admin, 'delete_file', row.share_id, row.path, request);
      return ok({ shareId: row.share_id });
    }
  }

  /* ---------- 管理员：移动文件 ---------- */
  const moveMatch = path.match(/^\/api\/admin\/files\/([A-Za-z0-9_-]+)\/move$/);
  if (moveMatch && method === 'POST') {
    const admin = await requireAdmin(request, env);
    const row = await db(env).prepare('SELECT * FROM bcd_files WHERE share_id=?').bind(moveMatch[1]).first();
    if (!row) fail('文件不存在', 404);
    const body = await readJson(request);
    const np = normalizePath(body.folder, '目标路径');
    if (np.error) fail(np.error, 400, { folder: np.error });
    const folder = np.value;
    const dup = await db(env).prepare('SELECT id FROM bcd_files WHERE folder=? AND name=? AND id<>?').bind(folder, row.name, row.id).first();
    if (dup) fail('目标路径下已存在同名文件', 409, { folder: '目标路径下已存在同名文件' });
    await ensureFolders(env, folder);
    const newPath = (folder === '/' ? '' : folder) + '/' + row.name;
    await db(env).prepare('UPDATE bcd_files SET folder=?, path=?, updated_at=? WHERE id=?').bind(folder, newPath, nowBeijing(), row.id).run();
    await logAction(env, admin, 'move_file', row.share_id, `${row.path} -> ${newPath}`, request);
    return ok({ path: newPath });
  }

  /* ---------- 管理员：新建文件夹 ---------- */
  if (path === '/api/admin/folders' && method === 'POST') {
    const admin = await requireAdmin(request, env);
    const body = await readJson(request);
    let target = body.path;
    if (target === undefined && body.parent !== undefined) {
      const p = normalizePath(body.parent, '上级目录');
      if (p.error) fail(p.error, 400, { parent: p.error });
      const nv = validateName(body.name);
      if (nv.error) fail(nv.error, 400, { name: nv.error });
      target = (p.value === '/' ? '' : p.value) + '/' + nv.value;
    }
    const np = normalizePath(target, '文件夹路径');
    if (np.error) fail(np.error, 400, { path: np.error });
    if (np.value === '/') fail('不能创建根目录', 400, { path: '不能创建根目录' });
    const exists = await db(env).prepare('SELECT id FROM bcd_folders WHERE path=?').bind(np.value).first();
    if (exists) fail('该文件夹已存在', 409, { path: '该文件夹已存在' });
    await ensureFolders(env, np.value);
    const created = await db(env).prepare('SELECT * FROM bcd_folders WHERE path=?').bind(np.value).first();
    await logAction(env, admin, 'create_folder', created.share_id, np.value, request);
    return ok({ folder: serializeFolder(created) });
  }

  const folderDelMatch = path.match(/^\/api\/admin\/folders\/([A-Za-z0-9_-]+)$/);
  if (folderDelMatch && method === 'DELETE') {
    const admin = await requireAdmin(request, env);
    const folder = await db(env).prepare('SELECT * FROM bcd_folders WHERE share_id=?').bind(folderDelMatch[1]).first();
    if (!folder) fail('文件夹不存在', 404);
    const sub = Number((await db(env).prepare('SELECT COUNT(*) AS c FROM bcd_folders WHERE parent=?').bind(folder.path).first()).c);
    const files = Number((await db(env).prepare('SELECT COUNT(*) AS c FROM bcd_files WHERE folder=?').bind(folder.path).first()).c);
    if (sub > 0) fail('文件夹内还有子文件夹，请先清空', 400);
    if (files > 0) fail('文件夹内还有文件，请先删除文件', 400);
    await db(env).prepare('DELETE FROM bcd_folders WHERE id=?').bind(folder.id).run();
    await logAction(env, admin, 'delete_folder', folder.share_id, folder.path, request);
    return ok({ shareId: folder.share_id });
  }

  /* ---------- 数据导出 / 导入（仅总管理员） ----------
     scope   : files（文件） | settings（设置） | both（文件和设置） | logs（日志，仅导出）
     options : downloadCount 下载次数（默认否） / fileDesc 文件简介（默认是）
               accounts 账号列表（默认否） / homeContent 主页简介和标题（默认否）
     -------------------------------------------------- */
  if (path === '/api/admin/backup' && method === 'GET') {
    const admin = await requireTotal(request, env);
    const scope = ['files', 'settings', 'both', 'logs'].includes(q.get('scope')) ? q.get('scope') : 'both';
    const options = {
      downloadCount: q.get('downloadCount') === '1',
      fileDesc: q.get('fileDesc') !== '0',
      accounts: q.get('accounts') === '1',
      homeContent: q.get('homeContent') === '1',
    };
    const tables = [];
    if (scope === 'files' || scope === 'both') tables.push('bcd_folders', 'bcd_files', 'bcd_links');
    if ((scope === 'files' || scope === 'both') && options.downloadCount) tables.push('bcd_downloads');
    if (scope === 'settings' || scope === 'both') tables.push('bcd_settings');
    if (scope === 'logs') tables.push('bcd_logs');
    if ((scope === 'settings' || scope === 'both') && options.accounts) tables.push('bcd_admins');

    const HOME_KEYS = ['site_name', 'home_desc', 'home_notice'];
    const data = {};
    for (const t of tables) {
      const res = await db(env).prepare(`SELECT * FROM ${t}`).all();
      let rows = (res && res.results) || [];
      if (t === 'bcd_files') {
        rows = rows.map((r) => {
          const row = { ...r };
          if (!options.downloadCount) row.download_count = 0; // 不导出下载次数
          if (!options.fileDesc) row.description = ''; // 不导出文件简介
          return row;
        });
      }
      if (t === 'bcd_settings') {
        rows = rows.filter((r) => {
          if (r.key === 'secret_key') return false; // 会话签名密钥不导出
          if (HOME_KEYS.includes(r.key)) return options.homeContent; // 主页简介和标题
          return true;
        });
      }
      data[t] = rows;
    }

    const payload = {
      app: 'BlueCloudDrive',
      version: VERSION,
      exportedAt: nowBeijing(),
      exportedBy: admin.username,
      scope,
      options,
      data,
    };
    await logAction(env, admin, 'export', scope, JSON.stringify(options), request);
    const names = { files: '文件', settings: '设置', both: '文件和设置', logs: '日志' };
    const filename = `bcd-${scope}-${nowBeijing().replace(/[-: ]/g, '')}.json`;
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(`蓝云网盘-${names[scope]}-${nowBeijing().replace(/[-: ]/g, '')}.json`)}`,
        'cache-control': 'no-store',
      },
    });
  }

  if (path === '/api/admin/restore' && method === 'POST') {
    const admin = await requireTotal(request, env);
    const body = await readJson(request, 8 * 1024 * 1024);
    const scope = ['files', 'settings', 'both'].includes(body.scope) ? body.scope : 'both';
    const opts = body.options || {};
    const options = {
      downloadCount: opts.downloadCount === true,
      fileDesc: opts.fileDesc !== false,
      accounts: opts.accounts === true,
      homeContent: opts.homeContent === true,
    };
    const mode = body.mode === 'merge' ? 'merge' : 'replace';
    const payload = body.data && body.data.data ? body.data : { data: body.data };
    const data = payload.data;
    if (!data || typeof data !== 'object') fail('备份数据格式不正确', 400);

    const needFiles = scope === 'files' || scope === 'both';
    const needSettings = scope === 'settings' || scope === 'both';
    if (needFiles && !Array.isArray(data.bcd_files)) fail('备份数据里没有「文件」数据，请检查导入模式是否选对', 400);
    if (needSettings && !Array.isArray(data.bcd_settings)) fail('备份数据里没有「设置」数据，请检查导入模式是否选对', 400);

    const HOME_KEYS = ['site_name', 'home_desc', 'home_notice'];
    const tableCols = {
      bcd_settings: ['key', 'value', 'updated_at'],
      bcd_admins: ['id', 'username', 'password_hash', 'salt', 'display_name', 'role', 'status', 'created_by', 'created_at', 'last_login_at'],
      bcd_folders: ['id', 'path', 'name', 'parent', 'share_id', 'created_at'],
      bcd_files: ['id', 'share_id', 'name', 'folder', 'path', 'ext', 'size_bytes', 'size_text', 'description', 'password_hash', 'password_salt', 'download_count', 'created_at', 'updated_at'],
      bcd_links: ['id', 'file_id', 'kind', 'url', 'source', 'sort_order'],
      bcd_downloads: ['id', 'file_id', 'link_id', 'kind', 'ip', 'country', 'user_agent', 'created_at'],
      bcd_logs: ['id', 'actor', 'action', 'target', 'detail', 'ip', 'created_at'],
    };
    const tables = [];
    if (needFiles) tables.push('bcd_folders', 'bcd_files', 'bcd_links');
    if (needFiles && options.downloadCount) tables.push('bcd_downloads');
    if (needSettings) tables.push('bcd_settings');
    if (needSettings && options.accounts) tables.push('bcd_admins');

    const summary = {};
    const statements = [];
    if (mode === 'replace' && needFiles) {
      statements.push(db(env).prepare('DELETE FROM bcd_links'));
      statements.push(db(env).prepare('DELETE FROM bcd_files'));
      statements.push(db(env).prepare('DELETE FROM bcd_folders'));
      if (options.downloadCount) statements.push(db(env).prepare('DELETE FROM bcd_downloads'));
    }
    for (const table of tables) {
      const cols = tableCols[table];
      let rows = Array.isArray(data[table]) ? data[table] : [];
      if (table === 'bcd_settings') {
        rows = rows.filter((r) => r && r.key && r.key !== 'secret_key' && (options.homeContent || !HOME_KEYS.includes(r.key)));
      }
      let n = 0;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const useCols = cols.filter((c) => row[c] !== undefined && !(table === 'bcd_settings' && c === 'key'));
        if (!useCols.length) continue;
        const vals = useCols.map((c) => {
          if (table === 'bcd_files' && c === 'download_count' && !options.downloadCount) return 0;
          if (table === 'bcd_files' && c === 'description' && !options.fileDesc) return '';
          return row[c] === undefined ? null : row[c];
        });
        const verb = mode === 'merge' ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
        statements.push(db(env).prepare(`${verb} INTO ${table}(${useCols.join(',')}) VALUES(${useCols.map(() => '?').join(',')})`).bind(...vals));
        n++;
      }
      summary[table] = n;
    }
    for (let i = 0; i < statements.length; i += 60) {
      await db(env).batch(statements.slice(i, i + 60));
    }
    // 导入账号后保证当前登录会话仍然有效
    if (tables.includes('bcd_admins')) {
      const me = await db(env).prepare('SELECT id FROM bcd_admins WHERE username=?').bind(admin.username).first();
      if (me) await db(env).prepare('UPDATE bcd_sessions SET admin_id=? WHERE token=?').bind(Number(me.id), admin.token).run();
    }
    await logAction(env, admin, 'import', scope, `mode=${mode} ${JSON.stringify(options)} ${JSON.stringify(summary)}`, request);
    return ok({ scope, options, mode, summary });
  }

  /* ---------- 操作日志（仅总管理员） ---------- */
  if (path === '/api/admin/logs' && method === 'GET') {
    await requireTotal(request, env);
    const limit = Math.min(LOG_LIMIT, Math.max(1, parseInt(q.get('limit') || String(LOG_LIMIT), 10) || LOG_LIMIT));
    const res = await db(env).prepare('SELECT * FROM bcd_logs ORDER BY id DESC LIMIT ?').bind(limit).all();
    const total = Number((await db(env).prepare('SELECT COUNT(*) AS c FROM bcd_logs').first()).c);
    return ok({
      total,
      limit: LOG_LIMIT,
      logs: ((res && res.results) || []).map((r) => ({
        id: Number(r.id),
        actor: r.actor,
        action: r.action,
        target: r.target,
        detail: r.detail,
        ip: r.ip,
        createdAt: r.created_at,
      })),
    });
  }

  // 清空操作日志（清空后会写入一条“清空日志”记录）
  if (path === '/api/admin/logs' && method === 'DELETE') {
    const admin = await requireTotal(request, env);
    const before = Number((await db(env).prepare('SELECT COUNT(*) AS c FROM bcd_logs').first()).c);
    await db(env).prepare('DELETE FROM bcd_logs').run();
    await logAction(env, admin, 'clear_logs', '日志', `清空 ${before} 条操作日志`, request);
    return ok({ removed: before });
  }

  /* ---------- 健康检查 ---------- */
  if (path === '/api/health' && method === 'GET') {
    const s = await getSettings(env);
    return ok({ version: VERSION, db: true, initializedAt: s.initialized_at || '' });
  }

  return jsonError('接口不存在: ' + path, 404);
}

/* ============================ 业务辅助 ============================ */
async function recordDownload(env, file, link, request) {
  const s = await getSettings(env);
  if (s.count_download !== '1') return;
  try {
    await db(env).batch([
      db(env).prepare('UPDATE bcd_files SET download_count = download_count + 1 WHERE id=?').bind(file.id),
      db(env)
        .prepare('INSERT INTO bcd_downloads(file_id,link_id,kind,ip,country,user_agent,created_at) VALUES(?,?,?,?,?,?,?)')
        .bind(Number(file.id), Number(link.id), link.kind, clientIp(request), clientCountry(request), userAgent(request), nowBeijing()),
    ]);
  } catch (_) {
    /* 统计失败不影响下载 */
  }
}

/** 统一的文件载荷校验（新增 / 编辑共用） */
async function validateFilePayload(body, opts) {
  const fields = {};
  const isCreate = !!opts.isCreate;
  const current = opts.current || null;

  const nameV = validateName(body.name);
  if (nameV.error) fields.name = nameV.error;

  let folder = current ? current.folder : '/文件分享';
  if (body.folder !== undefined) {
    const fV = normalizePath(body.folder, '文件路径');
    if (fV.error) fields.folder = fV.error;
    else folder = fV.value;
  }

  const linksV = validateLinks(body.links);
  if (linksV.error) fields.links = linksV.error;

  const sizeV = validateSize(body.size);
  if (sizeV.error) fields.size = sizeV.error;

  let description = current ? current.description || '' : '';
  if (body.description !== undefined) {
    const d = String(body.description);
    if ([...d].length > 2000) fields.description = '文件简介不能超过 2000 个字符';
    else description = d.trim();
  }

  let passwordHash = current ? current.password_hash : null;
  let passwordSalt = current ? current.password_salt : null;
  const action = body.passwordAction || (body.password === undefined ? 'keep' : 'set');
  if (action === 'clear') {
    passwordHash = null;
    passwordSalt = null;
  } else if (action === 'set') {
    const pv = validatePassword(body.password);
    if (pv.error) fields.password = pv.error;
    else if (pv.value === null) {
      passwordHash = null;
      passwordSalt = null;
    } else {
      passwordSalt = randomToken(16);
      passwordHash = await hashPassword(pv.value, passwordSalt);
    }
  }

  if (Object.keys(fields).length) {
    return { error: { message: '提交内容有误，请检查后重试', fields } };
  }
  return {
    value: {
      name: nameV.value,
      folder,
      path: (folder === '/' ? '' : folder) + '/' + nameV.value,
      ext: fileExt(nameV.value),
      sizeBytes: sizeV.value.bytes,
      sizeText: sizeV.value.text,
      description,
      links: linksV.value,
      passwordHash,
      passwordSalt,
    },
  };
}

async function readJson(request, limit = 2 * 1024 * 1024) {
  const text = await request.text();
  if (text.length > limit) throw new ApiError('请求体过大', 413);
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('bad');
    return v;
  } catch (_) {
    throw new ApiError('请求数据格式不正确（需要 JSON）', 400);
  }
}

/* ============================ 入口 ============================ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isApi = path.startsWith('/api/');

    try {
      if (isApi) {
        return await handleApi(request, env, url);
      }

      // 页面路由
      if (path === '/' || path === '/index.html') return serveAsset(env, request, '/index.html');
      if (path === '/admin' || path === '/admin/') return serveAsset(env, request, '/admin.html');
      if (path === '/files' || path === '/files/') return serveAsset(env, request, '/files.html');
      if (/^\/s\/[A-Za-z0-9_-]+\/?$/.test(path) || /^\/sf\/[A-Za-z0-9_-]+\/?$/.test(path)) {
        return serveAsset(env, request, '/share.html');
      }

      // 其它静态资源
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        const res = await env.ASSETS.fetch(request);
        if (res.status !== 404) return res;
        return serveAsset(env, request, '/404.html', 404);
      }
      return new Response('资源未找到', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      const message = e && e.message ? e.message : '服务器内部错误';
      if (isApi) return jsonError(message, status, e instanceof ApiError ? e.fields : null);
      return new Response(`服务器内部错误：${message}`, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

async function serveAsset(env, request, assetPath, status = 200) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response('未找到静态资源绑定 ASSETS，请检查部署配置', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const url = new URL(request.url);
  url.pathname = assetPath;
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }));
  if (status === 200 && res.status === 404) {
    return new Response('页面不存在', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const headers = new Headers(res.headers);
  headers.set('content-type', assetPath.endsWith('.html') ? 'text/html; charset=utf-8' : headers.get('content-type') || 'application/octet-stream');
  headers.set('cache-control', 'no-cache');
  return new Response(res.body, { status, headers });
}
