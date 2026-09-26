/* ==========================================================================
   BCD 文件分享表单（新增 / 编辑共用）—— 依赖 common.js
   BCD.fileForm({ mode:'create'|'edit', shareId, defaultFolder, onSaved })
   ========================================================================== */
(function () {
  'use strict';
  const BCD = window.BCD;
  const esc = BCD.escapeHtml;

  function numOf(v, unit) {
    const mult = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }[unit];
    return Math.round(v * mult);
  }

  function splitSize(bytes) {
    if (bytes === null || bytes === undefined) return { unit: 'unknown', value: '' };
    const units = ['GB', 'MB', 'KB', 'B'];
    for (const u of units) {
      const mult = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }[u];
      const v = bytes / mult;
      if (v >= 1) {
        const rounded = Math.round(v * 100) / 100;
        if (String(Math.floor(rounded)).length <= 4) return { unit: u, value: String(rounded) };
        return { unit: 'unknown', value: '' };
      }
    }
    return { unit: 'B', value: String(bytes) };
  }

  BCD.fileForm = async function (opts) {
    const o = opts || {};
    const isEdit = o.mode === 'edit';
    let file = null;
    let links = [{ kind: 'direct', url: '', source: '' }];

    if (isEdit) {
      try {
        const r = await BCD.api('/api/admin/files/' + encodeURIComponent(o.shareId));
        file = r.file;
        links = (file.links && file.links.length ? file.links : [{ kind: 'direct', url: '', source: '' }]).map((l) => ({
          kind: l.kind,
          url: l.url,
          source: l.source || '',
        }));
      } catch (e) {
        BCD.toastErr(e.message);
        return;
      }
    }

    const size0 = splitSize(file ? file.sizeBytes : null);
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="form-row">
        <label>文件名称 <span style="color:var(--danger)">*</span></label>
        <input class="input" name="name" maxlength="128" autocomplete="off" placeholder="例如：蓝云客户端 v1.0.apk" value="${esc(file ? file.name : '')}">
        <div class="field-error" data-err="name"></div>
      </div>

      <div class="form-row">
        <label>文件路径（文件在全文件浏览界面中的位置）<span style="color:var(--danger)">*</span></label>
        <div class="field-with-btn">
          <input class="input" name="folder" autocomplete="off" placeholder="/文件分享" value="${esc(file ? file.folder : o.defaultFolder || '/文件分享')}">
          <button class="btn" type="button" id="browseFolder" title="浏览并选择文件夹">浏览…</button>
        </div>
        <div class="hint">默认 /文件分享；填写其它路径会自动创建对应文件夹，也可以点「浏览…」选择已有文件夹</div>
        <div class="field-error" data-err="folder"></div>
      </div>

      <div class="form-row">
        <label>文件地址（可添加多个直链 / 站外分享链接）<span style="color:var(--danger)">*</span></label>
        <div id="linkList"></div>
        <button class="btn sm" type="button" id="addLink">+ 添加地址</button>
        <div class="hint">直链：http(s) 开头、可直接下载的文件地址；站外分享链接：需填写来源（如 百度网盘），点击后在新标签页打开</div>
        <div class="field-error" data-err="links"></div>
      </div>

      <div class="form-row">
        <label>文件大小</label>
        <div class="inline-fields">
          <select class="select" name="sizeUnit" id="sizeUnit">
            <option value="unknown">未知</option>
            <option value="B">B</option>
            <option value="KB">KB</option>
            <option value="MB">MB</option>
            <option value="GB">GB</option>
          </select>
          <input class="input" name="sizeValue" id="sizeValue" autocomplete="off" placeholder="例如 1024 或 12.34" disabled>
        </div>
        <div class="hint">默认「未知」；自定义时最多 4 位整数、2 位小数</div>
        <div class="field-error" data-err="size"></div>
      </div>

      <div class="form-row">
        <label>下载密码</label>
        ${
          isEdit
            ? `<select class="select" id="pwAction" style="margin-bottom:8px">
                 <option value="keep">保持不变（当前：${file.hasPassword ? '已设置密码' : '无密码'}）</option>
                 <option value="set">设置新密码</option>
                 <option value="clear">清除密码</option>
               </select>
               <input class="input" name="password" id="password" maxlength="10" autocomplete="new-password" placeholder="请输入新的下载密码" disabled>`
            : `<input class="input" name="password" id="password" maxlength="10" autocomplete="new-password" placeholder="留空表示不设置密码">`
        }
        <div class="hint">最长 10 个字符；设置后访客需要输入密码才能获取下载地址</div>
        <div class="field-error" data-err="password"></div>
      </div>`;

    const linkList = body.querySelector('#linkList');
    const sizeUnit = body.querySelector('#sizeUnit');
    const sizeValue = body.querySelector('#sizeValue');
    sizeUnit.value = size0.unit;
    sizeValue.value = size0.value;
    sizeValue.disabled = size0.unit === 'unknown';

    function renderLinks() {
      linkList.innerHTML = links
        .map(
          (l, i) => `
        <div class="link-row" data-i="${i}">
          <select class="select lr-kind">
            <option value="direct"${l.kind === 'direct' ? ' selected' : ''}>直链下载</option>
            <option value="external"${l.kind === 'external' ? ' selected' : ''}>站外分享链接</option>
          </select>
          <div class="lr-fields">
            <input class="input lr-url" placeholder="https://example.com/file.zip" value="${esc(l.url)}">
            <input class="input lr-source" placeholder="来源（如 百度网盘）" style="margin-top:6px;${l.kind === 'external' ? '' : 'display:none'}" value="${esc(l.source || '')}">
          </div>
          <button class="btn sm danger" type="button" data-del="${i}" title="删除该地址">删除</button>
        </div>`
        )
        .join('');
      linkList.querySelectorAll('.link-row').forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelector('.lr-kind').addEventListener('change', (e) => {
          links[i].kind = e.target.value;
          row.querySelector('.lr-source').style.display = e.target.value === 'external' ? '' : 'none';
        });
        row.querySelector('.lr-url').addEventListener('input', (e) => (links[i].url = e.target.value));
        row.querySelector('.lr-source').addEventListener('input', (e) => (links[i].source = e.target.value));
        row.querySelector('[data-del]').addEventListener('click', () => {
          if (links.length === 1) {
            BCD.toastErr('至少需要保留一个文件地址');
            return;
          }
          links.splice(i, 1);
          renderLinks();
        });
      });
    }
    renderLinks();

    body.querySelector('#addLink').addEventListener('click', () => {
      if (links.length >= 20) {
        BCD.toastErr('一个文件最多添加 20 个地址');
        return;
      }
      links.push({ kind: 'direct', url: '', source: '' });
      renderLinks();
    });

    sizeUnit.addEventListener('change', () => {
      sizeValue.disabled = sizeUnit.value === 'unknown';
      if (sizeValue.disabled) sizeValue.value = '';
      else sizeValue.focus();
    });

    const pwAction = body.querySelector('#pwAction');
    const pwInput = body.querySelector('#password');
    if (pwAction) {
      pwAction.addEventListener('change', () => {
        pwInput.disabled = pwAction.value !== 'set';
        if (pwInput.disabled) pwInput.value = '';
        else pwInput.focus();
      });
    }

    // 浏览并选择文件夹
    body.querySelector('#browseFolder').addEventListener('click', async () => {
      const picked = await BCD.folderPicker({
        initialPath: body.querySelector('[name=folder]').value.trim() || '/文件分享',
      });
      if (picked) {
        body.querySelector('[name=folder]').value = picked;
        BCD.fieldErr(body, 'folder', '');
      }
    });

    const modal = BCD.modal({
      title: isEdit ? '编辑文件分享' : '新增文件分享',
      wide: true,
      body,
      buttons: [
        {
          text: '取消',
          onClick: ({ close }) => close(),
        },
        {
          text: isEdit ? '保存修改' : '提交并生成分享链接',
          type: 'primary',
          onClick: async ({ close }) => {
            BCD.clearFieldErrors(body);
            const payload = {
              name: body.querySelector('[name=name]').value.trim(),
              folder: body.querySelector('[name=folder]').value.trim(),
              links: links.map((l) => ({ kind: l.kind, url: String(l.url || '').trim(), source: l.kind === 'external' ? String(l.source || '').trim() : '' })),
              size: sizeUnit.value === 'unknown' ? { mode: 'unknown' } : { mode: 'custom', value: sizeValue.value.trim(), unit: sizeUnit.value },
            };
            if (isEdit) {
              payload.passwordAction = pwAction.value;
              if (pwAction.value === 'set') payload.password = pwInput.value;
            } else {
              payload.passwordAction = pwInput.value ? 'set' : 'clear';
              payload.password = pwInput.value;
            }

            // —— 前端预校验（后端会再校验一次）——
            const fe = {};
            if (!payload.name) fe.name = '请输入文件名称';
            else if (/[\\/:*?"<>|]/.test(payload.name)) fe.name = '文件名称不能包含 \\ / : * ? " < > | 等特殊字符';
            if (!payload.folder) fe.folder = '请输入文件路径';
            else if (/(^|\/)\.\.?(\/|$)/.test(payload.folder)) fe.folder = '文件路径不能包含 . 或 ..';
            if (!payload.links.length) fe.links = '请至少添加一个文件地址';
            else if (payload.links.some((l) => !l.url)) fe.links = '文件地址不能为空';
            else if (payload.links.some((l) => !/^https?:\/\/.+/i.test(l.url))) fe.links = '文件地址必须以 http:// 或 https:// 开头';
            else if (payload.links.some((l) => l.kind === 'external' && !l.source)) fe.links = '站外分享链接必须填写来源';
            if (payload.size.mode === 'custom' && !/^\d{1,4}(\.\d{1,2})?$/.test(payload.size.value)) fe.size = '文件大小格式错误：最多 4 位整数、2 位小数';
            if (payload.size.mode === 'custom' && Number(payload.size.value) <= 0) fe.size = '文件大小必须大于 0';
            if (payload.passwordAction === 'set' && !payload.password) fe.password = '请输入下载密码';
            if (payload.password && [...payload.password].length > 10) fe.password = '下载密码最长 10 个字符';
            if (Object.keys(fe).length) {
              BCD.applyFieldErrors(body, fe);
              return;
            }

            try {
              if (isEdit) {
                await BCD.api('/api/admin/files/' + encodeURIComponent(o.shareId), { method: 'PUT', body: payload });
                BCD.toastOk('已保存修改');
              } else {
                const r = await BCD.api('/api/admin/files', { method: 'POST', body: payload });
                BCD.toastOk('提交成功，分享链接已生成');
                if (!isEdit && r && r.shareId) {
                  BCD.copyText(BCD.shareUrl('s', r.shareId), '分享链接已复制：' + BCD.shareUrl('s', r.shareId));
                }
              }
              close();
              if (o.onSaved) o.onSaved();
            } catch (e) {
              if (e.fields && Object.keys(e.fields).length) BCD.applyFieldErrors(body, e.fields);
              BCD.toastErr(e.message);
            }
          },
        },
      ],
    });
    return modal;
  };

  /* ==========================================================================
     文件夹选择弹窗：浏览全部文件，选中文件夹后填入路径
       - 仅有「新建文件夹」按钮 + 右键空文件夹出现「删除」
       - 单击选中，再次单击或双击进入
     ========================================================================== */
  BCD.folderPicker = function (opts) {
    const o = opts || {};
    let selected = o.initialPath || '/';

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="toolbar" style="margin-bottom:10px">
        <button class="btn sm" type="button" id="fpUp">↑ 上一级</button>
        <button class="btn sm" type="button" id="fpRefresh">刷新</button>
        <button class="btn sm primary" type="button" id="fpNew">新建文件夹</button>
        <div style="flex:1"></div>
        <span class="muted" id="fpCount"></span>
      </div>
      <nav class="breadcrumb" id="fpCrumb"></nav>
      <div id="fpList" class="file-list fp-list"><div class="empty">加载中…</div></div>
      <div class="hint">单击选中文件夹，再次单击或双击进入；右键空文件夹可删除</div>
      <div class="fp-selected">已选择：<b id="fpSel">/</b></div>`;

    const listEl = body.querySelector('#fpList');
    const crumbEl = body.querySelector('#fpCrumb');
    const countEl = body.querySelector('#fpCount');
    const selEl = body.querySelector('#fpSel');
    let data = null;

    function paintSelected() {
      selEl.textContent = selected;
      listEl.querySelectorAll('.file-row').forEach((row) => {
        row.classList.toggle('selected', row.dataset.folder === selected);
      });
    }

    function setSelected(p) {
      selected = p;
      paintSelected();
    }

    async function load(p) {
      listEl.innerHTML = '<div class="empty">加载中…</div>';
      try {
        data = await BCD.api('/api/files/list?path=' + encodeURIComponent(p || '/') + '&sort=name&order=asc');
      } catch (e) {
        listEl.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
        return;
      }
      render();
    }

    function render() {
      // 面包屑
      crumbEl.innerHTML = (data.breadcrumb || [])
        .map((c, i, arr) => {
          const last = i === arr.length - 1;
          return `<span class="crumb ${last ? 'current' : ''}" data-path="${esc(c.path)}">${esc(c.name)}</span>${last ? '' : '<span class="sep">/</span>'}`;
        })
        .join('');
      crumbEl.querySelectorAll('.crumb').forEach((c) => c.addEventListener('click', () => load(c.dataset.path)));

      const folders = data.folders || [];
      const files = data.files || [];
      countEl.textContent = `${folders.length} 个文件夹 · ${files.length} 个文件`;

      const rows = [];
      folders.forEach((f) => {
        const meta = f.empty ? '空文件夹' : `${f.subCount} 个子文件夹 · ${f.fileCount} 个文件`;
        rows.push(`<div class="file-row" data-folder="${esc(f.path)}">
            <img src="/img/icon/folder.svg" alt="">
            <div class="fr-main">
              <div class="fr-name">${esc(f.name)}</div>
              <div class="fr-sub"><span>${esc(meta)}</span></div>
            </div>
            <div class="fr-actions"><span class="badge ${f.empty ? '' : 'ok'}">${f.empty ? '空' : '有内容'}</span></div>
          </div>`);
      });
      files.forEach((f) => {
        rows.push(`<div class="file-row" style="opacity:.55;cursor:default">
            <img src="${BCD.iconFor(f.name)}" alt="">
            <div class="fr-main">
              <div class="fr-name">${esc(f.name)}</div>
              <div class="fr-sub"><span>${esc(f.sizeText)}</span><span>${esc(f.createdAt)}</span></div>
            </div>
          </div>`);
      });
      listEl.innerHTML = rows.length ? rows.join('') : '<div class="empty">该目录下还没有文件夹</div>';

      listEl.querySelectorAll('[data-folder]').forEach((row) => {
        const path = row.dataset.folder;
        const folder = folders.find((x) => x.path === path);
        row.addEventListener('click', () => {
          if (selected === path) load(path); // 再次单击 = 进入
          else setSelected(path);
        });
        row.addEventListener('dblclick', () => load(path));
        row.addEventListener('contextmenu', (ev) => {
          setSelected(path);
          BCD.contextMenu(ev, [
            folder && folder.empty
              ? {
                  label: '删除文件夹',
                  danger: true,
                  onClick: async () => {
                    const ok = await BCD.confirmDlg('删除文件夹', `确定删除空文件夹「${folder.name}」吗？`, { danger: true, okText: '删除' });
                    if (!ok) return;
                    try {
                      await BCD.api('/api/admin/folders/' + encodeURIComponent(folder.shareId), { method: 'DELETE' });
                      BCD.toastOk('已删除');
                      if (selected === path) setSelected(data.path);
                      load(data.path);
                    } catch (e) {
                      BCD.toastErr(e.message);
                    }
                  },
                }
              : { label: '删除文件夹（文件夹非空）', disabled: true },
            { label: '进入该文件夹', onClick: () => load(path) },
          ]);
        });
      });
      paintSelected();
    }

    async function createFolder() {
      const base = data ? data.path : '/';
      const name = await BCD.promptDlg('新建文件夹', {
        label: '文件夹名称',
        placeholder: '例如 电影',
        hint: `将在 ${base} 下创建`,
        okText: '创建',
      });
      if (name === null || !name.trim()) return;
      const full = (base === '/' ? '' : base) + '/' + name.trim();
      try {
        await BCD.api('/api/admin/folders', { method: 'POST', body: { path: full } });
        BCD.toastOk('文件夹已创建');
        setSelected(full);
        load(base);
      } catch (e) {
        BCD.toastErr(e.message);
      }
    }

    body.querySelector('#fpUp').addEventListener('click', () => {
      if (data && data.parent) load(data.parent);
    });
    body.querySelector('#fpRefresh').addEventListener('click', () => load(data ? data.path : '/'));
    body.querySelector('#fpNew').addEventListener('click', createFolder);

    return new Promise((resolve) => {
      BCD.modal({
        title: o.title || '选择文件夹',
        wide: true,
        body,
        buttons: [
          { text: '取消', onClick: ({ close }) => close(null) },
          { text: '选择此文件夹', type: 'primary', onClick: ({ close }) => close(selected) },
        ],
        onClose: (result) => resolve(result === undefined ? null : result),
      });
      load(selected);
    });
  };
})();
