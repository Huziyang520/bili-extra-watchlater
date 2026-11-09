/* 额外稍后再看 · 页面内容脚本
 * 在 B 站视频卡片封面右上角注入「稍后」按钮，右下角注入列表切换胶囊。
 * 所有 UI 位于 Shadow DOM，CSS 内联，不依赖站点样式。
 */
(function () {
  'use strict';

  if (window.__bewContentLoaded) return;
  window.__bewContentLoaded = true;

  var S = window.BEWStore;
  if (!S) return;

  var CARD_SEL = [
    '.bili-video-card',
    '.video-page-card-small',
    '.video-card',
    '.video-list-item',
    '.small-item',
    '.rank-item',
    '.bili-dyn-card-video'
  ].join(',');
  var VIDEO_LINK = 'a[href*="/video/BV"], a[href*="/video/av"]';
  var PILL_POS_KEY = 'bew.pill.pos';

  var state = { data: null, bvids: Object.create(null), slots: [] };
  var ui = { host: null, shadow: null, pill: null, sel: null, count: null, toast: null, toastTimer: 0 };
  var btnSheet = null;
  var scanTimer = 0;

  /* ---------- 工具 ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgIcon(pathData, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', size || 12);
    svg.setAttribute('height', size || 12);
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', pathData);
    p.setAttribute('fill', 'currentColor');
    svg.appendChild(p);
    return svg;
  }

  function extractId(href) {
    var m = /\/video\/(BV[0-9A-Za-z]{10})/.exec(href);
    if (m) return m[1];
    m = /\/video\/av(\d+)/i.exec(href);
    return m ? 'av' + m[1] : null;
  }

  function watchUrl(id) {
    return 'https://www.bilibili.com/video/' + id + '/';
  }

  function resolveRoot(link) {
    var root = link.closest(CARD_SEL);
    if (root) return root;
    /* 未命中已知卡片结构时，向上找“含一张视频比例缩略图”的容器；纯文字链接不留按钮 */
    var node = link;
    var best = null;
    for (var i = 0; i < 6 && node.parentElement && node.parentElement !== document.body; i++) {
      node = node.parentElement;
      if (node.querySelectorAll(VIDEO_LINK).length > 1) break;
      var r = node.getBoundingClientRect();
      if (r.width > 780 || r.height > 640) break;
      var img = node.querySelector('img');
      if (!img) continue;
      var ir = img.getBoundingClientRect();
      if (ir.width < 100 || ir.height < 56) continue;
      var ratio = ir.width / ir.height;
      if (ratio < 1.2 || ratio > 2.4) continue;
      best = node;
    }
    return best;
  }

  function readMeta(root, id, link) {
    var titleEl = root.querySelector('.bili-video-card__info--tit, .video-name, .title, h3, [title]');
    var title = '';
    if (titleEl) title = titleEl.getAttribute('title') || titleEl.textContent || '';
    if (!title) title = link.getAttribute('title') || link.textContent || '';
    title = title.replace(/\s+/g, ' ').trim().slice(0, 120);

    var img = root.querySelector('img');
    var cover = img ? (img.currentSrc || img.getAttribute('src') || '') : '';
    if (cover.indexOf('//') === 0) cover = 'https:' + cover;

    var upEl = root.querySelector('.bili-video-card__info--author, .up-name, .name');
    var up = upEl ? upEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '';

    var durEl = root.querySelector('.bili-video-card__stats__duration, .duration, .length');
    var duration = durEl ? durEl.textContent.trim().slice(0, 12) : '';

    return { bvid: id, title: title || id, up: up, cover: cover, duration: duration, url: watchUrl(id) };
  }

  /* ---------- 卡片按钮 ---------- */

  var BTN_CSS = [
    ':host { display: block; }',
    '.btn {',
    '  all: initial;',
    '  box-sizing: border-box;',
    '  display: inline-flex; align-items: center; gap: 4px;',
    '  height: 26px; padding: 0 10px; border: 0; border-radius: 13px;',
    '  font: 600 12px/1 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;',
    '  color: #fff; cursor: pointer; opacity: .9; white-space: nowrap;',
    '  background: linear-gradient(135deg, #fb7299, #ff5c8a);',
    '  box-shadow: 0 2px 10px rgba(0, 0, 0, .22);',
    '  transition: opacity .15s ease, transform .15s ease;',
    '  -webkit-font-smoothing: antialiased;',
    '}',
    '.btn:hover { opacity: 1; transform: translateY(-1px); }',
    '.btn:active { transform: scale(.96); }',
    '.btn.added { background: rgba(18, 20, 24, .62); backdrop-filter: blur(4px); }',
    '.btn.busy { opacity: .55; cursor: default; }',
    '@media (prefers-color-scheme: light) {',
    '  .btn.added { background: rgba(255, 255, 255, .82); color: #fb7299; box-shadow: 0 2px 8px rgba(0,0,0,.16); }',
    '}'
  ].join('\n');

  var ICON_PLUS = 'M8 3.2a.8.8 0 0 1 .8.8v3.2h3.2a.8.8 0 0 1 0 1.6H8.8v3.2a.8.8 0 0 1-1.6 0V8.8H4a.8.8 0 0 1 0-1.6h3.2V4a.8.8 0 0 1 .8-.8z';
  var ICON_CHECK = 'M13.1 4.3a.9.9 0 0 1 .1 1.3l-6 7a.9.9 0 0 1-1.3.1L2.8 9.6a.9.9 0 1 1 1.2-1.4l2.4 2.1 5.4-6.2a.9.9 0 0 1 1.3.1z';

  function getBtnSheet() {
    if (btnSheet) return btnSheet;
    try {
      btnSheet = new CSSStyleSheet();
      btnSheet.replaceSync(BTN_CSS);
    } catch (e) {
      btnSheet = null;
    }
    return btnSheet;
  }

  /* 横向卡片（封面只占左侧一条）把按钮钉在封面右上角，竖向卡片钉在整卡右上角 */
  function resolveAnchor(root) {
    var imgs = root.querySelectorAll('img');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < imgs.length; i++) {
      var r = imgs[i].getBoundingClientRect();
      if (r.width * r.height > bestArea) { bestArea = r.width * r.height; best = imgs[i]; }
    }
    if (!best) return root;
    var ir = best.getBoundingClientRect();
    var rr = root.getBoundingClientRect();
    if (!rr.width || ir.width >= rr.width * 0.7) return root;
    var anchor = best.parentElement || root;
    for (var j = 0; j < 3 && anchor.parentElement && anchor.parentElement !== root; j++) {
      var pr = anchor.parentElement.getBoundingClientRect();
      if (pr.width > ir.width + 12) break;
      anchor = anchor.parentElement;
    }
    return anchor;
  }

  function makeSlot(root, anchor, meta) {
    var host = document.createElement('bew-wl-slot');
    host.style.cssText = 'position:absolute;top:6px;right:6px;z-index:30;display:block;line-height:0;';
    var shadow = host.attachShadow({ mode: 'open' });
    var sheet = getBtnSheet();
    if (sheet) {
      shadow.adoptedStyleSheets = [sheet];
    } else {
      var st = document.createElement('style');
      st.textContent = BTN_CSS;
      shadow.appendChild(st);
    }
    var btn = el('button', 'btn');
    btn.type = 'button';
    btn.title = '加入「额外稍后再看」';
    var icon = svgIcon(ICON_PLUS, 12);
    var label = el('span', '', '稍后');
    btn.appendChild(icon);
    btn.appendChild(label);
    shadow.appendChild(btn);

    var slot = { host: host, btn: btn, icon: icon, label: label, meta: meta, busy: false, added: false };

    btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onAdd(slot);
    });

    if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
    host.__slot = slot;
    anchor.appendChild(host);
    root.__bewSlot = host;
    return slot;
  }

  function setAdded(slot, added) {
    slot.added = !!added;
    slot.btn.classList.toggle('added', slot.added);
    slot.label.textContent = slot.added ? '已加入' : '稍后';
    slot.icon.replaceChildren(svgIcon(slot.added ? ICON_CHECK : ICON_PLUS, 12));
    slot.btn.title = slot.added ? '已在当前列表' : '加入当前列表';
  }

  function onAdd(slot) {
    if (slot.busy || !state.data) return;
    slot.busy = true;
    slot.btn.classList.add('busy');
    S.addItem(state.data.activeListId, slot.meta).then(function (res) {
      slot.busy = false;
      slot.btn.classList.remove('busy');
      if (res.ok) {
        setAdded(slot, true);
        toast('已加入「' + res.list.name + '」' + res.count + '/' + res.list.limit, 'ok');
        return reload();
      }
      if (res.code === 'exists') {
        setAdded(slot, true);
        toast('已在「' + res.list.name + '」中', 'warn');
        return;
      }
      if (res.code === 'full') {
        toast('「' + res.list.name + '」已满 ' + res.list.limit + ' 条，请新建列表或清理', 'err');
        flashPill();
        return;
      }
      toast('加入失败：' + res.code, 'err');
    }).catch(function (err) {
      slot.busy = false;
      slot.btn.classList.remove('busy');
      toast('加入失败：' + (err && err.message ? err.message : '未知错误'), 'err');
    });
  }

  function scan() {
    if (!state.data || !document.body) return;
    var links = document.querySelectorAll(VIDEO_LINK);
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.getAttribute('href') || '';
      var id = extractId(href);
      if (!id) continue;
      var root = resolveRoot(link);
      if (!root) continue;
      if (root.__bewSlot) {
        if (!root.__bewSlot.isConnected) {
          root.__bewSlot = null;
        } else {
          var prev = root.__bewSlot.__slot;
          if (prev && prev.meta.bvid === id) continue;
          if (prev) {
            prev.host.remove();
            var at = state.slots.indexOf(prev);
            if (at >= 0) state.slots.splice(at, 1);
          }
          root.__bewSlot = null;
        }
      }
      var rect = root.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 48) continue;
      var slot = makeSlot(root, resolveAnchor(root), readMeta(root, id, link));
      state.slots.push(slot);
      setAdded(slot, !!state.bvids[slot.meta.bvid]);
    }
    document.body.setAttribute('data-bew-slots', String(state.slots.length));
  }

  function refreshStates() {
    for (var i = 0; i < state.slots.length; i++) {
      var slot = state.slots[i];
      if (!slot.host.isConnected) continue;
      setAdded(slot, !!state.bvids[slot.meta.bvid]);
    }
  }

  /* ---------- 胶囊 / 提示 ---------- */

  var PILL_CSS = [
    ':host { all: initial; }',
    '.pill {',
    '  position: fixed; display: flex; align-items: center; gap: 6px;',
    '  height: 36px; padding: 0 6px 0 8px; box-sizing: border-box;',
    '  border-radius: 18px; border: 1px solid rgba(0,0,0,.08);',
    '  background: rgba(255,255,255,.96); color: #18191c;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,.16), 0 1px 3px rgba(0,0,0,.08);',
    '  font: 500 12px/1 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;',
    '  z-index: 2147483000; user-select: none; backdrop-filter: blur(6px);',
    '}',
    '.pill.err-flash { animation: shake .32s ease; }',
    '@keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }',
    '.grip { cursor: grab; color: rgba(0,0,0,.28); letter-spacing: -2px; padding: 0 2px; font-size: 13px; }',
    '.grip:active { cursor: grabbing; }',
    '.dot { width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(135deg,#fb7299,#ff5c8a); flex: none; }',
    'select {',
    '  appearance: none; -webkit-appearance: none; border: 0; outline: 0; background: transparent;',
    '  color: inherit; font: inherit; max-width: 116px; padding: 4px 2px; cursor: pointer;',
    '}',
    'select option { color: #18191c; background: #fff; }',
    '.count { color: rgba(0,0,0,.45); font-variant-numeric: tabular-nums; }',
    '.open {',
    '  border: 0; border-radius: 12px; height: 24px; padding: 0 9px; cursor: pointer;',
    '  background: linear-gradient(135deg,#fb7299,#ff5c8a); color: #fff; font: 600 12px/1 inherit;',
    '}',
    '.open:hover { filter: brightness(1.06); }',
    '.toast {',
    '  position: fixed; left: 50%; bottom: 42px; transform: translate(-50%, 8px);',
    '  max-width: min(420px, 86vw); padding: 9px 14px; border-radius: 10px;',
    '  background: rgba(24,25,28,.94); color: #fff; font: 500 12.5px/1.35 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;',
    '  box-shadow: 0 8px 30px rgba(0,0,0,.28); opacity: 0; pointer-events: none;',
    '  transition: opacity .16s ease, transform .16s ease; z-index: 2147483001;',
    '  word-break: break-word;',
    '}',
    '.toast.show { opacity: 1; transform: translate(-50%, 0); }',
    '.toast.err { background: rgba(196, 42, 66, .96); }',
    '.toast.warn { background: rgba(158, 106, 12, .96); }',
    '@media (prefers-color-scheme: dark) {',
    '  .pill { background: rgba(31,33,38,.96); color: #e7e9ee; border-color: rgba(255,255,255,.1); box-shadow: 0 6px 24px rgba(0,0,0,.5); }',
    '  .grip { color: rgba(255,255,255,.32); }',
    '  .count { color: rgba(255,255,255,.55); }',
    '  select option { color: #e7e9ee; background: #1f2126; }',
    '  .toast { background: rgba(240,242,246,.96); color: #18191c; }',
    '  .toast.err { background: rgba(214, 60, 84, .97); color: #fff; }',
    '  .toast.warn { background: rgba(206, 146, 24, .97); color: #1b1d21; }',
    '}'
  ].join('\n');

  var pillPos = loadPillPos();

  function loadPillPos() {
    try {
      var raw = localStorage.getItem(PILL_POS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y };
    } catch (e) { /* 位置信息损坏时退回默认位置 */ }
    return null;
  }

  function savePillPos(pos) {
    try { localStorage.setItem(PILL_POS_KEY, JSON.stringify(pos)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function clampPill(pos) {
    var w = 96, h = 36;
    return {
      x: Math.min(Math.max(8, pos.x), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(8, pos.y), Math.max(8, window.innerHeight - h - 8))
    };
  }

  function placePill() {
    if (!ui.pill) return;
    var pos = pillPos || { x: window.innerWidth - 260, y: window.innerHeight - 64 };
    pos = clampPill(pos);
    ui.pill.style.left = Math.round(pos.x) + 'px';
    ui.pill.style.top = Math.round(pos.y) + 'px';
  }

  function buildUi() {
    ui.host = document.createElement('bew-wl-ui');
    ui.host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;';
    ui.shadow = ui.host.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent = PILL_CSS;
    ui.shadow.appendChild(st);

    var pill = el('div', 'pill');
    var grip = el('span', 'grip', '⠿');
    grip.title = '拖动';
    var dot = el('span', 'dot');
    var sel = document.createElement('select');
    sel.title = '选择要加入的列表';
    var count = el('span', 'count', '0/1000');
    var open = el('button', 'open', '管理');
    open.type = 'button';
    open.title = '打开管理页';
    pill.appendChild(grip);
    pill.appendChild(dot);
    pill.appendChild(sel);
    pill.appendChild(count);
    pill.appendChild(open);

    var toastNode = el('div', 'toast');

    ui.shadow.appendChild(pill);
    ui.shadow.appendChild(toastNode);
    document.body.appendChild(ui.host);

    ui.pill = pill;
    ui.sel = sel;
    ui.count = count;
    ui.toast = toastNode;
    placePill();

    open.addEventListener('click', openManager);
    sel.addEventListener('change', function () {
      S.setActiveList(sel.value).then(reload);
    });

    var drag = null;
    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      drag = { dx: e.clientX - pill.getBoundingClientRect().left, dy: e.clientY - pill.getBoundingClientRect().top };
    });
    grip.addEventListener('pointermove', function (e) {
      if (!drag) return;
      pillPos = clampPill({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
      placePill();
    });
    grip.addEventListener('pointerup', function (e) {
      if (!drag) return;
      drag = null;
      try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放 */ }
      if (pillPos) savePillPos(pillPos);
    });
    window.addEventListener('resize', function () { placePill(); });
  }

  function openManager() {
    try {
      chrome.runtime.sendMessage({ type: 'bew-open-manager' }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      window.open(chrome.runtime.getURL('manager.html'), '_blank');
    }
  }

  function flashPill() {
    if (!ui.pill) return;
    ui.pill.classList.remove('err-flash');
    void ui.pill.offsetWidth;
    ui.pill.classList.add('err-flash');
  }

  function toast(msg, kind) {
    if (!ui.toast) return;
    ui.toast.textContent = msg;
    ui.toast.className = 'toast show' + (kind && kind !== 'ok' ? ' ' + kind : '');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () {
      ui.toast.className = 'toast';
    }, 2000);
  }

  function renderPill() {
    if (!ui.sel || !state.data) return;
    var data = state.data;
    var active = data.activeListId;
    var frag = document.createDocumentFragment();
    data.lists.forEach(function (l) {
      var o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.name;
      o.title = l.name + '（' + (data.items[l.id] || []).length + '/' + l.limit + '）';
      if (l.id === active) o.selected = true;
      frag.appendChild(o);
    });
    ui.sel.replaceChildren(frag);
    var arr = data.items[active] || [];
    ui.count.textContent = arr.length + '/' + (data.lists.filter(function (l) { return l.id === active; })[0] || { limit: S.DEFAULT_LIMIT }).limit;
  }

  function reload() {
    return S.readAll().then(function (data) {
      state.data = data;
      var map = Object.create(null);
      (data.items[data.activeListId] || []).forEach(function (it) { map[it.bvid] = 1; });
      state.bvids = map;
      renderPill();
      refreshStates();
      scan();
    });
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(function () { scan(); }, 400);
  }

  function boot() {
    buildUi();
    reload().then(function () {
      var obs = new MutationObserver(scheduleScan);
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('popstate', scheduleScan);
      var lastHref = location.href;
      setInterval(function () {
        if (location.href !== lastHref) {
          lastHref = location.href;
          scheduleScan();
        }
      }, 1200);
      try {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area === 'local' && changes[S.KEY]) reload();
        });
      } catch (e) { /* 扩展上下文失效（更新后未刷新页面）时停止监听 */ }
    }).catch(function (err) {
      if (ui.count) ui.count.textContent = '加载失败';
      console.error('[额外稍后再看] 初始化失败', err);
    });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
