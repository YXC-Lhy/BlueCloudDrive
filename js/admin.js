/* ==========================================================================
   管理后台 —— 依赖 common.js / fileform.js
   ========================================================================== */
(function () {
  'use strict';
  const BCD = window.BCD;
  const esc = BCD.escapeHtml;
  const $ = (s) => document.querySelector(s);

  let site = null;
  let settings = null;
  const HOME_TEXT_DEFAULT = '主页内容建设中…… 你可以先前往「所有文件」浏览或下载已分享的文件。';
  const REPO_URL = 'https://github.com/YXC-Lhy/BlueCloudDrive';
  const fileState = { search: '', sort: 'time', order: 'desc', page: 1, pageSize: 60, total: 0, loaded: [] };
  const SECS = ['settings', 'account', 'files', 'backup'];

  const roleOf = () => (site && site.admin ? site.admin.role : 'guest');
  const isTotal = () => roleOf() === 'total';
  const isStaff = () => roleOf() === 'total' || roleOf() === 'sub';
  const isUserRole = () => roleOf() === 'user';
  const roleName = (r) => (r === 'total' ? '总管理员' : r === 'user' ? '用户' : '子管理员');

  /* ============================ 登录 / 面板 ============================ */
  function showLogin() {
    $('#viewPanel').classList.add('hidden');
    $('#viewLogin').classList.remove('hidden');
    $('#loginSiteName').textContent = (site && site.siteName) || '蓝云网盘';
    const u = $('#loginUser');
    if (u) u.focus();
  }

  function showPanel() {
    $('#viewLogin').classList.add('hidden');
    $('#viewPanel').classList.remove('hidden');
    const role = roleOf();
    $('#whoami').textContent = `${site.admin.displayName || site.admin.username}（${roleName(role)}）`;
    $('#meUsername').value = site.admin.username;
    $('#meDisplayName').value = site.admin.displayName || site.admin.username;
    $('#myRoleDesc').textContent =
      role === 'total'
        ? '当前为总管理员账号，拥有全部权限，可新建 / 禁用 / 删除子管理员与用户。'
        : role === 'sub'
        ? '当前为子管理员账号，可管理文件与全局设置，但不能管理账号、日志与导入导出。'
        : '当前为普通用户账号，只能浏览管理员指定的目录并下载文件，可在此修改自己的昵称与密码。';

    // 「用户」只有账号设置与所有文件
    document.querySelectorAll('.sidebar [data-staff]').forEach((el) => el.classList.toggle('hidden', role === 'user'));
    document.querySelectorAll('.sidebar [data-total]').forEach((el) => el.classList.toggle('hidden', role !== 'total'));
    $('#cardAccountList').classList.toggle('hidden', role !== 'total');
    $('#btnNewAdmin').style.display = role === 'total' ? '' : 'none';
    $('#btnNewUser').style.display = role === 'total' ? '' : 'none';

    const allowed = role === 'user' ? ['account'] : SECS;
    const hash = (location.hash || '').replace('#', '');
    switchSection(allowed.includes(hash) ? hash : allowed[0]);
  }

  async function doLogin() {
    BCD.clearFieldErrors($('#viewLogin'));
    const username = $('#loginUser').value.trim();
    const password = $('#loginPass').value;
    if (!username) return BCD.fieldErr($('#viewLogin'), 'username', '请输入用户名');
    if (!password) return BCD.fieldErr($('#viewLogin'), 'password', '请输入密码');
    try {
      await BCD.api('/api/auth/login', { method: 'POST', body: { username, password } });
      BCD.toastOk('登录成功');
      $('#loginPass').value = '';
      site = await BCD.api('/api/site');
      BCD.site = site;
      BCD.renderTopbar({ active: 'admin', title: '管理后台' });
      showPanel();
    } catch (e) {
      if (e.fields && Object.keys(e.fields).length) BCD.applyFieldErrors($('#viewLogin'), e.fields);
      BCD.toastErr(e.message);
    }
  }

  /* ============================ 菜单切换 ============================ */
  function switchSection(name) {
    if (!isStaff() && name !== 'account') name = 'account';
    if (!isTotal() && name === 'backup') name = 'settings';
    SECS.forEach((s) => $('#sec-' + s).classList.toggle('hidden', s !== name));
    document.querySelectorAll('.sidebar [data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
    history.replaceState(null, '', '#' + name);
    BCD.closeContextMenu();
    if (name === 'settings') loadSettings();
    if (name === 'account') loadAccount();
    if (name === 'files') loadFiles(true);
    if (name === 'backup') loadBackup();
    if (window.innerWidth < 720) $('#viewPanel').classList.add('collapsed');
  }

  /* ============================ 全局设置 ============================ */
  async function loadSettings() {
    try {
      settings = await BCD.api('/api/admin/settings');
    } catch (e) {
      return BCD.toastErr(e.message);
    }
    $('#setSiteName').value = settings.siteName || '蓝云网盘';
    $('#setHomeDesc').value = settings.homeDesc === undefined ? HOME_TEXT_DEFAULT : settings.homeDesc;
    $('#setHomeNotice').value = settings.homeNotice === undefined ? HOME_TEXT_DEFAULT : settings.homeNotice;
    $('#setGuestRoot').value = settings.guestRoot || '/文件分享';
    $('#setUserRoot').value = settings.userRoot || '/文件分享';
    $('#setGuestBrowse').checked = !!settings.guestBrowse;
    $('#setAllowSearch').checked = !!settings.allowSearch;
    $('#setCountDownload').checked = !!settings.countDownload;
    renderSysInfo();
  }

  function renderSysInfo() {
    const ver = (site && site.version) || (settings && settings.version) || '';
    const repo = (site && site.repoUrl) || REPO_URL;
    const rows = [
      ['程序版本', esc('BlueCloudDrive v' + ver)],
      ['数据存储', 'Cloudflare D1（表前缀 bcd_，首次启动自动建表）'],
      ['初始化时间（北京时间）', esc((settings && settings.initializedAt) || '—')],
      ['管理员账号数', esc(settings ? settings.adminCount : '—')],
      ['用户账号数', esc(settings ? settings.userCount : '—')],
      ['分享文件总数', esc(settings ? settings.fileCount : '—')],
      ['当前登录', `${esc(site.admin.username)}（${roleName(roleOf())}）`],
    ];
    $('#sysInfo').innerHTML =
      rows.map((r) => `<tr><th style="width:220px">${esc(r[0])}</th><td>${r[1]}</td></tr>`).join('') +
      `<tr><th>项目地址</th><td><a href="${esc(repo)}" target="_blank" rel="noopener noreferrer">${esc(repo)}</a></td></tr>
       <tr><th>版本更新</th><td>
         <button class="btn sm" id="btnCheckUpdate">检查更新</button>
         <span class="muted" id="updateHint" style="margin-left:8px">当前版本 v${esc(ver)}</span>
       </td></tr>`;
    $('#btnCheckUpdate').addEventListener('click', checkUpdate);
  }

  /** 检查 GitHub Release（只请求一次，失败不重试） */
  async function checkUpdate() {
    const btn = $('#btnCheckUpdate');
    if (!btn || btn.disabled) return;
    const hint = $('#updateHint');
    const origin = btn.textContent;
    btn.disabled = true;
    btn.textContent = '检查中…';
    if (hint) hint.textContent = '';
    try {
      const res = await fetch('https://api.github.com/repos/YXC-Lhy/BlueCloudDrive/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (res.status === 404) throw new Error('仓库暂时没有发布 Release');
      if (!res.ok) throw new Error('GitHub 返回 HTTP ' + res.status);
      const data = await res.json();
      const latest = String(data.tag_name || data.name || '').trim();
      const cur = (site && site.version) || '';
      if (!latest) throw new Error('返回数据中没有版本号');
      if (BCD.compareVersion(latest.replace(/^v/i, ''), cur) <= 0) {
        btn.textContent = '已是最新版本';
        btn.disabled = true; // 已是最新则不再允许点击
        if (hint) hint.textContent = '当前 v' + cur + '，已是最新版本';
        BCD.toastOk('当前已是最新版本 v' + cur);
        return;
      }
      btn.disabled = false;
      btn.textContent = origin;
      if (hint) hint.textContent = '发现新版本 ' + latest;
      BCD.modal({
        title: '发现新版本 ' + latest,
        wide: true,
        body: `<div class="form-row" style="max-width:none;margin-bottom:0">
            <div class="flex" style="justify-content:space-between">
              <span>当前版本：<b>v${esc(cur)}</b></span>
              <span>最新版本：<b style="color:var(--primary)">${esc(latest)}</b></span>
            </div>
            <div class="hint" style="margin-bottom:10px">发布时间：${esc(data.published_at ? new Date(data.published_at).toLocaleString('zh-CN') : '—')}</div>
            <div class="md-body" id="releaseBody"></div>
          </div>`,
        onMount: ({ body }) => {
          body.querySelector('#releaseBody').innerHTML = BCD.markdown(data.body || '（该版本没有填写更新说明）');
        },
        buttons: [
          { text: '稍后再说' },
          {
            text: '前往下载页',
            type: 'primary',
            onClick: ({ close }) => {
              window.open(data.html_url || REPO_URL + '/releases', '_blank', 'noopener');
              close(null);
            },
          },
        ],
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = origin;
      if (hint) hint.textContent = '检查失败，可稍后手动重试';
      BCD.toastErr('检查更新失败：' + e.message);
    }
  }

  async function saveSettings() {
    BCD.clearFieldErrors($('#sec-settings'));
    const payload = {
      siteName: $('#setSiteName').value.trim(),
      homeDesc: $('#setHomeDesc').value.trim(),
      homeNotice: $('#setHomeNotice').value,
      guestRoot: $('#setGuestRoot').value.trim(),
      userRoot: $('#setUserRoot').value.trim(),
      guestBrowse: $('#setGuestBrowse').checked,
      allowSearch: $('#setAllowSearch').checked,
      countDownload: $('#setCountDownload').checked,
    };
    const fe = {};
    if (!payload.siteName) fe.siteName = '站点名称不能为空';
    if (!payload.guestRoot) fe.guestRoot = '未登录访客根目录不能为空';
    if (!payload.userRoot) fe.userRoot = '用户根目录不能为空';
    if ([...payload.homeDesc].length > 200) fe.homeDesc = '主页简介不能超过 200 个字符';
    if ([...payload.homeNotice].length > 5000) fe.homeNotice = '公告内容不能超过 5000 个字符';
    if (Object.keys(fe).length) return BCD.applyFieldErrors($('#sec-settings'), fe);
    try {
      await BCD.api('/api/admin/settings', { method: 'PUT', body: payload });
      BCD.toastOk('设置已保存');
      site = await BCD.api('/api/site');
      BCD.site = site;
      BCD.renderTopbar({ active: 'admin', title: '管理后台' });
      loadSettings();
    } catch (e) {
      if (e.fields && Object.keys(e.fields).length) BCD.applyFieldErrors($('#sec-settings'), e.fields);
      BCD.toastErr(e.message);
    }
  }

  /* ============================ 账号设置 ============================ */
  async function loadAccount() {
    try {
      const r = await BCD.api('/api/admin/admins');
      renderAdmins(r.admins || []);
    } catch (e) {
      BCD.toastErr(e.message);
    }
  }

  function renderAdmins(list) {
    const canManage = isTotal();
    $('#adminRows').innerHTML = list
      .map((a) => {
        const me = a.username === site.admin.username;
        const actions = canManage
          ? `<button class="btn sm" data-act="pass" data-id="${a.id}" data-name="${esc(a.username)}">改密</button>
             ${a.role === 'total' ? '' : `<button class="btn sm" data-act="toggle" data-id="${a.id}" data-status="${a.status}">${a.status === 'active' ? '禁用' : '启用'}</button>`}
             ${me || a.role === 'total' ? '' : `<button class="btn sm danger" data-act="del" data-id="${a.id}" data-name="${esc(a.username)}" data-role="${a.role}">删除</button>`}`
          : '<span class="muted">—</span>';
        const roleBadge =
          a.role === 'total'
            ? '<span class="badge primary">总管理员</span>'
            : a.role === 'user'
            ? '<span class="badge warn">用户</span>'
            : '<span class="badge">子管理员</span>';
        return `<tr>
          <td>${esc(a.username)}${me ? ' <span class="badge primary">当前</span>' : ''}</td>
          <td>${esc(a.displayName)}</td>
          <td>${roleBadge}</td>
          <td>${a.status === 'active' ? '<span class="badge ok">正常</span>' : '<span class="badge danger">已禁用</span>'}</td>
          <td class="muted">${esc(a.createdAt || '—')}</td>
          <td class="muted">${esc(a.lastLoginAt || '—')}</td>
          <td><div class="actions">${actions}</div></td>
        </tr>`;
      })
      .join('');
    $('#adminRows')
      .querySelectorAll('[data-act]')
      .forEach((btn) => {
        btn.addEventListener('click', () => adminAction(btn.dataset.act, btn.dataset));
      });
  }

  async function adminAction(act, ds) {
    const id = ds.id;
    if (act === 'pass') {
      changePasswordDialog(ds);
    } else if (act === 'toggle') {
      const target = ds.status === 'active' ? 'disabled' : 'active';
      try {
        await BCD.api('/api/admin/admins/' + id, { method: 'PUT', body: { status: target } });
        BCD.toastOk(target === 'disabled' ? '已禁用该账号' : '已启用该账号');
        loadAccount();
      } catch (e) {
        BCD.toastErr(e.message);
      }
    } else if (act === 'del') {
      const label = ds.role === 'user' ? '删除用户' : '删除账号';
      const ok = await BCD.confirmDlg(label, `确定删除「${ds.name}」吗？该操作不可恢复。`, { danger: true, okText: '删除' });
      if (!ok) return;
      try {
        await BCD.api('/api/admin/admins/' + id, { method: 'DELETE' });
        BCD.toastOk('已删除');
        loadAccount();
      } catch (e) {
        BCD.toastErr(e.message);
      }
    }
  }

  /** 改密：必须验证当前登录账号的原密码（安全修复） */
  function changePasswordDialog(ds) {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="form-row"><label>账号</label>
        <input class="input" value="${esc(ds.name)}" disabled></div>
      <div class="form-row"><label>当前登录账号的密码 <span style="color:var(--danger)">*</span></label>
        <input class="input" name="currentPassword" type="password" autocomplete="current-password" placeholder="请输入你自己的登录密码以确认">
        <div class="hint">为防止会话被盗后直接改密，此处必须验证操作者本人的原密码</div>
        <div class="field-error" data-err="currentPassword"></div></div>
      <div class="form-row" style="margin-bottom:0"><label>新密码 <span style="color:var(--danger)">*</span></label>
        <input class="input" name="password" type="password" autocomplete="new-password" placeholder="至少 6 个字符">
        <div class="field-error" data-err="password"></div></div>`;
    BCD.modal({
      title: '修改密码',
      body,
      buttons: [
        { text: '取消', onClick: ({ close }) => close(null) },
        {
          text: '保存',
          type: 'primary',
          onClick: async ({ close }) => {
            BCD.clearFieldErrors(body);
            const currentPassword = body.querySelector('[name=currentPassword]').value;
            const password = body.querySelector('[name=password]').value;
            const fe = {};
            if (!currentPassword) fe.currentPassword = '请输入你当前登录账号的密码';
            if (!password) fe.password = '请输入新密码';
            else if (password.length < 6) fe.password = '密码至少 6 个字符';
            if (Object.keys(fe).length) return BCD.applyFieldErrors(body, fe);
            try {
              await BCD.api('/api/admin/admins/' + ds.id, { method: 'PUT', body: { password, currentPassword } });
              BCD.toastOk('密码已修改');
              close(null);
              loadAccount();
            } catch (e) {
              if (e.fields && Object.keys(e.fields).length) BCD.applyFieldErrors(body, e.fields);
              BCD.toastErr(e.message);
            }
          },
        },
      ],
    });
  }

  function newAccountDialog(role) {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="form-row"><label>用户名 <span style="color:var(--danger)">*</span></label>
        <input class="input" name="username" autocomplete="off" placeholder="3-32 位字母、数字、_ . -">
        <div class="field-error" data-err="username"></div></div>
      <div class="form-row"><label>昵称</label>
        <input class="input" name="displayName" autocomplete="off" placeholder="留空则同用户名">
        <div class="field-error" data-err="displayName"></div></div>
      <div class="form-row" style="margin-bottom:0"><label>密码 <span style="color:var(--danger)">*</span></label>
        <input class="input" name="password" autocomplete="new-password" placeholder="至少 6 个字符">
        <div class="field-error" data-err="password"></div></div>`;
    BCD.modal({
      title: role === 'user' ? '新建用户' : '新建子管理员',
      body,
      buttons: [
        { text: '取消', onClick: ({ close }) => close(null) },
        {
          text: '创建',
          type: 'primary',
          onClick: async ({ close }) => {
            BCD.clearFieldErrors(body);
            const payload = {
              username: body.querySelector('[name=username]').value.trim(),
              displayName: body.querySelector('[name=displayName]').value.trim(),
              password: body.querySelector('[name=password]').value,
              role,
            };
            const fe = {};
            if (!payload.username) fe.username = '请输入用户名';
            else if (!/^[A-Za-z0-9_.-]{3,32}$/.test(payload.username)) fe.username = '用户名只能包含字母、数字、_ . -，长度 3-32';
            if (!payload.password) fe.password = '请输入密码';
            else if (payload.password.length < 6) fe.password = '密码至少 6 个字符';
            if (Object.keys(fe).length) return BCD.applyFieldErrors(body, fe);
            try {
              await BCD.api('/api/admin/admins', { method: 'POST', body: payload });
              BCD.toastOk(role === 'user' ? '用户已创建' : '子管理员已创建');
              close(null);
              loadAccount();
            } catch (e) {
              if (e.fields && Object.keys(e.fields).length) BCD.applyFieldErrors(body, e.fields);
              BCD.toastErr(e.message);
            }
          },
        },
      ],
    });
  }

  async function saveMe() {
    BCD.clearFieldErrors($('#sec-account'));
    const displayName = $('#meDisplayName').value.trim();
    const oldPassword = $('#meOldPass').value;
    const newPassword = $('#meNewPass').value;
    const newPassword2 = $('#meNewPass2').value;
    const fe = {};
    if (newPassword && newPassword !== newPassword2) fe.newPassword2 = '两次输入的新密码不一致';
    if (newPassword && !oldPassword) fe.oldPassword = '修改密码需要填写原密码';
    if (Object.keys(fe).length) return BCD.applyFieldErrors($('#sec-account'), fe);
    try {
      const body = { displayName };
      if (newPassword) {
        body.oldPassword = oldPassword;
        body.newPassword = newPassword;
      }
      const r = await BCD.api('/api/auth/me', { method: 'PUT', body });
      BCD.toastOk('已保存');
      $('#meOldPass').value = $('#meNewPass').value = $('#meNewPass2').value = '';
      site.admin.displayName = r.displayName;
      $('#whoami').textContent = `${r.displayName}（${roleName(roleOf())}）`;
    } catch (e) {
      if (e.fields && Object.keys(e.fields).length) BCD.applyFieldErrors($('#sec-account'), e.fields);
      BCD.toastErr(e.message);
    }
  }

  /* ============================ 文件分享列表 ============================ */
  async function loadFiles(reset) {
    if (reset) {
      fileState.page = 1;
      fileState.loaded = [];
    }
    const q = new URLSearchParams();
    if (fileState.search) q.set('search', fileState.search);
    q.set('sort', fileState.sort);
    q.set('order', fileState.order);
    q.set('page', String(fileState.page));
    q.set('pageSize', String(fileState.pageSize));
    let r;
    try {
      r = await BCD.api('/api/admin/files?' + q.toString());
    } catch (e) {
      return BCD.toastErr(e.message);
    }
    fileState.total = r.total;
    fileState.loaded = reset ? r.files : fileState.loaded.concat(r.files);
    renderFileTiles();
    $('#adminFileCount').textContent = `共 ${fileState.total} 个分享文件`;
    $('#btnMoreFiles').classList.toggle('hidden', fileState.loaded.length >= fileState.total);
  }

  function renderFileTiles() {
    const list = fileState.loaded;
    if (!list.length) {
      $('#adminFileList').innerHTML = `<div class="card"><div class="empty">
          <img src="/img/icon/simple.svg" alt="">
          <div>${fileState.search ? '没有找到匹配的文件' : '还没有分享任何文件，点击「新增文件」开始吧'}</div>
        </div></div>`;
      return;
    }
    $('#adminFileList').innerHTML = `<div class="admin-tiles">${list.map(tileHtml).join('')}</div>`;
    $('#adminFileList')
      .querySelectorAll('.admin-tile')
      .forEach((node) => {
        const f = list.find((x) => x.shareId === node.dataset.share);
        if (!f) return;
        node.querySelectorAll('[data-act]').forEach((b) => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            tileAction(b.dataset.act, f);
          });
        });
        node.addEventListener('click', () => tileAction('edit', f));
        node.addEventListener('contextmenu', (e) => BCD.contextMenu(e, tileMenu(f)));
      });
  }

  function tileHtml(f) {
    const badges = [];
    if (f.hasPassword) badges.push('<span class="badge warn">需要密码</span>');
    if (f.linkCount > 1) badges.push(`<span class="badge">${f.linkCount} 个地址</span>`);
    return `<div class="admin-tile" data-share="${esc(f.shareId)}" title="${esc(f.path)}">
      <img src="${BCD.iconFor(f.name)}" alt="">
      <div class="at-main">
        <div class="at-name">${esc(f.name)}</div>
        <div class="at-path">${esc(f.path)}</div>
        <div class="at-meta">
          <span>${esc(f.sizeText)}</span>
          <span>${esc(f.createdAt)}</span>
          <span>${f.downloadCount} 次下载</span>
        </div>
        <div class="at-badges">${badges.join('')}</div>
      </div>
      <div class="at-actions">
        <button class="btn sm" data-act="edit">编辑</button>
        <button class="btn sm" data-act="copy">链接</button>
        <button class="btn sm danger" data-act="del">删除</button>
      </div>
    </div>`;
  }

  function tileMenu(f) {
    return [
      { label: '编辑文件设定', onClick: () => tileAction('edit', f) },
      { label: '打开分享页', onClick: () => window.open('/s/' + f.shareId, '_blank') },
      { label: '复制分享链接', onClick: () => BCD.copyText(BCD.shareUrl('s', f.shareId), '分享链接已复制') },
      { label: '复制文件路径', onClick: () => BCD.copyText(f.path, '路径已复制') },
      { sep: true },
      { label: '删除文件', danger: true, onClick: () => tileAction('del', f) },
    ];
  }

  function tileAction(act, f) {
    if (act === 'edit') {
      BCD.fileForm({ mode: 'edit', shareId: f.shareId, onSaved: () => loadFiles(true) });
    } else if (act === 'copy') {
      const url = BCD.shareUrl('s', f.shareId);
      BCD.modal({
        title: '分享链接',
        body: `<div class="form-row" style="max-width:none;margin-bottom:0">
            <label>${esc(f.name)}</label>
            <input class="input" value="${esc(url)}" readonly onclick="this.select()">
            <div class="hint">访客访问该链接即可查看文件信息并下载（若设置了密码需先输入密码）</div>
          </div>`,
        buttons: [
          { text: '关闭' },
          {
            text: '复制链接',
            type: 'primary',
            onClick: ({ close }) => {
              BCD.copyText(url, '已复制');
              close();
            },
          },
        ],
      });
    } else if (act === 'del') {
      BCD.confirmDlg('删除文件', `确定删除「${f.name}」吗？该文件的分享链接会立即失效。`, { danger: true, okText: '删除' }).then(async (ok) => {
        if (!ok) return;
        try {
          await BCD.api('/api/admin/files/' + encodeURIComponent(f.shareId), { method: 'DELETE' });
          BCD.toastOk('已删除');
          loadFiles(true);
        } catch (e) {
          BCD.toastErr(e.message);
        }
      });
    }
  }

  /* ============================ 备份 / 恢复 ============================ */
  async function loadBackup() {
    try {
      const r = await BCD.api('/api/admin/logs?limit=50');
      $('#logDesc').textContent = `记录管理员登录、文件与设置变更等操作（共 ${r.total} 条，最多展示最近 50 条）`;
      $('#logRows').innerHTML =
        (r.logs || [])
          .map(
            (l) => `<tr>
              <td class="muted nowrap">${esc(l.createdAt)}</td>
              <td>${esc(l.actor)}</td>
              <td>${esc(l.action)}</td>
              <td class="muted">${esc(l.target)}</td>
              <td class="muted">${esc(l.detail)}</td>
              <td class="muted">${esc(l.ip)}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="6" class="muted">暂无日志</td></tr>';
    } catch (e) {
      BCD.toastErr(e.message);
    }
  }

  async function clearLogs() {
    const ok = await BCD.confirmDlg('清空操作日志', '确定清空全部操作日志吗？该操作不可恢复（清空后会保留一条「清空日志」记录）。', {
      danger: true,
      okText: '清空',
    });
    if (!ok) return;
    try {
      const r = await BCD.api('/api/admin/logs', { method: 'DELETE' });
      BCD.toastOk(`已清空 ${r.removed} 条日志`);
      loadBackup();
    } catch (e) {
      BCD.toastErr(e.message);
    }
  }

  /* ------------------------------ 导出 / 导入 ------------------------------ */
  const SCOPE_LABEL = { files: '文件', settings: '设置', both: '文件和设置', logs: '日志' };
  const SCOPE_DESC = {
    files: '文件、文件夹、下载地址',
    settings: '全局设置（站点名称、浏览权限、开关等）',
    both: '文件 + 设置',
    logs: '操作日志（只能导出，不能导入）',
  };

  /**
   * 生成导入 / 导出弹窗主体
   * @param {boolean} forImport 导入时不显示「日志」
   */
  function buildScopeForm(forImport) {
    const scopes = forImport ? ['files', 'settings', 'both'] : ['files', 'settings', 'both', 'logs'];
    const box = document.createElement('div');
    box.innerHTML = `
      <div class="form-row" style="max-width:none">
        <label>选择内容（单选）</label>
        <div class="choice-list" id="scopeList">
          ${scopes
            .map(
              (s, i) => `<label class="choice-item">
                <input type="checkbox" name="scope" value="${s}" ${i === 0 ? 'checked' : ''}>
                <span class="choice-main"><b>${SCOPE_LABEL[s]}</b><span class="muted">${SCOPE_DESC[s]}</span></span>
              </label>`
            )
            .join('')}
        </div>
        <div class="field-error" data-err="scope"></div>
      </div>

      <div class="form-row" id="fileOptions" style="max-width:none">
        <label>文件相关选项</label>
        <label class="switch" style="margin-right:20px"><input type="checkbox" id="optDownloadCount"><span class="track"></span><span class="sw-label">下载次数（默认不勾选）</span></label>
        <label class="switch"><input type="checkbox" id="optFileDesc" checked><span class="track"></span><span class="sw-label">文件简介（默认勾选）</span></label>
      </div>

      <div class="form-row" id="settingsOptions" style="max-width:none;margin-bottom:0">
        <label>设置相关选项</label>
        <label class="switch" style="margin-right:20px"><input type="checkbox" id="optAccounts"><span class="track"></span><span class="sw-label">账号列表（默认不勾选）</span></label>
        <label class="switch"><input type="checkbox" id="optHomeContent"><span class="track"></span><span class="sw-label">主页简介和标题（默认不勾选）</span></label>
      </div>`;

    const scopeInputs = [...box.querySelectorAll('input[name=scope]')];
    // 复选框外观，但只能选中一个
    scopeInputs.forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) scopeInputs.forEach((o) => { if (o !== input) o.checked = false; });
        else input.checked = true;
      });
    });
    const refresh = () => {
      const scope = getScope();
      box.querySelector('#fileOptions').classList.toggle('hidden', !(scope === 'files' || scope === 'both'));
      box.querySelector('#settingsOptions').classList.toggle('hidden', !(scope === 'settings' || scope === 'both'));
    };
    scopeInputs.forEach((i) => i.addEventListener('change', refresh));
    refresh();

    function getScope() {
      const cur = scopeInputs.find((i) => i.checked);
      return cur ? cur.value : scopes[0];
    }

    return {
      el: box,
      getScope,
      getOptions: () => ({
        downloadCount: box.querySelector('#optDownloadCount').checked,
        fileDesc: box.querySelector('#optFileDesc').checked,
        accounts: box.querySelector('#optAccounts').checked,
        homeContent: box.querySelector('#optHomeContent').checked,
      }),
    };
  }

  function exportDialog() {
    const form = buildScopeForm(false);
    BCD.modal({
      title: '导出数据',
      wide: true,
      body: form.el,
      buttons: [
        { text: '取消', onClick: ({ close }) => close(null) },
        {
          text: '开始导出',
          type: 'primary',
          onClick: ({ close }) => {
            const scope = form.getScope();
            const o = form.getOptions();
            const qs = new URLSearchParams({
              scope,
              downloadCount: o.downloadCount ? '1' : '0',
              fileDesc: o.fileDesc ? '1' : '0',
              accounts: o.accounts ? '1' : '0',
              homeContent: o.homeContent ? '1' : '0',
            });
            const a = document.createElement('a');
            a.href = '/api/admin/backup?' + qs.toString();
            a.download = '';
            document.body.appendChild(a);
            a.click();
            a.remove();
            BCD.toast('已开始导出「' + SCOPE_LABEL[scope] + '」', 'ok');
            close(null);
            setTimeout(loadBackup, 600);
          },
        },
      ],
    });
  }

  function importDialog() {
    const form = buildScopeForm(true);
    const fileRow = document.createElement('div');
    fileRow.className = 'form-row';
    fileRow.style.maxWidth = 'none';
    fileRow.innerHTML = `<label>选择备份文件（.json） <span style="color:var(--danger)">*</span></label>
      <input class="input" type="file" id="importFile" accept=".json,application/json">
      <div class="hint">导入会覆盖所选类别的现有数据，请先做好导出备份</div>
      <div class="field-error" data-err="file"></div>`;
    form.el.appendChild(fileRow);

    BCD.modal({
      title: '导入数据',
      wide: true,
      body: form.el,
      buttons: [
        { text: '取消', onClick: ({ close }) => close(null) },
        {
          text: '开始导入',
          type: 'primary',
          onClick: async ({ close, body }) => {
            BCD.clearFieldErrors(body);
            const input = body.querySelector('#importFile');
            if (!input.files || !input.files[0]) return BCD.fieldErr(body, 'file', '请选择备份文件');
            const scope = form.getScope();
            const options = form.getOptions();
            let parsed = null;
            try {
              parsed = JSON.parse(await input.files[0].text());
              if (!parsed || typeof parsed !== 'object') throw new Error('bad');
            } catch (_) {
              return BCD.fieldErr(body, 'file', '文件不是合法的 JSON');
            }
            const warn = `将导入「${SCOPE_LABEL[scope]}」，并覆盖现有的同类数据。确定继续吗？`;
            const ok = await BCD.confirmDlg('确认导入数据', warn, { danger: true, okText: '开始导入' });
            if (!ok) return;
            try {
              const r = await BCD.api('/api/admin/restore', { method: 'POST', body: { scope, options, data: parsed } });
              const sum = Object.entries(r.summary || {})
                .map(([k, v]) => `${k.replace('bcd_', '')}: ${v}`)
                .join('，');
              BCD.toastOk('导入完成（' + (sum || '无数据') + '）');
              close(null);
              loadBackup();
              loadSettings();
            } catch (e) {
              BCD.fieldErr(body, 'file', e.message);
              BCD.toastErr(e.message);
            }
          },
        },
      ],
    });
  }

  /* ============================ 事件绑定 ============================ */
  function bind() {
    $('#btnLogin').addEventListener('click', doLogin);
    $('#loginPass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
    $('#loginUser').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#loginPass').focus();
    });
    document.querySelectorAll('.sidebar [data-section]').forEach((b) =>
      b.addEventListener('click', () => switchSection(b.dataset.section))
    );
    $('#collapseBtn').addEventListener('click', () => {
      const lay = $('#viewPanel');
      lay.classList.toggle('collapsed');
      localStorage.setItem('bcd-sidebar', lay.classList.contains('collapsed') ? '1' : '0');
    });
    $('#btnSaveSettings').addEventListener('click', saveSettings);
    $('#btnReloadSettings').addEventListener('click', loadSettings);
    $('#btnPreviewNotice').addEventListener('click', () => {
      const text = $('#setHomeNotice').value.trim();
      BCD.modal({
        title: '公告预览',
        wide: true,
        body: text
          ? '<div class="md-body" id="previewBody"></div>'
          : '<div class="muted">公告内容为空，主页将不显示公告模块。</div>',
        onMount: ({ body }) => {
          const box = body.querySelector('#previewBody');
          if (box) box.innerHTML = BCD.markdown(text);
        },
        buttons: [{ text: '关闭' }],
      });
    });
    $('#btnResetNotice').addEventListener('click', () => {
      $('#setHomeNotice').value = HOME_TEXT_DEFAULT;
      BCD.toast('已填入默认公告文案，记得点击「保存设置」', 'ok');
    });
    $('#btnSaveMe').addEventListener('click', saveMe);
    $('#btnLogout').addEventListener('click', doLogout);
    $('#btnLogoutSide').addEventListener('click', doLogout);
    $('#btnNewAdmin').addEventListener('click', () => newAccountDialog('sub'));
    $('#btnNewUser').addEventListener('click', () => newAccountDialog('user'));
    $('#btnReloadAdmins').addEventListener('click', loadAccount);
    $('#btnNewFile').addEventListener('click', () => BCD.fileForm({ mode: 'create', onSaved: () => loadFiles(true) }));
    $('#btnReloadFiles').addEventListener('click', () => loadFiles(true));
    $('#btnMoreFiles').addEventListener('click', () => {
      fileState.page += 1;
      loadFiles(false);
    });
    $('#adminSort').addEventListener('change', () => {
      const [sort, order] = $('#adminSort').value.split(':');
      fileState.sort = sort;
      fileState.order = order;
      loadFiles(true);
    });
    let t = null;
    $('#adminSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        fileState.search = $('#adminSearch').value.trim();
        loadFiles(true);
      }
    });
    $('#adminSearch').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        fileState.search = $('#adminSearch').value.trim();
        loadFiles(true);
      }, 450);
    });
    $('#btnExport').addEventListener('click', exportDialog);
    $('#btnImport').addEventListener('click', importDialog);
    $('#btnReloadLogs').addEventListener('click', loadBackup);
    $('#btnClearLogs').addEventListener('click', clearLogs);
  }

  async function doLogout() {
    try {
      await BCD.api('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    BCD.toastOk('已退出登录');
    setTimeout(() => location.reload(), 400);
  }

  /* ============================ 启动 ============================ */
  (async function init() {
    site = await BCD.boot({ active: 'admin', title: '管理后台' });
    if (localStorage.getItem('bcd-sidebar') === '1' || window.innerWidth < 720) $('#viewPanel').classList.add('collapsed');
    bind();
    if (site.isAdmin || site.isUser) {
      document.title = (isStaff() ? '管理后台' : '账号设置') + ' · ' + (site.siteName || '蓝云网盘');
      showPanel();
    } else {
      showLogin();
    }
  })();
})();
