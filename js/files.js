/* ==========================================================================
   所有文件浏览界面 —— 依赖 common.js / fileform.js
   ========================================================================== */
(function () {
  'use strict';
  const BCD = window.BCD;
  const esc = BCD.escapeHtml;

  const el = {
    breadcrumb: document.querySelector('#breadcrumb'),
    content: document.querySelector('#content'),
    btnUp: document.querySelector('#btnUp'),
    btnRefresh: document.querySelector('#btnRefresh'),
    searchInput: document.querySelector('#searchInput'),
    searchBox: document.querySelector('#searchBox'),
    sortSelect: document.querySelector('#sortSelect'),
    btnView: document.querySelector('#btnView'),
    btnNewFolder: document.querySelector('#btnNewFolder'),
    countInfo: document.querySelector('#countInfo'),
    badge: document.querySelector('#visitorBadge'),
    sub: document.querySelector('#pageSub'),
  };

  const state = {
    path: '/',
    search: '',
    sort: 'name',
    order: 'asc',
    view: localStorage.getItem('bcd-view') || 'grid',
  };
  let site = null;
  let data = null;
  const fileMap = {};

  /* ------------------------------ 数据 ------------------------------ */
  async function load() {
    const q = new URLSearchParams();
    q.set('path', state.path);
    if (state.search) q.set('search', state.search);
    q.set('sort', state.sort);
    q.set('order', state.order);
    try {
      data = await BCD.api('/api/files/list?' + q.toString());
    } catch (e) {
      renderError(e);
      return;
    }
    state.path = data.path;
    render();
  }

  function navigate(path) {
    state.search = '';
    state.path = path;
    if (el.searchInput) el.searchInput.value = '';
    load();
  }

  /* ------------------------------ 渲染 ------------------------------ */
  function renderError(e) {
    el.badge.textContent = '无法访问';
    el.countInfo.textContent = '';
    el.breadcrumb.innerHTML = '';
    el.content.innerHTML = `<div class="card"><div class="empty">
        <img src="/img/icon/simple.svg" alt="">
        <div>${esc(e.message || '加载失败')}</div>
        <div class="mt16"><a class="btn" href="/">返回主页</a></div>
      </div></div>`;
  }

  function render() {
    // 面包屑
    el.breadcrumb.innerHTML = (data.breadcrumb || [])
      .map((c, i, arr) => {
        const last = i === arr.length - 1;
        return `<span class="crumb ${last ? 'current' : ''}" data-path="${esc(c.path)}">${esc(c.name)}</span>${last ? '' : '<span class="sep">/</span>'}`;
      })
      .join('');
    el.breadcrumb.querySelectorAll('.crumb').forEach((c) => {
      c.addEventListener('click', () => navigate(c.dataset.path));
    });

    el.btnUp.disabled = !data.parent;
    el.searchBox.style.display = data.allowSearch ? '' : 'none';
    el.btnNewFolder.style.display = site.isAdmin ? '' : 'none';
    el.badge.textContent = site.isAdmin ? '管理员模式 · 可编辑 / 删除' : '访客模式 · 仅可浏览下载';
    el.badge.className = 'badge ' + (site.isAdmin ? 'primary' : '');
    el.sub.textContent = site.isAdmin ? '右键文件或文件夹进行编辑、删除、获取分享链接等操作' : '右键文件可下载 / 复制分享链接';
    el.btnView.textContent = state.view === 'grid' ? '列表视图' : '图标视图';

    const folders = data.folders || [];
    const files = data.files || [];
    el.countInfo.textContent = data.search
      ? `搜索「${data.search}」共 ${files.length} 个文件 / ${folders.length} 个文件夹`
      : `${folders.length} 个文件夹 · ${files.length} 个文件`;

    Object.keys(fileMap).forEach((k) => delete fileMap[k]);
    files.forEach((f) => (fileMap[f.shareId] = f));

    if (!folders.length && !files.length) {
      el.content.innerHTML = `<div class="card"><div class="empty">
          <img src="/img/icon/folder.svg" alt="">
          <div>${data.search ? '没有找到匹配的文件' : '这个位置还没有文件'}</div>
        </div></div>`;
      return;
    }

    if (state.view === 'list') {
      el.content.innerHTML = `<div class="file-list">
        ${folders.map(folderRow).join('')}
        ${files.map(fileRow).join('')}
      </div>`;
    } else {
      el.content.innerHTML = `<div class="file-grid">
        ${folders.map(folderTile).join('')}
        ${files.map(fileTile).join('')}
      </div>`;
    }
    bindItems();
  }

  function folderTile(f) {
    return `<div class="file-tile" data-kind="folder" data-share="${esc(f.shareId)}" title="${esc(f.path)}">
      <img src="/img/icon/folder.svg" alt="">
      <div class="ft-name">${esc(f.name)}</div>
      <div class="ft-meta"><span>文件夹</span></div>
    </div>`;
  }

  function fileTile(f) {
    const badges = [];
    if (f.hasPassword) badges.push('<span class="badge warn">🔒</span>');
    if (f.linkCount > 1) badges.push(`<span class="badge">${f.linkCount} 个地址</span>`);
    return `<div class="file-tile" data-kind="file" data-share="${esc(f.shareId)}" title="${esc(f.path)}">
      <div class="ft-badges">${badges.join('')}</div>
      <img src="${BCD.iconFor(f.name)}" alt="">
      <div class="ft-name">${esc(f.name)}</div>
      <div class="ft-meta">
        <span>${esc(f.sizeText)}</span>
        ${data.countDownload ? `<span>· ${f.downloadCount} 次下载</span>` : ''}
      </div>
    </div>`;
  }

  function folderRow(f) {
    return `<div class="file-row" data-kind="folder" data-share="${esc(f.shareId)}" title="${esc(f.path)}">
      <img src="/img/icon/folder.svg" alt="">
      <div class="fr-main">
        <div class="fr-name">${esc(f.name)}</div>
        <div class="fr-sub"><span>文件夹</span><span>${esc(f.createdAt || '')}</span></div>
      </div>
    </div>`;
  }

  function fileRow(f) {
    return `<div class="file-row" data-kind="file" data-share="${esc(f.shareId)}" title="${esc(f.path)}">
      <img src="${BCD.iconFor(f.name)}" alt="">
      <div class="fr-main">
        <div class="fr-name">${esc(f.name)} ${f.hasPassword ? '<span class="badge warn">密码</span>' : ''}</div>
        <div class="fr-sub">
          <span>${esc(f.sizeText)}</span>
          <span>${esc(f.createdAt || '')}</span>
          ${data.countDownload ? `<span>${f.downloadCount} 次下载</span>` : ''}
          <span>${f.linkCount} 个地址</span>
        </div>
      </div>
    </div>`;
  }

  function bindItems() {
    el.content.querySelectorAll('[data-kind]').forEach((node) => {
      const kind = node.dataset.kind;
      const shareId = node.dataset.share;
      const item = kind === 'folder' ? (data.folders || []).find((x) => x.shareId === shareId) : fileMap[shareId];
      if (!item) return;

      node.addEventListener('click', () => {
        if (kind === 'folder') navigate(item.path);
        else location.href = '/s/' + item.shareId;
      });
      node.addEventListener('contextmenu', (ev) => {
        BCD.contextMenu(ev, kind === 'folder' ? folderMenu(item) : fileMenu(item));
      });
    });
  }

  /* ------------------------------ 右键菜单 ------------------------------ */
  function folderMenu(f) {
    const items = [{ label: '打开', onClick: () => navigate(f.path) }];
    items.push({ sep: true });
    items.push({ label: '复制文件夹分享链接', onClick: () => BCD.copyText(BCD.shareUrl('sf', f.shareId), '文件夹分享链接已复制') });
    items.push({ label: '复制文件夹路径', onClick: () => BCD.copyText(f.path, '路径已复制') });
    if (site.isAdmin) {
      items.push({ sep: true });
      items.push({
        label: '在此新建子文件夹',
        onClick: () => newFolder((f.path === '/' ? '' : f.path) + '/'),
      });
      items.push({
        label: '删除文件夹',
        danger: true,
        onClick: async () => {
          const ok = await BCD.confirmDlg('删除文件夹', `确定删除文件夹「${f.name}」吗？\n只有空文件夹可以删除。`, { danger: true, okText: '删除' });
          if (!ok) return;
          try {
            await BCD.api('/api/admin/folders/' + encodeURIComponent(f.shareId), { method: 'DELETE' });
            BCD.toastOk('已删除');
            load();
          } catch (e) {
            BCD.toastErr(e.message);
          }
        },
      });
    }
    return items;
  }

  function fileMenu(f) {
    return [
      { label: '打开分享页', onClick: () => (location.href = '/s/' + f.shareId) },
      { label: '下载文件', onClick: () => BCD.download(f) },
      { label: '复制分享链接', onClick: () => BCD.copyText(BCD.shareUrl('s', f.shareId), '分享链接已复制') },
      { label: '复制文件路径', onClick: () => BCD.copyText(f.path, '路径已复制') },
      { sep: true },
      {
        label: '查看下载地址',
        onClick: async () => {
          try {
            const r = await BCD.getFileLinks(f);
            if (!r) return;
            BCD.modal({
              title: '下载地址（' + f.name + '）',
              body: (r.links || [])
                .map(
                  (l, i) => `<div class="link-item"><div class="li-main"><div>${i + 1}. ${l.kind === 'external' ? '站外分享' + (l.source ? ' · ' + esc(l.source) : '') : '直链'}</div>
                  <div class="li-url">${esc(l.url)}</div></div>
                  <button class="btn sm" data-copy="${esc(l.url)}">复制</button></div>`
                )
                .join('') || '<div class="muted">没有地址</div>',
              onMount: ({ body }) => {
                body.querySelectorAll('[data-copy]').forEach((b) =>
                  b.addEventListener('click', () => BCD.copyText(b.dataset.copy, '地址已复制'))
                );
              },
              buttons: [{ text: '关闭' }],
            });
          } catch (e) {
            BCD.toastErr(e.message);
          }
        },
      },
      site.isAdmin ? { sep: true } : null,
      site.isAdmin
        ? { label: '编辑文件设定', onClick: () => BCD.fileForm({ mode: 'edit', shareId: f.shareId, onSaved: load }) }
        : null,
      site.isAdmin
        ? {
            label: '移动到…',
            onClick: async () => {
              const target = await BCD.promptDlg('移动文件', {
                label: '目标文件夹路径',
                value: f.folder,
                hint: '例如 /文件分享/电影；不存在的文件夹会自动创建',
                okText: '移动',
              });
              if (target === null) return;
              try {
                await BCD.api('/api/admin/files/' + encodeURIComponent(f.shareId) + '/move', { method: 'POST', body: { folder: target } });
                BCD.toastOk('已移动');
                load();
              } catch (e) {
                BCD.toastErr(e.message);
              }
            },
          }
        : null,
      site.isAdmin
        ? {
            label: '删除文件',
            danger: true,
            onClick: async () => {
              const ok = await BCD.confirmDlg('删除文件', `确定删除「${f.name}」吗？该文件的分享链接将立即失效。`, { danger: true, okText: '删除' });
              if (!ok) return;
              try {
                await BCD.api('/api/admin/files/' + encodeURIComponent(f.shareId), { method: 'DELETE' });
                BCD.toastOk('已删除');
                load();
              } catch (e) {
                BCD.toastErr(e.message);
              }
            },
          }
        : null,
    ].filter(Boolean);
  }

  /* ------------------------------ 新建文件夹 ------------------------------ */
  async function newFolder(defaultPath) {
    const p = await BCD.promptDlg('新建文件夹', {
      label: '文件夹路径',
      value: defaultPath || state.path + (state.path === '/' ? '' : '/'),
      hint: '例如 /文件分享/电影；多级路径会自动创建',
      okText: '创建',
    });
    if (p === null || p === '') return;
    try {
      await BCD.api('/api/admin/folders', { method: 'POST', body: { path: p } });
      BCD.toastOk('文件夹已创建');
      load();
    } catch (e) {
      BCD.toastErr(e.message);
    }
  }

  /* ------------------------------ 事件 ------------------------------ */
  el.btnUp.addEventListener('click', () => {
    if (data && data.parent) navigate(data.parent);
  });
  el.btnRefresh.addEventListener('click', () => load());
  el.btnView.addEventListener('click', () => {
    state.view = state.view === 'grid' ? 'list' : 'grid';
    localStorage.setItem('bcd-view', state.view);
    render();
  });
  el.btnNewFolder.addEventListener('click', () => newFolder());
  el.sortSelect.addEventListener('change', () => {
    const [sort, order] = el.sortSelect.value.split(':');
    state.sort = sort;
    state.order = order;
    load();
  });
  let searchTimer = null;
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.search = el.searchInput.value.trim();
      load();
    }
  });
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = el.searchInput.value.trim();
      if (v !== state.search && (v === '' || v.length >= 1)) {
        state.search = v;
        load();
      }
    }, 450);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') return;
    if (e.key === 'Backspace' && document.activeElement !== el.searchInput && data && data.parent) navigate(data.parent);
  });
  el.content.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[data-kind]')) return;
    BCD.contextMenu(e, [
      { label: '刷新', onClick: () => load() },
      { label: '回到根目录', onClick: () => navigate(data ? data.root : '/') },
      site.isAdmin ? { sep: true } : null,
      site.isAdmin ? { label: '新建文件夹', onClick: () => newFolder() } : null,
    ].filter(Boolean));
  });

  /* ------------------------------ 启动 ------------------------------ */
  (async function init() {
    site = await BCD.boot({ active: 'files', title: '所有文件' });
    state.path = site.isAdmin ? '/' : site.guestRoot || '/文件分享';
    el.sortSelect.value = state.sort + ':' + state.order;
    el.searchInput.value = state.search;
    if (!site.guestBrowse && !site.isAdmin) {
      renderError(new Error('管理员尚未开放文件浏览功能'));
      return;
    }
    await load();
  })();
})();
