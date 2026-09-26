/* ==========================================================================
   分享页面
     /s/<分享编号>   单文件分享：直接展示全部信息与操作按钮
     /sf/<分享编号>  文件夹分享：文件列表 + 右侧下载按钮
   ========================================================================== */
(function () {
  'use strict';
  const BCD = window.BCD;
  const esc = BCD.escapeHtml;
  const root = document.querySelector('#shareRoot');
  const m = location.pathname.match(/^\/(s|sf)\/([A-Za-z0-9_-]+)/);

  function fail(msg) {
    root.innerHTML = `<div class="card"><div class="empty">
        <img src="/img/icon/simple.svg" alt="">
        <div>${esc(msg)}</div>
        <div class="mt16"><a class="btn" href="/">返回主页</a></div>
      </div></div>`;
  }

  function linkItem(l, i, file, token) {
    let host = '';
    try {
      host = new URL(l.url).host;
    } catch (_) {}
    const isExt = l.kind === 'external';
    return `<div class="link-item">
      <div class="li-main">
        <div>${i + 1}. ${isExt ? '站外分享链接' + (l.source ? ' · 来源：' + esc(l.source) : '') : '直链下载'}
          <span class="badge ${isExt ? 'warn' : 'primary'}">${isExt ? '新标签页打开' : '直接下载'}</span></div>
        <div class="li-url">${esc(host)}${host ? ' · ' : ''}${esc(l.url)}</div>
      </div>
      <button class="btn sm ${isExt ? '' : 'primary'}" data-open="${i}">${isExt ? '打开' : '下载'}</button>
      <button class="btn sm ghost" data-copy="${i}">复制</button>
    </div>`;
  }

  /* ------------------------------ 单文件分享 ------------------------------ */
  async function renderFile(shareId) {
    let info;
    try {
      info = await BCD.api('/api/share/file/' + encodeURIComponent(shareId));
    } catch (e) {
      return fail(e.message || '分享不存在或已失效');
    }
    const f = info.file;
    document.title = f.name + ' · ' + (info.siteName || '蓝云网盘');
    const showCount = info.countDownload;

    root.innerHTML = `<div class="card share-card">
      <div class="share-head">
        <img src="${BCD.iconFor(f.name)}" alt="">
        <div>
          <div class="sh-name">${esc(f.name)}</div>
          <div class="muted" style="font-size:12.5px;margin-top:4px">由 ${esc(info.siteName || '蓝云网盘')} 分享${f.hasPassword ? ' · <span class="badge warn">需要下载密码</span>' : ''}</div>
        </div>
      </div>

      <div class="share-meta">
        <div class="sm-item"><div class="sm-k">文件大小</div><div class="sm-v">${esc(f.sizeText)}</div></div>
        <div class="sm-item"><div class="sm-k">分享时间</div><div class="sm-v">${esc(f.createdAt)}</div></div>
        ${showCount ? `<div class="sm-item"><div class="sm-k">下载次数</div><div class="sm-v">${f.downloadCount}</div></div>` : ''}
        <div class="sm-item"><div class="sm-k">下载地址</div><div class="sm-v">${f.linkCount} 个</div></div>
        <div class="sm-item"><div class="sm-k">所在目录</div><div class="sm-v">${esc(f.folder)}</div></div>
        <div class="sm-item"><div class="sm-k">下载密码</div><div class="sm-v">${f.hasPassword ? '已设置' : '无'}</div></div>
      </div>

      <div id="linkArea"></div>
    </div>`;

    const area = root.querySelector('#linkArea');

    function paint(r) {
      const links = (r && r.links) || [];
      if (!links.length) {
        area.innerHTML = '<div class="muted">该分享暂无可用的下载地址。</div>';
        return;
      }
      area.innerHTML =
        `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
           <h3 style="font-size:14px">下载地址（${links.length}）</h3>
           <div style="flex:1"></div>
           <button class="btn sm primary" id="oneClick">${links.length > 1 ? '选择下载方式' : links[0].kind === 'external' ? '打开链接' : '立即下载'}</button>
           <button class="btn sm" id="copyShare">复制本页链接</button>
         </div>` +
        links.map((l, i) => linkItem(l, i, f, r.token)).join('');
      area.querySelectorAll('[data-open]').forEach((b) =>
        b.addEventListener('click', () => BCD.openLink(f, links[Number(b.dataset.open)], r.token))
      );
      area.querySelectorAll('[data-copy]').forEach((b) =>
        b.addEventListener('click', () => BCD.copyText(links[Number(b.dataset.copy)].url, '下载地址已复制'))
      );
      area.querySelector('#oneClick').addEventListener('click', () => {
        if (links.length === 1) BCD.openLink(f, links[0], r.token);
        else BCD.download(f);
      });
      area.querySelector('#copyShare').addEventListener('click', () => BCD.copyText(location.href, '本页链接已复制'));
    }

    if (f.hasPassword) {
      area.innerHTML = `<div class="pw-box">
          <div class="muted" style="margin-bottom:10px">请输入下载密码后查看下载地址</div>
          <input class="input" id="pw" maxlength="10" placeholder="下载密码" autocomplete="off" style="text-align:center">
          <div class="field-error" data-err="password" style="text-align:center"></div>
          <button class="btn primary mt16" id="unlock" style="width:100%">解锁下载地址</button>
        </div>`;
      const pwInput = area.querySelector('#pw');
      const unlock = async () => {
        BCD.fieldErr(area, 'password', '');
        const pw = pwInput.value;
        if (!pw) return BCD.fieldErr(area, 'password', '请输入下载密码');
        try {
          const r = await BCD.api(`/api/share/file/${encodeURIComponent(shareId)}/unlock`, { method: 'POST', body: { password: pw } });
          paint(r);
        } catch (e) {
          BCD.fieldErr(area, 'password', e.message);
        }
      };
      area.querySelector('#unlock').addEventListener('click', unlock);
      pwInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') unlock();
      });
      pwInput.focus();
    } else {
      try {
        const r = await BCD.api(`/api/share/file/${encodeURIComponent(shareId)}/links`);
        paint(r);
      } catch (e) {
        area.innerHTML = `<div class="muted">${esc(e.message)}</div>`;
      }
    }
  }

  /* ------------------------------ 文件夹分享 ------------------------------ */
  async function renderFolder(shareId, path) {
    const q = new URLSearchParams();
    if (path) q.set('path', path);
    let data;
    try {
      data = await BCD.api('/api/share/folder/' + encodeURIComponent(shareId) + (q.toString() ? '?' + q : ''));
    } catch (e) {
      return fail(e.message || '分享不存在或已失效');
    }
    document.title = data.folder.name + ' · 文件夹分享';
    const count = (data.folders || []).length + (data.files || []).length;

    root.innerHTML = `<div class="card">
      <div class="share-head" style="margin-bottom:14px">
        <img src="/img/icon/folder.svg" alt="">
        <div>
          <div class="sh-name">${esc(data.folder.name)}</div>
          <div class="muted" style="font-size:12.5px;margin-top:4px">文件夹分享 · 共 ${count} 项</div>
        </div>
      </div>
      <div class="toolbar">
        ${data.allowSearch ? '<div class="search-box"><input class="input" id="searchInput" placeholder="在此分享中搜索（回车）" autocomplete="off"></div>' : ''}
        <div style="flex:1"></div>
        <button class="btn sm" id="copyShare">复制本页链接</button>
      </div>
      <nav class="breadcrumb" id="breadcrumb"></nav>
      <div id="listArea"></div>
    </div>`;

    const listArea = root.querySelector('#listArea');

    function paintList(d) {
      const crumbs = (d.breadcrumb || [])
        .map((c, i, arr) => {
          const last = i === arr.length - 1;
          return `<span class="crumb ${last ? 'current' : ''}" data-path="${esc(c.path)}">${esc(c.name)}</span>${last ? '' : '<span class="sep">/</span>'}`;
        })
        .join('');
      root.querySelector('#breadcrumb').innerHTML = crumbs;
      root.querySelector('#breadcrumb')
        .querySelectorAll('.crumb')
        .forEach((c) =>
          c.addEventListener('click', () => {
            history.replaceState(null, '', `/sf/${shareId}?path=${encodeURIComponent(c.dataset.path)}`);
            load(c.dataset.path, '');
          })
        );

      const rows = [];
      (d.folders || []).forEach((f) => {
        rows.push(`<div class="file-row" data-folder="${esc(f.path)}">
            <img src="/img/icon/folder.svg" alt="">
            <div class="fr-main"><div class="fr-name">${esc(f.name)}</div><div class="fr-sub"><span>文件夹</span></div></div>
            <div class="fr-actions"><button class="btn sm" data-open-folder="${esc(f.path)}">打开</button></div>
          </div>`);
      });
      (d.files || []).forEach((f) => {
        rows.push(`<div class="file-row" data-file="${esc(f.shareId)}">
            <img src="${BCD.iconFor(f.name)}" alt="">
            <div class="fr-main">
              <div class="fr-name">${esc(f.name)} ${f.hasPassword ? '<span class="badge warn">密码</span>' : ''}</div>
              <div class="fr-sub">
                <span>${esc(f.sizeText)}</span>
                <span>${esc(f.createdAt)}</span>
                ${d.countDownload ? `<span>${f.downloadCount} 次下载</span>` : ''}
                <span>${f.linkCount} 个下载地址</span>
              </div>
            </div>
            <div class="fr-actions">
              <button class="btn sm" data-detail="${esc(f.shareId)}">详情</button>
              <button class="btn sm primary" data-download="${esc(f.shareId)}">下载</button>
            </div>
          </div>`);
      });

      listArea.innerHTML = rows.length
        ? `<div class="file-list">${rows.join('')}</div>`
        : `<div class="empty"><img src="/img/icon/folder.svg" alt=""><div>${d.search ? '没有找到匹配的文件' : '这个文件夹里还没有内容'}</div></div>`;

      const fileById = {};
      (d.files || []).forEach((f) => (fileById[f.shareId] = f));
      listArea.querySelectorAll('[data-open-folder]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const p = b.dataset.openFolder;
          history.replaceState(null, '', `/sf/${shareId}?path=${encodeURIComponent(p)}`);
          load(p, '');
        })
      );
      listArea.querySelectorAll('[data-download]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          BCD.download(fileById[b.dataset.download]);
        })
      );
      listArea.querySelectorAll('[data-detail]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          location.href = '/s/' + b.dataset.detail;
        })
      );
    }

    async function load(p, search) {
      const qs = new URLSearchParams();
      if (p) qs.set('path', p);
      if (search) qs.set('search', search);
      try {
        const d = await BCD.api('/api/share/folder/' + encodeURIComponent(shareId) + (qs.toString() ? '?' + qs : ''));
        paintList(d);
      } catch (e) {
        BCD.toastErr(e.message);
      }
    }

    paintList(data);
    root.querySelector('#copyShare').addEventListener('click', () => BCD.copyText(location.href, '本页链接已复制'));
    const si = root.querySelector('#searchInput');
    if (si) {
      si.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const v = si.value.trim();
          if (v) load(null, v);
          else load(data.path, '');
        }
      });
    }
  }

  /* ------------------------------ 启动 ------------------------------ */
  (async function () {
    await BCD.boot({ minimal: true, title: '文件分享' });
    if (!m) return fail('分享链接格式不正确');
    const shareId = m[2];
    if (m[1] === 's') renderFile(shareId);
    else renderFolder(shareId, new URLSearchParams(location.search).get('path'));
  })();
})();
