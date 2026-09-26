/* ==========================================================================
   BCD 轻量 Markdown 渲染（无依赖，先转义再渲染，杜绝 XSS）
   支持：标题、粗体、斜体、删除线、行内代码、代码块、链接、图片、
        无序/有序列表、引用、分割线、段落与换行
   ========================================================================== */
(function () {
  'use strict';
  const BCD = window.BCD;
  const esc = BCD.escapeHtml;

  // 传入的文本已经过 HTML 转义，这里只做「白名单」校验，不再二次转义
  function safeUrl(url) {
    const u = String(url || '').trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^(\/|#|mailto:|tel:)/i.test(u)) return u;
    return '';
  }

  function inline(text) {
    let s = esc(text);

    // 行内代码先用占位符保护，避免内部内容被其它规则改写
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => {
      codes.push(c);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    // 图片 ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, url) => {
      const u = safeUrl(url);
      return u ? `<img class="md-img" src="${u}" alt="${alt.replace(/"/g, '&quot;')}">` : alt;
    });

    // 链接 [文本](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, t, url) => {
      const u = safeUrl(url);
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>` : t;
    });

    // 自动链接（避免与已生成的 <a href=...> 冲突，只处理裸链接）
    s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, (m, pre, url) => {
      if (/["'=]$/.test(pre)) return m;
      return `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });

    // 粗体 / 斜体 / 删除线
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 还原行内代码
    s = s.replace(/\u0000C(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
    return s;
  }

  BCD.markdown = function (src) {
    const text = String(src === undefined || src === null ? '' : src).replace(/\r\n?/g, '\n');
    if (!text.trim()) return '';

    const lines = text.split('\n');
    const out = [];
    let i = 0;
    let list = null; // 'ul' | 'ol'
    let para = [];
    let quote = [];

    const flushPara = () => {
      if (para.length) {
        out.push('<p>' + para.map(inline).join('<br>') + '</p>');
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        out.push('</' + list + '>');
        list = null;
      }
    };
    const flushQuote = () => {
      if (quote.length) {
        out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>');
        quote = [];
      }
    };
    const flushAll = () => {
      flushPara();
      flushList();
      flushQuote();
    };

    while (i < lines.length) {
      const line = lines[i].trim();

      // 代码块
      if (/^```/.test(line)) {
        flushAll();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        out.push('<pre class="md-pre"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      if (!line) {
        flushAll();
        i++;
        continue;
      }

      // 分割线
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
        flushAll();
        out.push('<hr>');
        i++;
        continue;
      }

      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushAll();
        const lv = h[1].length;
        out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
        i++;
        continue;
      }

      // 引用
      if (/^>\s?/.test(line)) {
        flushPara();
        flushList();
        quote.push(line.replace(/^>\s?/, ''));
        i++;
        continue;
      }
      flushQuote();

      // 无序列表
      const ul = line.match(/^[-*+]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (list !== 'ul') {
          flushList();
          out.push('<ul>');
          list = 'ul';
        }
        out.push('<li>' + inline(ul[1]) + '</li>');
        i++;
        continue;
      }

      // 有序列表
      const ol = line.match(/^\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara();
        if (list !== 'ol') {
          flushList();
          out.push('<ol>');
          list = 'ol';
        }
        out.push('<li>' + inline(ol[1]) + '</li>');
        i++;
        continue;
      }

      flushList();
      para.push(line);
      i++;
    }
    flushAll();
    return out.join('\n');
  };

  /** 版本号比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
  BCD.compareVersion = function (a, b) {
    const na = String(a || '').replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const nb = String(b || '').replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const len = Math.max(na.length, nb.length);
    for (let i = 0; i < len; i++) {
      const x = na[i] || 0;
      const y = nb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  };
})();
