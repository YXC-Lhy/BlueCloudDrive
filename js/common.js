/* ==========================================================================
   蓝云网盘 BCD —— 前端公共库（主题 / 请求 / 弹窗 / 右键菜单 / 图标 / 下载）
   ========================================================================== */
(function () {
  'use strict';

  const BCD = (window.BCD = {});

  /* ------------------------------ 主题 ------------------------------ */
  const THEME_KEY = 'bcd-theme';
  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  BCD.getTheme = function () {
    return localStorage.getItem(THEME_KEY) || 'system';
  };
  BCD.applyTheme = function (t) {
    const dark = t === 'dark' || (t === 'system' && mql && mql.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('.theme-switch button').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === t);
    });
  };
  BCD.setTheme = function (t) {
    localStorage.setItem(THEME_KEY, t);
    BCD.applyTheme(t);
  };
  if (mql && mql.addEventListener) mql.addEventListener('change', () => BCD.applyTheme(BCD.getTheme()));

  BCD.themeSwitchHtml = function () {
    const cur = BCD.getTheme();
    const opt = (v, label) => `<button data-theme="${v}" class="${cur === v ? 'active' : ''}">${label}</button>`;
    return `<div class="theme-switch" id="themeSwitch">${opt('light', '明亮')}${opt('dark', '暗黑')}${opt('system', '系统')}</div>`;
  };
  BCD.bindThemeSwitch = function (root) {
    (root || document).querySelectorAll('.theme-switch button').forEach((b) => {
      b.addEventListener('click', () => BCD.setTheme(b.dataset.theme));
    });
    BCD.applyTheme(BCD.getTheme());
  };

  /* ------------------------------ 小工具 ------------------------------ */
  BCD.escapeHtml = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  };

  BCD.formatBytes = function (bytes) {
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
    return `${i === 0 ? v : v.toFixed(2).replace(/\.?0+$/, '')} ${units[i]}`;
  };

  BCD.relativeTime = function (text) {
    if (!text) return '';
    const t = Date.parse(String(text).replace(' ', 'T') + ':00+08:00');
    if (!t) return text;
    const diff = Date.now() - t;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 30) return Math.floor(diff / 86400000) + ' 天前';
    return text;
  };

  /* ------------------------------ 文件图标 ------------------------------ */
  const EXT_ICON = {
    jpg: 'jpg', jpeg: 'jpg', png: 'png', svg: 'svg',
    gif: 'image', webp: 'image', bmp: 'image', ico: 'image', tif: 'image', tiff: 'image', avif: 'image', heic: 'image',
    pdf: 'pdf',
    txt: 'txt', md: 'txt', log: 'txt', ini: 'txt', conf: 'txt', cfg: 'txt', nfo: 'txt',
    zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip', bz2: 'zip', xz: 'zip',
    exe: 'exe', msi: 'exe', dmg: 'exe', deb: 'exe', rpm: 'exe', appx: 'exe',
    apk: 'apk', ipa: 'apk', xapk: 'apk',
    mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video', flv: 'video', webm: 'video', m4v: 'video', rmvb: 'video', ts: 'video', mpg: 'video', mpeg: 'video', '3gp': 'video',
    mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio', ogg: 'audio', wma: 'audio', ape: 'audio', opus: 'audio',
    doc: 'word', docx: 'word', rtf: 'word', odt: 'word', wps: 'word',
    xls: 'excel', xlsx: 'excel', csv: 'excel', ods: 'excel', et: 'excel',
    ppt: 'ppt', pptx: 'ppt', odp: 'ppt', dps: 'ppt',
    js: 'code', mjs: 'code', cjs: 'code', ts: 'code', json: 'code', html: 'code', htm: 'code', css: 'code', scss: 'code',
    xml: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', cs: 'code', go: 'code', rs: 'code', php: 'code',
    rb: 'code', swift: 'code', kt: 'code', sh: 'code', bat: 'code', ps1: 'code', yml: 'code', yaml: 'code', toml: 'code', sql: 'code', vue: 'code', jsx: 'code', tsx: 'code',
    iso: 'iso', img: 'iso', bin: 'iso', vhd: 'iso', vmdk: 'iso', cue: 'iso',
  };

  BCD.extOf = function (name) {
    const i = String(name).lastIndexOf('.');
    if (i <= 0 || i === name.length - 1) return '';
    return name.slice(i + 1).toLowerCase();
  };

  BCD.iconFor = function (name, isFolder) {
    if (isFolder) return '/img/icon/folder.svg';
    const key = EXT_ICON[BCD.extOf(name)];
    return `/img/icon/${key || 'simple'}.svg`;
  };

  /* ------------------------------ 请求 ------------------------------ */
  BCD.api = async function (path, opts) {
    const o = opts || {};
    const init = { method: o.method || 'GET', credentials: 'same-origin', headers: {} };
    if (o.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
    const res = await fetch(path, init);
    if (o.raw) return res;
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok || !payload || payload.ok === false) {
      const err = new Error((payload && payload.error && payload.error.message) || `请求失败（HTTP ${res.status}）`);
      err.status = res.status;
      err.fields = (payload && payload.error && payload.error.fields) || {};
      throw err;
    }
    return payload.data;
  };

  /* ------------------------------ Toast ------------------------------ */
  function toastWrap() {
    let w = document.querySelector('.toast-wrap');
    if (!w) {
      w = document.createElement('div');
      w.className = 'toast-wrap';
      document.body.appendChild(w);
    }
    return w;
  }
  BCD.toast = function (msg, type) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    toastWrap().appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 260);
    }, type === 'err' ? 3600 : 2200);
  };
  BCD.toastOk = (m) => BCD.toast(m, 'ok');
  BCD.toastErr = (m) => BCD.toast(m, 'err');

  /* ------------------------------ 弹窗 ------------------------------ */
  BCD.modal = function (opts) {
    const o = opts || {};
    const mask = document.createElement('div');
    mask.className = 'mask';
    const buttons = (o.buttons || []).slice();
    mask.innerHTML = `
      <div class="modal ${o.wide ? 'wide' : ''}" role="dialog">
        <div class="modal-head"><h3>${BCD.escapeHtml(o.title || '')}</h3>
          <button class="btn ghost icon" data-close title="关闭">✕</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>`;
    const bodyEl = mask.querySelector('.modal-body');
    const footEl = mask.querySelector('.modal-foot');
    if (typeof o.body === 'string') bodyEl.innerHTML = o.body;
    else if (o.body) bodyEl.appendChild(o.body);

    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      mask.remove();
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask && o.maskClose !== false) close(null);
    });
    mask.querySelector('[data-close]').addEventListener('click', () => close(null));
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.type || '');
      if (b.left) btn.classList.add('left');
      btn.textContent = b.text;
      btn.addEventListener('click', async () => {
        if (b.onClick) {
          btn.disabled = true;
          try {
            await b.onClick({ close, body: bodyEl });
          } finally {
            btn.disabled = false;
          }
        } else close(null);
      });
      footEl.appendChild(btn);
    });
    document.body.appendChild(mask);
    if (o.onMount) o.onMount({ body: bodyEl, foot: footEl, close });
    const first = bodyEl.querySelector('input:not([type=hidden]), textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, body: bodyEl, foot: footEl, el: mask };
  };

  /**
   * 二次确认。返回值由 `close(result)` 透传给 onClose，
   * 避免「先 close 再 resolve」被 onClose 提前覆盖（历史 bug）。
   */
  BCD.confirmDlg = function (title, message, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      BCD.modal({
        title,
        body: `<div style="line-height:1.7">${BCD.escapeHtml(message).replace(/\n/g, '<br>')}</div>`,
        buttons: [
          { text: o.cancelText || '取消', onClick: ({ close }) => close(false) },
          {
            text: o.okText || '确定',
            type: o.danger ? 'danger' : 'primary',
            onClick: ({ close }) => close(true),
          },
        ],
        onClose: (result) => resolve(result === true),
      });
    });
  };

  /** 单行输入弹窗：确定返回字符串，取消 / 关闭返回 null */
  BCD.promptDlg = function (title, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      BCD.modal({
        title,
        body: `<div class="form-row" style="max-width:none;margin-bottom:0">
            ${o.label ? `<label>${BCD.escapeHtml(o.label)}</label>` : ''}
            <input class="input" id="promptInput" value="${BCD.escapeHtml(o.value || '')}" placeholder="${BCD.escapeHtml(o.placeholder || '')}">
            ${o.hint ? `<div class="hint">${BCD.escapeHtml(o.hint)}</div>` : ''}
          </div>`,
        onMount: ({ body }) => {
          const input = body.querySelector('#promptInput');
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const btn = body.parentElement.querySelector('.modal-foot .btn.primary');
              if (btn) btn.click();
            }
          });
        },
        buttons: [
          { text: '取消', onClick: ({ close }) => close(null) },
          {
            text: o.okText || '确定',
            type: 'primary',
            onClick: ({ close, body }) => close(body.querySelector('#promptInput').value),
          },
        ],
        onClose: (result) => resolve(result === undefined ? null : result),
      });
    });
  };

  /* ------------------------------ 右键菜单 ------------------------------ */
  let ctxEl = null;
  BCD.closeContextMenu = function () {
    if (ctxEl) {
      ctxEl.remove();
      ctxEl = null;
    }
  };
  BCD.contextMenu = function (event, items) {
    BCD.closeContextMenu();
    const entries = (items || []).filter(Boolean);
    if (!entries.length) return;
    const el = document.createElement('div');
    el.className = 'ctx-menu';
    entries.forEach((it) => {
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'ctx-sep';
        el.appendChild(s);
        return;
      }
      const d = document.createElement('div');
      d.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
      d.innerHTML = `<span>${BCD.escapeHtml(it.label)}</span>${it.shortcut ? `<span class="k">${BCD.escapeHtml(it.shortcut)}</span>` : ''}`;
      d.addEventListener('click', () => {
        BCD.closeContextMenu();
        if (!it.disabled && it.onClick) it.onClick();
      });
      el.appendChild(d);
    });
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    let x = event.clientX;
    let y = event.clientY;
    if (x + rect.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - rect.width - 8);
    if (y + rect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - rect.height - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    ctxEl = el;
    event.preventDefault();
    return el;
  };
  document.addEventListener('click', BCD.closeContextMenu);
  document.addEventListener('scroll', BCD.closeContextMenu, true);
  window.addEventListener('resize', BCD.closeContextMenu);
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.file-tile, .file-row, .ctx-menu')) BCD.closeContextMenu();
  });

  /* ------------------------------ 顶栏 ------------------------------ */
  /**
   * 分享链接：站点域名不落库也不设置，跳转一律使用相对路径，
   * 需要复制 / 展示时自动读取当前访问的域名。
   */
  BCD.sharePath = function (kind, id) {
    return `/${kind}/${id}`;
  };
  BCD.shareUrl = function (kind, id) {
    return location.origin + BCD.sharePath(kind, id);
  };

  BCD.renderTopbar = function (opts) {
    const o = opts || {};
    const host = document.querySelector('#topbar');
    if (!host) return;
    const site = BCD.site || {};
    const admin = !!site.isAdmin;
    const siteName = site.siteName || '蓝云网盘';
    document.title = (o.title ? o.title + ' · ' : '') + siteName;

    // 分享页等场景：只保留站点名称与主题切换
    if (o.minimal) {
      host.innerHTML = `
        <a class="brand" href="/"><img src="/img/logo.svg" alt="logo"><span>${BCD.escapeHtml(siteName)}</span></a>
        <div class="spacer"></div>
        ${BCD.themeSwitchHtml()}`;
      BCD.bindThemeSwitch(host);
      return;
    }

    const links = [`<a class="navlink ${o.active === 'home' ? 'active' : ''}" href="/">主页</a>`];
    // 关闭「对访客开放文件浏览」后，访客不再看到任何入口
    if (admin || site.guestBrowse !== false) {
      links.push(`<a class="navlink ${o.active === 'files' ? 'active' : ''}" href="/files">所有文件</a>`);
    }
    links.push(
      admin
        ? `<a class="navlink ${o.active === 'admin' ? 'active' : ''}" href="/admin">管理后台</a>`
        : `<a class="navlink ${o.active === 'admin' ? 'active' : ''}" href="/admin">登录</a>`
    );
    host.innerHTML = `
      <a class="brand" href="/"><img src="/img/logo.svg" alt="logo"><span>${BCD.escapeHtml(siteName)}</span></a>
      <div class="spacer"></div>
      <div class="nav-links">${links.join('')}</div>
      ${BCD.themeSwitchHtml()}`;
    BCD.bindThemeSwitch(host);
    BCD.applyGuestVisibility();
  };

  /** 访客不可浏览时隐藏带有 data-require-browse 的入口 */
  BCD.applyGuestVisibility = function () {
    const site = BCD.site || {};
    const hide = !site.isAdmin && site.guestBrowse === false;
    document.querySelectorAll('[data-require-browse]').forEach((el) => el.classList.toggle('hidden', hide));
  };

  /** 页面启动：加载站点信息 + 渲染顶栏 */
  BCD.boot = async function (opts) {
    const o = opts || {};
    try {
      BCD.site = await BCD.api('/api/site');
    } catch (e) {
      BCD.site = { siteName: '蓝云网盘', version: '1.0.1', guestBrowse: true, allowSearch: true, isAdmin: false, homeDesc: '', homeNotice: '' };
    }
    BCD.renderTopbar(o);
    BCD.applyGuestVisibility();
    return BCD.site;
  };

  /* ------------------------------ 下载 ------------------------------ */
  const linkCache = {};

  function fieldErr(scope, name, msg) {
    const box = scope ? scope.querySelector(`[data-err="${name}"]`) : null;
    const input = scope ? scope.querySelector(`[name="${name}"]`) : null;
    if (box) {
      box.textContent = msg || '';
      box.classList.toggle('show', !!msg);
    }
    if (input) input.classList.toggle('invalid', !!msg);
  }
  BCD.fieldErr = fieldErr;

  BCD.applyFieldErrors = function (scope, fields) {
    Object.keys(fields || {}).forEach((k) => fieldErr(scope, k, fields[k]));
  };
  BCD.clearFieldErrors = function (scope) {
    (scope || document).querySelectorAll('.field-error').forEach((e) => {
      e.textContent = '';
      e.classList.remove('show');
    });
    (scope || document).querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  };

  /** 询问下载密码，成功后返回 { token, links } */
  BCD.getFileLinks = async function (file) {
    if (linkCache[file.shareId]) return linkCache[file.shareId];
    if (file.hasPassword) {
      const result = await new Promise((resolve) => {
        BCD.modal({
          title: '需要下载密码',
          body: `<div class="form-row" style="max-width:none;margin-bottom:0">
              <label>文件「${BCD.escapeHtml(file.name)}」已设置下载密码</label>
              <input class="input" id="pwInput" maxlength="10" placeholder="请输入下载密码" autocomplete="off">
              <div class="field-error" data-err="password"></div>
            </div>`,
          buttons: [
            { text: '取消', onClick: ({ close }) => close(null) },
            {
              text: '确定',
              type: 'primary',
              onClick: async ({ close, body }) => {
                const pw = body.querySelector('#pwInput').value;
                if (!pw) return fieldErr(body, 'password', '请输入下载密码');
                try {
                  const r = await BCD.api(`/api/share/file/${file.shareId}/unlock`, { method: 'POST', body: { password: pw } });
                  close(r);
                } catch (e) {
                  fieldErr(body, 'password', e.message);
                }
              },
            },
          ],
          onClose: (v) => resolve(v === undefined ? null : v),
        });
      });
      if (!result) return null;
      linkCache[file.shareId] = result;
      return result;
    }
    const r = await BCD.api(`/api/share/file/${file.shareId}/links`);
    linkCache[file.shareId] = r;
    return r;
  };

  /** 打开某个下载地址 */
  BCD.openLink = function (file, link, token) {
    if (link.kind === 'external') {
      if (token) BCD.api('/api/dl/count', { method: 'POST', body: { fileId: file.id, linkId: link.id, token } }).catch(() => {});
      window.open(link.url, '_blank', 'noopener');
    } else {
      const url = `/api/dl/${file.id}/${link.id}` + (token ? `?token=${encodeURIComponent(token)}` : '');
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = file.name || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  /** 下载入口：自动处理密码与多地址选择 */
  BCD.download = async function (file) {
    let r;
    try {
      r = await BCD.getFileLinks(file);
    } catch (e) {
      BCD.toastErr(e.message);
      return;
    }
    if (!r) return;
    const links = r.links || [];
    if (!links.length) {
      BCD.toastErr('该文件没有可用的下载地址');
      return;
    }
    if (links.length === 1) {
      BCD.openLink(file, links[0], r.token);
      return;
    }
    BCD.modal({
      title: '选择下载方式',
      body:
        `<div class="muted" style="margin-bottom:10px">该文件提供了 ${links.length} 个下载地址，请选择：</div>` +
        links
          .map((l, i) => {
            const kindText = l.kind === 'external' ? `站外分享${l.source ? ' · 来源：' + BCD.escapeHtml(l.source) : ''}` : '直链';
            let host = '';
            try {
              host = new URL(l.url).host;
            } catch (_) {}
            return `<div class="link-item">
                <div class="li-main">
                  <div>${i + 1}. ${kindText} ${l.kind === 'external' ? '<span class="badge">打开新标签页</span>' : '<span class="badge primary">直接下载</span>'}</div>
                  <div class="li-url">${BCD.escapeHtml(host ? host + ' · ' : '')}${BCD.escapeHtml(l.url)}</div>
                </div>
                <button class="btn sm primary" data-link="${l.id}">${l.kind === 'external' ? '打开' : '下载'}</button>
              </div>`;
          })
          .join(''),
      onMount: ({ body, close }) => {
        body.querySelectorAll('[data-link]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const link = links.find((x) => String(x.id) === btn.dataset.link);
            close();
            BCD.openLink(file, link, r.token);
          });
        });
      },
      buttons: [{ text: '关闭' }],
    });
  };

  BCD.copyText = async function (text, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      BCD.toastOk(okMsg || '已复制到剪贴板');
    } catch (_) {
      BCD.toastErr('复制失败，请手动复制：' + text);
    }
  };

  BCD.isGuestDenied = function (site) {
    return site && site.guestBrowse === false && !site.isAdmin;
  };
})();
