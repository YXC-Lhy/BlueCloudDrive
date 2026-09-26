/**
 * 前端 Markdown 渲染 / 版本比较自测（无需浏览器）
 *   node _test/md-tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'js', 'md.js'), 'utf8');

const BCD = {
  escapeHtml: (s) =>
    String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
};
new Function('window', code)({ BCD });

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name + ' ' + extra);
    console.log(`  ✗ ${name} ${extra}`);
  }
}
const md = BCD.markdown;

console.log('== Markdown 渲染 ==');
check('空内容返回空串', md('') === '' && md('   ') === '');
check('普通段落', md('hello') === '<p>hello</p>', md('hello'));
check('标题', md('## 标题').includes('<h2>标题</h2>'));
check('粗体', md('**重点**').includes('<strong>重点</strong>'));
check('斜体', md('*斜*').includes('<em>斜</em>'));
check('删除线', md('~~删~~').includes('<del>删</del>'));
check('行内代码', md('`a<b`').includes('<code>a&lt;b</code>'), md('`a<b`'));
check('链接', md('[官网](https://example.com)').includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">官网</a>'));
check('相对链接', md('[主页](/files)').includes('href="/files"'));
check('自动链接', md('见 https://example.com/x 说明').includes('<a href="https://example.com/x"'));
check('无序列表', md('- a\n- b') === '<ul>\n<li>a</li>\n<li>b</li>\n</ul>', md('- a\n- b'));
check('有序列表', md('1. a\n2. b').includes('<ol>') && md('1. a\n2. b').includes('<li>b</li>'));
check('引用', md('> 引用内容').includes('<blockquote>引用内容</blockquote>'));
check('分割线', md('---') === '<hr>');
check('代码块', md('```\nconst a = 1 < 2;\n```').includes('<pre class="md-pre"><code>const a = 1 &lt; 2;</code></pre>'));
check('多行段落换行', md('a\nb') === '<p>a<br>b</p>', md('a\nb'));
check('列表后接段落', md('- a\n\n段落') === '<ul>\n<li>a</li>\n</ul>\n<p>段落</p>', md('- a\n\n段落'));

console.log('\n== XSS 防护 ==');
check('原始 HTML 被转义', md('<script>alert(1)</script>') === '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>', md('<script>alert(1)</script>'));
check('img onerror 被转义', !md('<img src=x onerror=alert(1)>').includes('<img'));
check('javascript: 链接被丢弃', !md('[点我](javascript:alert(1))').includes('<a '), md('[点我](javascript:alert(1))'));
check('data: 链接被丢弃', !md('[点我](data:text/html,<script>alert(1)</script>)').includes('<a '));
check('属性注入被阻止', !md('[x](https://a.com" onmouseover="alert(1))').includes('onmouseover="alert'), md('[x](https://a.com" onmouseover="alert(1))'));
check('代码块内脚本被转义', !md('```\n<script>x</script>\n```').includes('<script>'));

console.log('\n== 版本比较 ==');
check('1.0.1 > 1.0.0', BCD.compareVersion('1.0.1', '1.0.0') === 1);
check('1.0.0 = v1.0.0', BCD.compareVersion('1.0.0', 'v1.0.0') === 0);
check('1.0.0 < 1.1', BCD.compareVersion('1.0.0', '1.1') === -1);
check('1.10.0 > 1.9.9', BCD.compareVersion('1.10.0', '1.9.9') === 1);
check('空值安全', BCD.compareVersion('', '1.0.0') === -1 && BCD.compareVersion('1.0.0', '') === 1);

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  fails.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
