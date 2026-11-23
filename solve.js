// solve.js — a faster drop-in for makefun-site 1.0.0, written from its README spec.
// run(input) returns the output tree { path: text } exactly as makefun-site's build does.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dateLong(d) {
  const y = d.slice(0, 4);
  const m = +d.slice(5, 7);
  const day = +d.slice(8, 10);
  return day + ' ' + MONTHS[m - 1] + ' ' + y;
}

function slugify(text) {
  let s = text.normalize('NFKD').replace(/\p{M}/gu, '');
  s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  s = s.replace(/[^a-z0-9]+/g, '-');
  if (s.charCodeAt(0) === 45) s = s.slice(1);
  if (s.charCodeAt(s.length - 1) === 45) s = s.slice(0, -1);
  if (s.length > 64) {
    s = s.slice(0, 64);
    if (s.charCodeAt(s.length - 1) === 45) s = s.slice(0, -1);
  }
  return s === '' ? 'untitled' : s;
}

function uniqueSlug(base, used) {
  if (!used.has(base)) { used.add(base); return base; }
  let n = 2;
  let cand = base + '-2';
  while (used.has(cand)) { n++; cand = base + '-' + n; }
  used.add(cand);
  return cand;
}

// ---------- front matter ----------

const FM_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);

function parseQuoted(v) {
  // v starts with ". Returns { value } or { error: 'escape' | 'closed' }.
  let out = '';
  let i = 1;
  while (i < v.length) {
    const c = v[i];
    if (c === '"') {
      return i === v.length - 1 ? { value: out } : { error: 'closed' };
    }
    if (c === '\\') {
      const n = v[i + 1];
      if (n === '"' || n === '\\') { out += n; i += 2; continue; }
      if (n === undefined) return { error: 'closed' };
      return { error: 'escape' };
    }
    out += c;
    i++;
  }
  return { error: 'closed' };
}

function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
  if (y < 1970 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim;
}

function parseFrontMatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (/^[ \t]*$/.test(line)) continue;
    if (line.charCodeAt(0) === 35) continue; // comment
    const m = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (!m) return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    const key = m[1];
    let value = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!FM_KEYS.has(key)) return { error: 'unknown key "' + key + '"' };
    if (key in data) return { error: 'key "' + key + '" is given twice' };
    if (value === '') return { error: 'key "' + key + '" has no value' };
    if (key === 'title' || key === 'summary') {
      if (value.charCodeAt(0) === 34) {
        const q = parseQuoted(value);
        if (q.error === 'escape') return { error: 'key "' + key + '": a quoted string holds an escape other than \\" or \\\\' };
        if (q.error) return { error: 'key "' + key + '": a quoted string is not closed' };
        data[key] = q.value;
      } else if (value.charCodeAt(0) === 91) {
        return { error: 'key "' + key + '": a bare string opens on [' };
      } else {
        data[key] = value;
      }
    } else if (key === 'date') {
      if (!validDate(value)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      data.date = value;
    } else if (key === 'tags') {
      if (!(value.startsWith('[') && value.endsWith(']'))) return { error: 'key "tags": not a list [a, b]' };
      const inner = value.slice(1, -1);
      if (inner.replace(/[ \t]/g, '') === '') {
        data.tags = [];
      } else {
        const parts = inner.split(',');
        const tags = [];
        for (const p of parts) {
          const t = p.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
          if (t === '' || t.includes('"') || t.includes('[') || t.includes(']')) {
            return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
          }
          tags.push(t);
        }
        data.tags = tags;
      }
    } else if (key === 'draft') {
      if (value === 'true') data.draft = true;
      else if (value === 'false') data.draft = false;
      else return { error: 'key "draft": true or false' };
    } else if (key === 'layout') {
      if (!/^[a-z0-9-]+$/.test(value)) return { error: 'key "layout": not a template name' };
      data.layout = value;
    } else if (key === 'slug') {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) || value.length > 64) return { error: 'key "slug": not a slug' };
      data.slug = value;
    }
  }
  if (!('title' in data)) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}

// ---------- markdown ----------

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function findStrongClose(s, from) {
  let k = from;
  const n = s.length;
  while (k < n) {
    const c = s[k];
    if (c === '\\' && k + 1 < n && ESCAPABLE.has(s[k + 1])) { k += 2; continue; }
    if (c === '*' && s[k + 1] === '*') {
      return k > from ? k : -1;
    }
    k++;
  }
  return -1;
}

function findEmClose(s, from) {
  let k = from;
  const n = s.length;
  while (k < n) {
    const c = s[k];
    if (c === '\\' && k + 1 < n && ESCAPABLE.has(s[k + 1])) { k += 2; continue; }
    if (c === '*') {
      if (s[k + 1] === '*') { k += 2; continue; }
      return k;
    }
    k++;
  }
  return -1;
}

function resolveHref(target, ctx) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
  const c0 = target.charCodeAt(0);
  if (c0 === 47 || c0 === 35) return target; // / or #
  let pathPart = target;
  let frag = '';
  const hash = target.indexOf('#');
  if (hash !== -1) { pathPart = target.slice(0, hash); frag = target.slice(hash); }
  const segs = ctx.dirSegs.slice();
  let aboveRoot = false;
  for (const seg of pathPart.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!segs.length) { aboveRoot = true; break; }
      segs.pop();
      continue;
    }
    segs.push(seg);
  }
  if (!aboveRoot) {
    const resolved = segs.join('/');
    const url = ctx.pageUrl.get(resolved);
    if (url !== undefined) return url + frag;
    if (ctx.staticSet.has(resolved)) return ctx.base + '/' + resolved + frag;
  }
  const key = ctx.sourcePath + '\0' + target;
  if (!ctx.brokenSeen.has(key)) {
    ctx.brokenSeen.add(key);
    ctx.report.push('broken-link ' + ctx.sourcePath + ' -> ' + target);
  }
  return target;
}

function renderInline(s, ctx) {
  const out = [];
  const n = s.length;
  let i = 0;
  let plainStart = 0;
  const flushPlain = (end) => {
    if (end > plainStart) out.push(esc(s.slice(plainStart, end)));
  };
  while (i < n) {
    const c = s[i];
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx !== undefined && ESCAPABLE.has(nx)) {
        flushPlain(i);
        out.push(esc(nx));
        i += 2;
        plainStart = i;
      } else i++;
    } else if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        flushPlain(i);
        out.push('<code>' + esc(s.slice(i + 1, j)) + '</code>');
        i = j + 1;
        plainStart = i;
      } else i++;
    } else if (c === '*') {
      if (s[i + 1] === '*') {
        const close = findStrongClose(s, i + 2);
        if (close !== -1) {
          flushPlain(i);
          out.push('<strong>' + renderInline(s.slice(i + 2, close), ctx) + '</strong>');
          i = close + 2;
          plainStart = i;
        } else i += 2;
      } else {
        const close = findEmClose(s, i + 1);
        if (close !== -1) {
          flushPlain(i);
          out.push('<em>' + renderInline(s.slice(i + 1, close), ctx) + '</em>');
          i = close + 1;
          plainStart = i;
        } else i++;
      }
    } else if (c === '[') {
      // find first unescaped ]
      let j = i + 1;
      let closeBracket = -1;
      while (j < n) {
        const cj = s[j];
        if (cj === '\\' && j + 1 < n && ESCAPABLE.has(s[j + 1])) { j += 2; continue; }
        if (cj === ']') { closeBracket = j; break; }
        j++;
      }
      let done = false;
      if (closeBracket !== -1 && s[closeBracket + 1] === '(') {
        const closeParen = s.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const target = s.slice(closeBracket + 2, closeParen);
          if (target !== '' && !/\s/.test(target)) {
            flushPlain(i);
            const href = resolveHref(target, ctx);
            out.push('<a href="' + esc(href) + '">' + renderInline(s.slice(i + 1, closeBracket), ctx) + '</a>');
            i = closeParen + 1;
            plainStart = i;
            done = true;
          }
        }
      }
      if (!done) i++;
    } else i++;
  }
  flushPlain(n);
  return out.join('');
}

const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const BREAK = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET = /^[-*] /;
const ORDERED = /^(\d+)\. /;
const CONTINUATION = /^ {2,}\S/;
const BLANK = /^[ \t]*$/;

function trimST(s) {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

function renderMarkdown(body, ctx) {
  const lines = body.split('\n');
  const out = [];
  const toc = [];
  const usedIds = new Set();
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (BLANK.test(line)) { i++; continue; }
    let m;
    if ((m = FENCE_OPEN.exec(line))) {
      const lang = m[1];
      const bodyLines = [];
      i++;
      while (i < n && !FENCE_CLOSE.test(lines[i])) { bodyLines.push(esc(lines[i]) + '\n'); i++; }
      if (i < n) i++; // closing fence
      out.push('<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + bodyLines.join('') + '</code></pre>\n');
      continue;
    }
    if ((m = HEADING.exec(line)) && trimST(m[2]) !== '') {
      const level = m[1].length;
      const text = m[2].replace(/[ \t]+$/, '');
      const id = uniqueSlug(slugify(text), usedIds);
      const html = renderInline(text, ctx);
      if (level === 2 || level === 3) toc.push({ level, id, html });
      out.push('<h' + level + ' id="' + id + '">' + html + '</h' + level + '>\n');
      i++;
      continue;
    }
    if (BREAK.test(line)) { out.push('<hr>\n'); i++; continue; }
    if (line.charCodeAt(0) === 62) { // >
      const parts = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let t = lines[i].slice(1);
        if (t.charCodeAt(0) === 32) t = t.slice(1);
        t = trimST(t);
        if (t !== '') parts.push(t);
        i++;
      }
      if (parts.length === 0) out.push('<blockquote>\n</blockquote>\n');
      else out.push('<blockquote>\n<p>' + renderInline(parts.join('\n'), ctx) + '</p>\n</blockquote>\n');
      continue;
    }
    const isBullet = BULLET.test(line);
    const om = isBullet ? null : ORDERED.exec(line);
    if (isBullet || om) {
      const ordered = !!om;
      const items = [];
      let startNum = ordered ? +om[1] : 1;
      while (i < n) {
        const l = lines[i];
        if (ordered) {
          const mm = ORDERED.exec(l);
          if (mm) { items.push(l.slice(mm[0].length)); i++; continue; }
        } else if (BULLET.test(l)) {
          items.push(l.slice(2)); i++; continue;
        }
        if (CONTINUATION.test(l) && items.length) {
          items[items.length - 1] += '\n' + trimST(l);
          i++;
          continue;
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const open = ordered && startNum !== 1 ? '<ol start="' + startNum + '">' : '<' + tag + '>';
      out.push(open + '\n' + items.map((it) => '<li>' + renderInline(it, ctx) + '</li>').join('\n') + '\n</' + tag + '>\n');
      continue;
    }
    // paragraph
    const parts = [trimST(line)];
    i++;
    while (i < n) {
      const l = lines[i];
      if (BLANK.test(l)) break;
      if (FENCE_OPEN.test(l)) break;
      const hm = HEADING.exec(l);
      if (hm && trimST(hm[2]) !== '') break;
      if (BREAK.test(l)) break;
      parts.push(trimST(l));
      i++;
    }
    const html = renderInline(parts.join('\n'), ctx);
    if (excerpt === null) excerpt = html;
    out.push('<p>' + html + '</p>\n');
  }
  return { html: out.join(''), toc, excerpt: excerpt === null ? '' : excerpt };
}

// ---------- templates ----------

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function parseTemplate(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const a = src.indexOf('{{', i);
    const b = src.indexOf('{%', i);
    let j;
    if (a === -1) j = b;
    else if (b === -1) j = a;
    else j = Math.min(a, b);
    if (j === -1) { tokens.push({ t: 'text', v: src.slice(i) }); break; }
    if (j > i) tokens.push({ t: 'text', v: src.slice(i, j) });
    if (src.startsWith('{{{', j)) {
      const end = src.indexOf('}}}', j + 3);
      if (end === -1) return { error: 'a {{{ is not closed' };
      tokens.push({ t: 'var', raw: true, content: src.slice(j + 3, end) });
      i = end + 3;
    } else if (src.startsWith('{{', j)) {
      const end = src.indexOf('}}', j + 2);
      if (end === -1) return { error: 'a {{ is not closed' };
      tokens.push({ t: 'var', raw: false, content: src.slice(j + 2, end) });
      i = end + 2;
    } else {
      const end = src.indexOf('%}', j + 2);
      if (end === -1) return { error: 'a {% is not closed' };
      // standalone-line check on the raw source
      let bb = j - 1;
      while (bb >= 0 && (src[bb] === ' ' || src[bb] === '\t')) bb--;
      const beforeOk = bb < 0 || src[bb] === '\n';
      let f = end + 2;
      while (f < n && (src[f] === ' ' || src[f] === '\t')) f++;
      const afterOk = f < n && src[f] === '\n';
      if (beforeOk && afterOk) {
        const last = tokens[tokens.length - 1];
        if (last && last.t === 'text') last.v = last.v.replace(/[ \t]+$/, '');
        i = f + 1;
      } else {
        i = end + 2;
      }
      tokens.push({ t: 'tag', content: src.slice(j + 2, end) });
    }
  }
  // build tree
  const root = { nodes: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const pushNode = (node) => {
    const f = top();
    if (f.type === 'if') (f.inElse ? f.elseNodes : f.thenNodes).push(node);
    else f.nodes.push(node);
  };
  for (const tok of tokens) {
    if (tok.t === 'text') { if (tok.v !== '') pushNode({ t: 'text', v: tok.v }); continue; }
    if (tok.t === 'var') {
      const path = tok.content.trim();
      if (!PATH_RE.test(path)) return { error: '"' + path + '" is not a path' };
      pushNode({ t: 'var', raw: tok.raw, parts: path.split('.') });
      continue;
    }
    const c = tok.content.trim();
    let m;
    if ((m = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/.exec(c))) {
      if (!PATH_RE.test(m[2])) return { error: '"' + m[2] + '" is not a path' };
      const frame = { type: 'for', varName: m[1], parts: m[2].split('.'), nodes: [] };
      stack.push(frame);
    } else if (c === 'endfor') {
      const f = top();
      if (f.type !== 'for') return { error: 'an endfor with no open for' };
      stack.pop();
      pushNode({ t: 'for', varName: f.varName, parts: f.parts, body: f.nodes });
    } else if ((m = /^if (not )?(\S+)$/.exec(c))) {
      if (!PATH_RE.test(m[2])) return { error: '"' + m[2] + '" is not a path' };
      stack.push({ type: 'if', neg: !!m[1], parts: m[2].split('.'), thenNodes: [], elseNodes: [], inElse: false });
    } else if (c === 'else') {
      const f = top();
      if (f.type !== 'if' || f.inElse) return { error: 'an else outside an if' };
      f.inElse = true;
    } else if (c === 'endif') {
      const f = top();
      if (f.type !== 'if') return { error: 'an endif with no open if' };
      stack.pop();
      pushNode({ t: 'if', neg: f.neg, parts: f.parts, thenNodes: f.thenNodes, elseNodes: f.elseNodes });
    } else if ((m = /^include "([^"]*)"$/.exec(c))) {
      pushNode({ t: 'include', name: m[1] });
    } else {
      return { error: '{% ' + c + ' %} is not a tag' };
    }
  }
  if (stack.length !== 1) {
    const f = top();
    return { error: f.type === 'for' ? 'a for is not closed' : 'a if is not closed' };
  }
  return { nodes: root.nodes };
}

function resolvePath(parts, scope) {
  const first = parts[0];
  let val;
  let found = false;
  for (let fi = scope.frames.length - 1; fi >= 0; fi--) {
    const fr = scope.frames[fi];
    if (first === 'loop') { val = fr.loop; found = true; break; }
    if (first === fr.varName) { val = fr.value; found = true; break; }
  }
  if (!found) {
    if (Object.hasOwn(scope.root, first)) val = scope.root[first];
    else return undefined;
  }
  for (let pi = 1; pi < parts.length; pi++) {
    if (val === null || typeof val !== 'object') return undefined;
    if (Object.hasOwn(val, parts[pi])) val = val[parts[pi]];
    else return undefined;
  }
  return val;
}

function writeValue(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(writeValue).join(', ');
  return '';
}

function truthy(v) {
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function renderNodes(nodes, scope, templates, depth, out) {
  for (const node of nodes) {
    if (node.t === 'text') out.push(node.v);
    else if (node.t === 'var') {
      const v = writeValue(resolvePath(node.parts, scope));
      out.push(node.raw ? v : esc(v));
    } else if (node.t === 'for') {
      const arr = resolvePath(node.parts, scope);
      if (Array.isArray(arr)) {
        const len = arr.length;
        for (let idx = 0; idx < len; idx++) {
          scope.frames.push({
            varName: node.varName,
            value: arr[idx],
            loop: { index: idx + 1, first: idx === 0, last: idx === len - 1, length: len },
          });
          renderNodes(node.body, scope, templates, depth, out);
          scope.frames.pop();
        }
      }
    } else if (node.t === 'if') {
      const cond = truthy(resolvePath(node.parts, scope)) !== node.neg;
      renderNodes(cond ? node.thenNodes : node.elseNodes, scope, templates, depth, out);
    } else if (node.t === 'include') {
      if (depth < 8) {
        const tpl = templates.get(node.name);
        if (tpl) renderNodes(tpl, scope, templates, depth + 1, out);
      }
    }
  }
}

function renderTemplate(nodes, rootCtx, templates) {
  const out = [];
  renderNodes(nodes, { root: rootCtx, frames: [] }, templates, 0, out);
  return out.join('');
}

// ---------- build ----------

export function run(input) {
  const site = input.site || {};
  const base = String(site.base_url ?? '').replace(/\/+$/, '');
  const report = [];
  const files = (input.files || []).slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // templates
  const templates = new Map();
  const tplSrc = input.templates || {};
  for (const name of Object.keys(tplSrc).sort()) {
    const parsed = parseTemplate(String(tplSrc[name]));
    if (parsed.error) report.push('template "' + name + '": ' + parsed.error);
    else templates.set(name, parsed.nodes);
  }

  const sources = [];
  const statics = [];
  const staticSet = new Set();
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, content: String(f.content).replace(/\r\n?/g, '\n') });
    } else {
      statics.push(f);
      staticSet.add(f.path);
    }
  }

  // front matter + drop checks
  const kept = [];
  for (const src of sources) {
    const fm = parseFrontMatter(src.content);
    if (fm.error) { report.push('refused ' + src.path + ': ' + fm.error); continue; }
    const firstSeg = src.path.split('/')[0];
    if (firstSeg === 'tags' || firstSeg === 'page') {
      report.push('refused ' + src.path + ': ' + firstSeg + '/ is the generator\'s own');
      continue;
    }
    const isPost = firstSeg === 'posts';
    const data = fm.data;
    if (isPost && !('date' in data)) { report.push('refused ' + src.path + ': a post needs a date'); continue; }
    const layout = data.layout || (isPost ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push('refused ' + src.path + ': layout "' + layout + '" is no template that parses');
      continue;
    }
    if (data.draft === true) { report.push('draft ' + src.path); continue; }
    const slash = src.path.lastIndexOf('/');
    const dir = isPost ? 'posts' : (slash === -1 ? '' : src.path.slice(0, slash));
    kept.push({ path: src.path, data, body: fm.body, isPost, layout, dir });
  }

  // permalinks
  const usedByDir = new Map();
  const pageUrl = new Map();
  for (const p of kept) {
    let used = usedByDir.get(p.dir);
    if (!used) {
      used = new Set(p.dir === '' ? ['posts', 'tags', 'page'] : []);
      usedByDir.set(p.dir, used);
    }
    p.slug = uniqueSlug(p.data.slug || slugify(p.data.title), used);
    p.outPath = (p.dir ? p.dir + '/' : '') + p.slug + '/index.html';
    p.url = base + '/' + (p.dir ? p.dir + '/' : '') + p.slug + '/';
    pageUrl.set(p.path, p.url);
  }

  // markdown
  const brokenSeen = new Set();
  for (const p of kept) {
    const dirSegs = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')).split('/') : [];
    const ctx = { dirSegs, pageUrl, staticSet, base, brokenSeen, report, sourcePath: p.path };
    const md = renderMarkdown(p.body, ctx);
    p.content = md.html;
    p.toc = md.toc;
    p.excerpt = md.excerpt;
    const words = (p.body.match(/\S+/g) || []).length;
    p.reading = Math.max(1, Math.ceil(words / 200));
    // own tags, deduped by slug, first spelling kept
    const seen = new Set();
    p.ownTags = [];
    for (const t of p.data.tags || []) {
      const s = slugify(t);
      if (seen.has(s)) continue;
      seen.add(s);
      p.ownTags.push({ name: t, slug: s });
    }
  }

  // collections
  const posts = kept.filter((p) => p.isPost);
  posts.sort((a, b) => {
    if (a.data.date !== b.data.date) return a.data.date < b.data.date ? 1 : -1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  posts.forEach((p, idx) => {
    p.newerPost = idx > 0 ? posts[idx - 1] : null;
    p.olderPost = idx < posts.length - 1 ? posts[idx + 1] : null;
  });

  // tags
  const tagMap = new Map();
  for (const p of posts) {
    for (const t of p.ownTags) {
      let tag = tagMap.get(t.slug);
      if (!tag) {
        tag = { name: t.name, slug: t.slug, url: base + '/tags/' + t.slug + '/', count: 0, posts: [] };
        tagMap.set(t.slug, tag);
      }
      tag.count++;
      tag.posts.push(p);
    }
  }
  const tagsList = [...tagMap.values()].sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const tagsCtx = tagsList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));

  const cardOf = (p) => ({
    title: p.data.title,
    url: p.url,
    date: p.data.date || '',
    date_long: p.data.date ? dateLong(p.data.date) : '',
    summary: p.data.summary || '',
    excerpt: p.excerpt,
    reading_minutes: p.reading,
    tags: p.ownTags.map((t) => {
      const g = tagMap.get(t.slug);
      return { name: g ? g.name : t.name, slug: t.slug, url: g ? g.url : '' };
    }),
  });
  for (const p of kept) p.card = cardOf(p);
  const recentN = site.recent ?? 0;
  const recent = posts.slice(0, recentN).map((p) => p.card);
  const siteCtx = { title: site.title ?? '', base_url: base };
  const baseCtx = { site: siteCtx, tags: tagsCtx, recent };

  const output = {};
  let pageCount = 0;
  for (const p of kept) {
    const neighbour = (q) => (q ? { title: q.data.title, url: q.url, date: q.data.date || '', date_long: q.data.date ? dateLong(q.data.date) : '' } : null);
    const pageObj = {
      ...p.card,
      slug: p.slug,
      content: p.content,
      toc: p.toc,
      newer: p.isPost ? neighbour(p.newerPost) : null,
      older: p.isPost ? neighbour(p.olderPost) : null,
      is_post: p.isPost,
    };
    output[p.outPath] = renderTemplate(templates.get(p.layout), { ...baseCtx, page: pageObj }, templates);
    if (!p.isPost) pageCount++;
  }

  // index pages
  if (templates.has('index')) {
    const perPage = site.per_page ?? 10;
    const total = Math.max(1, Math.ceil(posts.length / perPage));
    for (let num = 1; num <= total; num++) {
      const slice = posts.slice((num - 1) * perPage, num * perPage).map((p) => p.card);
      const urlOf = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
      const pager = {
        number: num,
        total,
        url: urlOf(num),
        newer_url: num > 1 ? urlOf(num - 1) : '',
        older_url: num < total ? urlOf(num + 1) : '',
      };
      const outPath = num === 1 ? 'index.html' : 'page/' + num + '/index.html';
      output[outPath] = renderTemplate(templates.get('index'), { ...baseCtx, posts: slice, pager }, templates);
    }
  }

  // tag pages
  if (templates.has('tag')) {
    for (const t of tagsList) {
      const tagCtx = { name: t.name, slug: t.slug, url: t.url, count: t.count, posts: t.posts.map((p) => p.card) };
      output['tags/' + t.slug + '/index.html'] = renderTemplate(templates.get('tag'), { ...baseCtx, tag: tagCtx }, templates);
    }
  }
  if (templates.has('tags')) {
    output['tags/index.html'] = renderTemplate(templates.get('tags'), { ...baseCtx }, templates);
  }

  // statics
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) {
      report.push('shadowed ' + f.path + ': a built page has its path');
      continue;
    }
    output[f.path] = String(f.content);
  }
  const staticCount = statics.length;

  report.sort();
  report.push('built ' + pageCount + ' pages, ' + posts.length + ' posts, ' + tagsList.length + ' tags and ' + staticCount + ' static files');
  output['build-report.txt'] = report.map((l) => l + '\n').join('');
  return output;
}
