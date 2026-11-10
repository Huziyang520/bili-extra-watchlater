/* 额外稍后再看 · 页面内容脚本
 * 在 B 站视频卡片上注入「+ 稍后 / ⋮」胶囊按钮，右下角注入可折叠的列表悬浮球。
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
  /* 站点原版「稍后再看」按钮类名，取自 laputa-home 打包产物：
     .bili-watch-later--wrap / .bili-watch-later（首页卡、播放页推荐）、
     .watch-later（动态卡片、个人空间列表）及其提示气泡。 */
  var NATIVE_CSS = [
    '.bili-watch-later--wrap, .bili-watch-later, .bili-watch-later__tip,',
    '.watch-later, .watch-later--wrap, .watch-later-tip, .watch-later__tip {',
    '  display: none !important;',
    '}'
  ].join('\n');
  var NATIVE_STYLE_ID = 'bew-hide-native';

  var state = {
    data: null,
    bvids: Object.create(null),
    slots: [],
    cfg: S.normalizeSettings(null)
  };
  var ui = { host: null, shadow: null, pill: null, ball: null, sel: null, count: null, countLabel: null, panel: null, panelOpen: false, toast: null, toastTimer: 0, menu: null };
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

  function dotsIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    [3.2, 8, 12.8].forEach(function (y) {
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', '8');
      c.setAttribute('cy', String(y));
      c.setAttribute('r', '1.5');
      c.setAttribute('fill', 'currentColor');
      svg.appendChild(c);
    });
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

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
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
    ':host { display: block; opacity: 0; pointer-events: none; transition: opacity .16s ease; }',
    ':host(.near) { opacity: 1; pointer-events: auto; }',
    '.bar {',
    '  all: initial;',
    '  box-sizing: border-box;',
    '  display: inline-flex; align-items: stretch;',
    '  height: var(--h, 26px); border-radius: calc(var(--h, 26px) / 2); overflow: hidden;',
    '  background: linear-gradient(135deg, #fb7299, #ff5c8a);',
    '  box-shadow: 0 2px 10px rgba(0, 0, 0, .22);',
    '  font: 600 calc(var(--h, 26px) * .46)/1 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;',
    '  color: #fff; opacity: .92; white-space: nowrap;',
    '  transition: opacity .15s ease;',
    '  -webkit-font-smoothing: antialiased;',
    '}',
    '.bar:hover { opacity: 1; }',
    '.bar.added { background: rgba(18, 20, 24, .62); backdrop-filter: blur(4px); }',
    '.bar.busy { opacity: .55; cursor: default; }',
    '.btn, .more {',
    '  all: initial;',
    '  box-sizing: border-box;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  height: 100%; border: 0; background: transparent; color: inherit;',
    '  font: inherit; cursor: pointer; white-space: nowrap;',
    '  transition: background .14s ease;',
    '}',
    '.btn { gap: calc(var(--h, 26px) * .16); padding: 0 calc(var(--h, 26px) * .4); }',
    '.more { padding: 0 calc(var(--h, 26px) * .3); }',
    '.btn:hover, .more:hover { background: rgba(255, 255, 255, .16); }',
    '.btn:active, .more:active { background: rgba(255, 255, 255, .26); }',
    '.btn svg { width: calc(var(--h, 26px) * .46); height: calc(var(--h, 26px) * .46); display: block; }',
    '.more svg { width: calc(var(--h, 26px) * .42); height: calc(var(--h, 26px) * .42); display: block; }',
    '.sep { width: 1px; align-self: center; height: 54%; background: rgba(255, 255, 255, .34); }',
    '[hidden] { display: none !important; }',
    '@media (prefers-color-scheme: light) {',
    '  .bar.added { background: rgba(255, 255, 255, .9); color: #fb7299; box-shadow: 0 2px 8px rgba(0, 0, 0, .16); }',
    '}'
  ].join('\n');

  var ICON_PLUS = 'M8 3.2a.8.8 0 0 1 .8.8v3.2h3.2a.8.8 0 0 1 0 1.6H8.8v3.2a.8.8 0 0 1-1.6 0V8.8H4a.8.8 0 0 1 0-1.6h3.2V4a.8.8 0 0 1 .8-.8z';
  var ICON_CHECK = 'M13.1 4.3a.9.9 0 0 1 .1 1.3l-6 7a.9.9 0 0 1-1.3.1L2.8 9.6a.9.9 0 1 1 1.2-1.4l2.4 2.1 5.4-6.2a.9.9 0 0 1 1.3.1z';
  var ICON_CHEVRON_LEFT = 'M10.4 3.5a.9.9 0 0 1 .4.8v7.4a.9.9 0 0 1-1.5.6L4.6 8.6a.9.9 0 0 1 0-1.2l4.7-3.7a.9.9 0 0 1 1.1-.2z';
  var ICON_CHEVRON_UP = 'M8 4.4l3.5 5.1a.7.7 0 0 1-.6 1.1H5.1a.7.7 0 0 1-.6-1.1L8 4.4z';

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

  /* 找出卡片里的“封面容器”：横向卡片取缩略图所在的窄条，竖向卡片取封面本身。
     按钮最终挂在卡片根节点上（站点 hover 预览会把封面层整层淡出/重建，挂在里面会跟着消失），
     位置再按封面容器的盒子换算成卡片内的像素。 */
  function resolveCover(root) {
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
    if (!rr.width || ir.width >= rr.width * 0.7) {
      var cover = best.parentElement;
      if (!cover || cover === root) return root;
      var cr = cover.getBoundingClientRect();
      var wOk = Math.abs(cr.width - ir.width) <= Math.max(12, ir.width * 0.1);
      var hOk = Math.abs(cr.height - ir.height) <= Math.max(14, ir.height * 0.25);
      return (wOk && hOk) ? cover : root;
    }
    var anchor = best.parentElement || root;
    for (var j = 0; j < 3 && anchor.parentElement && anchor.parentElement !== root; j++) {
      var pr = anchor.parentElement.getBoundingClientRect();
      if (pr.width > ir.width + 12) break;
      anchor = anchor.parentElement;
    }
    return anchor;
  }

  function makeSlot(root, cover, meta) {
    var host = document.createElement('bew-wl-slot');
    host.style.cssText = 'position:absolute;z-index:30;display:block;line-height:0;';
    var shadow = host.attachShadow({ mode: 'open' });
    var sheet = getBtnSheet();
    if (sheet) {
      shadow.adoptedStyleSheets = [sheet];
    } else {
      var st = document.createElement('style');
      st.textContent = BTN_CSS;
      shadow.appendChild(st);
    }

    var bar = el('div', 'bar');
    var btn = el('button', 'btn');
    btn.type = 'button';
    btn.title = '加入当前列表';
    var icon = svgIcon(ICON_PLUS, 12);
    var label = el('span', 'label', '稍后');
    btn.appendChild(icon);
    btn.appendChild(label);
    var sep = el('span', 'sep');
    var more = el('button', 'more');
    more.type = 'button';
    more.title = '选择列表加入';
    more.appendChild(dotsIcon());
    bar.appendChild(btn);
    bar.appendChild(sep);
    bar.appendChild(more);
    shadow.appendChild(bar);

    var slot = {
      host: host, root: root, cover: cover, bar: bar, btn: btn, more: more, sep: sep,
      icon: icon, label: label, meta: meta, busy: false, added: false, near: false
    };

    bar.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onAdd(slot);
    });
    more.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openMenu(slot);
    });

    if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
    host.__slot = slot;
    root.appendChild(host);
    root.__bewSlot = host;
    applyCardStyle(slot);
    return slot;
  }

  /* 位置按封面的百分比保存（0–100）：换算成卡片内的像素，超过一半时贴右/下对齐。
     封面小到不可见（懒加载未出图、hover 预览已换层）时退回卡片自身盒子。 */
  function applyCardStyle(slot) {
    var c = state.cfg.card;
    var x = clamp(c.x, 0, 100);
    var y = clamp(c.y, 0, 100);
    var root = slot.root;
    if (!root || !root.isConnected) return;
    if (!slot.cover || !slot.cover.isConnected) slot.cover = resolveCover(root);
    var box = slot.cover ? slot.cover.getBoundingClientRect() : root.getBoundingClientRect();
    var rb = root.getBoundingClientRect();
    if (!box.width) box = rb;
    slot.host.style.left = Math.round(box.left - rb.left + box.width * x / 100) + 'px';
    slot.host.style.top = Math.round(box.top - rb.top + box.height * y / 100) + 'px';
    slot.host.style.transform = 'translate(' + (x > 50 ? '-100%' : '0') + ',' + (y > 50 ? '-100%' : '0') + ')';
    slot.host.style.setProperty('--h', Math.round(26 * c.scale) + 'px');
    slot.icon.hidden = !c.showIcon;
    slot.label.hidden = !c.showLabel;
    slot.btn.hidden = !(c.showIcon || c.showLabel);
    slot.more.hidden = !c.showMenu;
    slot.sep.hidden = !(c.showMenu && (c.showIcon || c.showLabel));
    slot.host.style.display = (c.showIcon || c.showLabel || c.showMenu) ? '' : 'none';
  }

  function applyCardStyleAll() {
    for (var i = 0; i < state.slots.length; i++) applyCardStyle(state.slots[i]);
  }

  function setAdded(slot, added) {
    slot.added = !!added;
    slot.bar.classList.toggle('added', slot.added);
    slot.label.textContent = slot.added ? '已加入' : '稍后';
    slot.icon.replaceChildren(svgIcon(slot.added ? ICON_CHECK : ICON_PLUS, 12));
    slot.btn.title = slot.added ? '再次点击从当前列表移除' : '加入当前列表';
  }

  function onAdd(slot) {
    if (slot.busy || !state.data) return;
    if (slot.added) {
      onRemove(slot);
      return;
    }
    var activeId = state.data.activeListId;
    slot.busy = true;
    slot.bar.classList.add('busy');
    S.addItem(activeId, slot.meta).then(function (res) {
      slot.busy = false;
      slot.bar.classList.remove('busy');
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
      slot.bar.classList.remove('busy');
      toast('加入失败：' + (err && err.message ? err.message : '未知错误'), 'err');
    });
  }

  /* 再次点击已加入的卡片按钮：从当前列表移除 */
  function onRemove(slot) {
    if (slot.busy || !state.data) return;
    var activeId = state.data.activeListId;
    var list = state.data.lists.filter(function (l) { return l.id === activeId; })[0] || { name: '当前列表' };
    slot.busy = true;
    slot.bar.classList.add('busy');
    S.removeItem(activeId, slot.meta.bvid).then(function (res) {
      slot.busy = false;
      slot.bar.classList.remove('busy');
      if (res.ok) {
        setAdded(slot, false);
        toast('已从「' + list.name + '」移除', 'warn');
        return reload();
      }
      if (res.code === 'not-found') {
        setAdded(slot, false);
        return reload();
      }
      toast('取消失败：' + res.code, 'err');
    }).catch(function (err) {
      slot.busy = false;
      slot.bar.classList.remove('busy');
      toast('取消失败：' + (err && err.message ? err.message : '未知错误'), 'err');
    });
  }

  /* ---------- 三点菜单（加入指定列表，不改悬浮球的选择） ---------- */

  function openMenu(slot) {
    if (!state.data) return;
    closeMenu();
    var menu = el('div', 'menu');
    menu.appendChild(el('div', 'menu-head', '加入列表'));
    state.data.lists.forEach(function (l) {
      var arr = state.data.items[l.id] || [];
      var has = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].bvid === slot.meta.bvid) { has = true; break; }
      }
      var row = el('button', 'menu-row');
      row.type = 'button';
      row.appendChild(el('span', 'menu-name', l.name));
      if (has) row.appendChild(el('span', 'tag', '已在'));
      row.appendChild(el('span', 'menu-count', arr.length + '/' + l.limit));
      if (l.id === state.data.activeListId) row.classList.add('active');
      if (has) row.classList.add('has');
      row.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        addTo(slot, l.id);
      });
      menu.appendChild(row);
    });
    ui.shadow.appendChild(menu);
    ui.menu = menu;
    positionMenu(menu, slot.more.getBoundingClientRect());
  }

  function positionMenu(menu, rect) {
    menu.style.left = '0px';
    menu.style.top = '0px';
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var left = clamp(rect.right - mw, 8, Math.max(8, vw - mw - 8));
    var top = rect.bottom + 6;
    if (top + mh > vh - 8) top = Math.max(8, rect.top - mh - 6);
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function onDocPointerDown(e) {
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (ui.menu && path.indexOf(ui.menu) < 0) closeMenu();
    if (ui.panelOpen && path.indexOf(ui.panel) < 0 && path.indexOf(ui.pill) < 0) closePanel();
  }

  function closeMenu() {
    if (!ui.menu) return;
    ui.menu.remove();
    ui.menu = null;
  }

  /* ---------- 悬浮球上方的当前列表 ---------- */

  function fmtAgo(ts) {
    var d = Date.now() - (Number(ts) || 0);
    if (!isFinite(d) || d < 0) return '';
    if (d < 60 * 1000) return '刚刚';
    if (d < 60 * 60 * 1000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 24 * 60 * 60 * 1000) return Math.floor(d / 3600000) + ' 小时前';
    if (d < 30 * 24 * 60 * 60 * 1000) return Math.floor(d / 86400000) + ' 天前';
    var dt = new Date(Number(ts));
    return dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate();
  }

  function buildPanel() {
    var data = state.data;
    if (!data) return;
    var list = data.lists.filter(function (l) { return l.id === data.activeListId; })[0] || { name: '', limit: S.DEFAULT_LIMIT };
    var arr = (data.items[list.id] || []).slice().sort(function (a, b) {
      return (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0);
    });

    var head = el('div', 'panel-head');
    head.appendChild(el('span', '', list.name || '当前列表'));
    head.appendChild(el('span', 'panel-n', arr.length + '/' + list.limit));

    var body = el('div', 'panel-body');
    if (!arr.length) {
      body.appendChild(el('div', 'panel-empty', '还没有条目，点卡片上的「稍后」加入'));
    }
    arr.forEach(function (it) {
      var a = el('a', 'panel-row');
      a.href = it.url || ('https://www.bilibili.com/video/' + it.bvid + '/');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      var img = el('img');
      img.loading = 'lazy';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      if (it.cover) img.src = it.cover;
      a.appendChild(img);
      var txt = el('div', 'panel-txt');
      txt.appendChild(el('div', 'panel-title', it.title || it.bvid));
      var meta = [it.up, fmtAgo(it.addedAt)].filter(Boolean).join(' · ');
      txt.appendChild(el('div', 'panel-meta', meta));
      a.appendChild(txt);
      body.appendChild(a);
    });

    var foot = el('div', 'panel-foot');
    var open = el('button', '', '打开管理页');
    open.type = 'button';
    open.addEventListener('click', openManager);
    foot.appendChild(open);

    ui.panel.replaceChildren(head, body, foot);
  }

  function placePanel() {
    if (!ui.panel || !ui.panelOpen || !ui.pill) return;
    var p = ui.pill.getBoundingClientRect();
    var w = ui.panel.offsetWidth || 320;
    var h = ui.panel.offsetHeight || 300;
    /* 与胶囊水平居中，靠近视口边缘时贴边 */
    var left = clamp(p.left + (p.width - w) / 2, 8, Math.max(8, window.innerWidth - w - 8));
    var top = p.top - h - 8;
    if (top < 8) top = Math.min(Math.max(8, window.innerHeight - h - 8), p.bottom + 8);
    ui.panel.style.left = Math.round(left) + 'px';
    ui.panel.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  function togglePanel() {
    if (ui.panelOpen) {
      closePanel();
      return;
    }
    if (!state.data || !ui.panel) return;
    closeMenu();
    ui.panelOpen = true;
    buildPanel();
    ui.panel.classList.add('show');
    ui.count.classList.add('open');
    ui.count.title = '收起当前列表';
    placePanel();
  }

  function closePanel() {
    if (!ui.panelOpen) return;
    ui.panelOpen = false;
    ui.panel.classList.remove('show');
    if (ui.count) {
      ui.count.classList.remove('open');
      ui.count.title = '查看当前列表';
    }
  }

  function addTo(slot, listId) {
    closeMenu();
    if (slot.busy || !state.data) return;
    slot.busy = true;
    slot.bar.classList.add('busy');
    S.addItem(listId, slot.meta, { keepActive: true }).then(function (res) {
      slot.busy = false;
      slot.bar.classList.remove('busy');
      if (res.ok) {
        toast('已加入「' + res.list.name + '」' + res.count + '/' + res.list.limit, 'ok');
        return reload();
      }
      if (res.code === 'exists') {
        toast('已在「' + res.list.name + '」中', 'warn');
        return;
      }
      if (res.code === 'full') {
        toast('「' + res.list.name + '」已满 ' + res.list.limit + ' 条，请新建列表或清理', 'err');
        return;
      }
      toast('加入失败：' + res.code, 'err');
    }).catch(function (err) {
      slot.busy = false;
      slot.bar.classList.remove('busy');
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
      var existing = root.__bewSlot;
      var prev = existing ? existing.__slot : null;
      if (prev && prev.meta.bvid === id) {
        /* 卡片内容被站点重建时宿主可能已脱离 DOM，挂回卡片根节点 */
        var reattached = false;
        if (!prev.host.isConnected || !prev.host.parentElement) {
          root.appendChild(prev.host);
          reattached = true;
        }
        root.__bewSlot = prev.host;
        if (reattached) applyCardStyle(prev);
        continue;
      }
      if (prev) {
        prev.host.remove();
        var at = state.slots.indexOf(prev);
        if (at >= 0) state.slots.splice(at, 1);
      }
      root.__bewSlot = null;
      var rect = root.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 48) continue;
      var slot = makeSlot(root, resolveCover(root), readMeta(root, id, link));
      state.slots.push(slot);
      setAdded(slot, !!state.bvids[slot.meta.bvid]);
    }
    document.body.setAttribute('data-bew-slots', String(state.slots.length));
    if (hoverPoint) updateHover();
  }

  /* ---------- 鼠标靠近才显示 ---------- */

  var hoverPoint = null;
  var hoverRaf = 0;

  function updateHover() {
    hoverRaf = 0;
    if (!hoverPoint) return;
    var x = hoverPoint.x;
    var y = hoverPoint.y;
    for (var i = 0; i < state.slots.length; i++) {
      var slot = state.slots[i];
      if (!slot.host.isConnected || !slot.root || !slot.root.isConnected) continue;
      var r = slot.root.getBoundingClientRect();
      var near = x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6;
      if (near !== slot.near) {
        slot.near = near;
        slot.host.classList.toggle('near', near);
      }
    }
  }

  function scheduleHover() {
    if (!hoverPoint || hoverRaf) return;
    hoverRaf = requestAnimationFrame(updateHover);
  }

  function onPointerMove(e) {
    hoverPoint = { x: e.clientX, y: e.clientY };
    scheduleHover();
  }

  function refreshStates() {
    for (var i = 0; i < state.slots.length; i++) {
      var slot = state.slots[i];
      if (!slot.host.isConnected) continue;
      setAdded(slot, !!state.bvids[slot.meta.bvid]);
    }
  }

  /* ---------- 悬浮球 / 提示 ---------- */

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
    '.pill.hide { display: none; }',
    '.pill.err-flash, .ball.err-flash { animation: shake .32s ease; }',
    '@keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }',
    '.grip { cursor: grab; color: rgba(0,0,0,.28); letter-spacing: -2px; padding: 0 2px; font-size: 13px; }',
    '.grip:active { cursor: grabbing; }',
    '.dot { width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(135deg,#fb7299,#ff5c8a); flex: none; }',
    'select {',
    '  appearance: none; -webkit-appearance: none; border: 0; outline: 0; background: transparent;',
    '  color: inherit; font: inherit; max-width: 116px; min-width: 0; padding: 4px 2px; cursor: pointer;',
    '}',
    'select option { color: #18191c; background: #fff; }',
    '.count {',
    '  display: inline-flex; align-items: center; gap: 2px; padding: 4px 3px; border: 0; border-radius: 6px;',
    '  background: transparent; color: rgba(0,0,0,.45); font: inherit; font-variant-numeric: tabular-nums;',
    '  cursor: pointer; flex: none; white-space: nowrap;',
    '}',
    '.count:hover { background: rgba(0,0,0,.05); color: rgba(0,0,0,.72); }',
    '.count svg { width: 10px; height: 10px; display: block; transition: transform .16s ease; }',
    '.count.open svg { transform: rotate(180deg); }',
    '.panel {',
    '  position: fixed; width: 320px; max-width: 92vw; max-height: 340px; display: none;',
    '  flex-direction: column; overflow: hidden;',
    '  border-radius: 12px; border: 1px solid rgba(0,0,0,.08);',
    '  background: rgba(255,255,255,.98); color: #18191c;',
    '  box-shadow: 0 16px 44px rgba(0,0,0,.24), 0 2px 6px rgba(0,0,0,.08);',
    '  font: 500 12px/1.3 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;',
    '  z-index: 2147483001; backdrop-filter: blur(8px);',
    '}',
    '.panel.show { display: flex; }',
    '.panel-head {',
    '  display: flex; align-items: center; justify-content: space-between; gap: 8px;',
    '  padding: 9px 12px 8px; border-bottom: 1px solid rgba(0,0,0,.06);',
    '  font-weight: 600; font-size: 12.5px;',
    '}',
    '.panel-head .panel-n { color: rgba(0,0,0,.4); font-weight: 500; font-variant-numeric: tabular-nums; }',
    '.panel-body { overflow-y: auto; padding: 4px; }',
    '.panel-row { display: flex; gap: 8px; align-items: center; padding: 6px; border-radius: 8px; text-decoration: none; color: inherit; }',
    '.panel-row:hover { background: rgba(251,114,153,.1); }',
    '.panel-row img { width: 72px; height: 41px; object-fit: cover; border-radius: 5px; flex: none; background: rgba(0,0,0,.06); }',
    '.panel-txt { min-width: 0; }',
    '.panel-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 12px; line-height: 1.35; }',
    '.panel-meta { margin-top: 3px; color: rgba(0,0,0,.42); font-size: 11px; }',
    '.panel-empty { padding: 26px 12px; text-align: center; color: rgba(0,0,0,.4); }',
    '.panel-foot { padding: 7px; border-top: 1px solid rgba(0,0,0,.06); display: flex; }',
    '.panel-foot button {',
    '  flex: 1; height: 26px; border: 0; border-radius: 8px; cursor: pointer;',
    '  background: linear-gradient(135deg,#fb7299,#ff5c8a); color: #fff; font: 600 12px/1 inherit;',
    '}',
    '.panel-foot button:hover { filter: brightness(1.06); }',
    '.open, .fold { flex: none; white-space: nowrap; border: 0; height: 24px; cursor: pointer; color: #fff; font: 600 12px/1 inherit; }',
    '.open { border-radius: 12px; padding: 0 9px; background: linear-gradient(135deg,#fb7299,#ff5c8a); }',
    '.open:hover { filter: brightness(1.06); }',
    '.fold {',
    '  width: 24px; padding: 0; border-radius: 12px; background: rgba(0,0,0,.06); color: rgba(0,0,0,.5);',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '}',
    '.fold:hover { background: rgba(0,0,0,.12); }',
    '.fold svg { width: 12px; height: 12px; display: block; }',
    '.ball {',
    '  position: fixed; width: 42px; height: 42px; border-radius: 50%; border: 0; padding: 0;',
    '  display: none; align-items: center; justify-content: center;',
    '  background: linear-gradient(135deg,#fb7299,#ff5c8a); color: #fff;',
    '  font: 700 14px/1 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;',
    '  box-shadow: 0 6px 22px rgba(0,0,0,.22), 0 0 0 1px rgba(255,255,255,.28) inset;',
    '  cursor: pointer; z-index: 2147483000; user-select: none; touch-action: none;',
    '  transition: filter .14s ease;',
    '}',
    '.ball.show { display: flex; }',
    '.ball:hover { filter: brightness(1.06); }',
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
    '.menu {',
    '  position: fixed; min-width: 190px; max-width: 268px; max-height: 320px; overflow-y: auto;',
    '  padding: 6px; border-radius: 12px; border: 1px solid rgba(0,0,0,.08);',
    '  background: rgba(255,255,255,.98); color: #18191c;',
    '  box-shadow: 0 14px 40px rgba(0,0,0,.22), 0 2px 6px rgba(0,0,0,.08);',
    '  font: 500 12.5px/1.3 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;',
    '  z-index: 2147483002; backdrop-filter: blur(8px);',
    '}',
    '.menu-head { padding: 4px 8px 6px; color: rgba(0,0,0,.42); font-size: 11.5px; }',
    '.menu-row {',
    '  display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px;',
    '  border: 0; border-radius: 8px; background: transparent; color: inherit;',
    '  font: inherit; text-align: left; cursor: pointer;',
    '}',
    '.menu-row:hover { background: rgba(251,114,153,.13); }',
    '.menu-row .menu-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.menu-row.active .menu-name { color: #fb7299; font-weight: 700; }',
    '.menu-row .tag { flex: none; font-size: 11px; color: rgba(0,0,0,.38); }',
    '.menu-row .menu-count { flex: none; font-size: 11px; color: rgba(0,0,0,.4); font-variant-numeric: tabular-nums; }',
    '@media (prefers-color-scheme: dark) {',
    '  .pill { background: rgba(31,33,38,.96); color: #e7e9ee; border-color: rgba(255,255,255,.1); box-shadow: 0 6px 24px rgba(0,0,0,.5); }',
    '  .grip { color: rgba(255,255,255,.32); }',
    '  .count { color: rgba(255,255,255,.55); }',
    '  .count:hover { background: rgba(255,255,255,.08); color: #fff; }',
    '  .panel { background: rgba(31,33,38,.98); color: #e7e9ee; border-color: rgba(255,255,255,.12); box-shadow: 0 16px 44px rgba(0,0,0,.6); }',
    '  .panel-head { border-color: rgba(255,255,255,.1); }',
    '  .panel-head .panel-n { color: rgba(255,255,255,.45); }',
    '  .panel-row:hover { background: rgba(251,114,153,.18); }',
    '  .panel-row img { background: rgba(255,255,255,.08); }',
    '  .panel-meta { color: rgba(255,255,255,.45); }',
    '  .panel-empty { color: rgba(255,255,255,.45); }',
    '  .panel-foot { border-color: rgba(255,255,255,.1); }',
    '  .fold { background: rgba(255,255,255,.1); color: rgba(255,255,255,.7); }',
    '  .fold:hover { background: rgba(255,255,255,.18); }',
    '  select option { color: #e7e9ee; background: #1f2126; }',
    '  .toast { background: rgba(240,242,246,.96); color: #18191c; }',
    '  .toast.err { background: rgba(214, 60, 84, .97); color: #fff; }',
    '  .toast.warn { background: rgba(206, 146, 24, .97); color: #1b1d21; }',
    '  .menu { background: rgba(31,33,38,.98); color: #e7e9ee; border-color: rgba(255,255,255,.12); box-shadow: 0 14px 40px rgba(0,0,0,.6); }',
    '  .menu-head { color: rgba(255,255,255,.45); }',
    '  .menu-row:hover { background: rgba(251,114,153,.22); }',
    '  .menu-row .tag { color: rgba(255,255,255,.42); }',
    '  .menu-row .menu-count { color: rgba(255,255,255,.45); }',
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

  function clampPill(pos, node) {
    var w = (node && node.offsetWidth) || 96;
    var h = (node && node.offsetHeight) || 36;
    return {
      x: clamp(pos.x, 8, Math.max(8, window.innerWidth - w - 8)),
      y: clamp(pos.y, 8, Math.max(8, window.innerHeight - h - 8))
    };
  }

  function placePill() {
    var mini = !!(ui.ball && ui.ball.classList.contains('show'));
    var node = mini ? ui.ball : ui.pill;
    if (!node) return;
    var w = node.offsetWidth || (mini ? 42 : 200);
    var h = node.offsetHeight || (mini ? 42 : 36);
    var pos = pillPos || { x: window.innerWidth - w - 20, y: window.innerHeight - h - 24 };
    pos = clampPill(pos, node);
    node.style.left = Math.round(pos.x) + 'px';
    node.style.top = Math.round(pos.y) + 'px';
    if (ui.panelOpen) placePanel();
  }

  function applyCollapsed() {
    if (!ui.pill) return;
    var mini = !!state.cfg.pill.collapsed;
    ui.pill.classList.toggle('hide', mini);
    ui.ball.classList.toggle('show', mini);
    if (mini) closePanel();
    placePill();
  }

  function setCollapsed(mini) {
    if (state.cfg.pill.collapsed !== mini) {
      state.cfg.pill.collapsed = mini;
      S.writeSettings(state.cfg).catch(function () { /* 存储失败不影响本次折叠 */ });
    }
    applyCollapsed();
  }

  function bindDrag(node, onTap) {
    var drag = null;
    node.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var r = node.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
      try { node.setPointerCapture(e.pointerId); } catch (err) { /* 指针已释放 */ }
      e.preventDefault();
    });
    node.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.sx) < 5 && Math.abs(e.clientY - drag.sy) < 5) return;
      drag.moved = true;
      pillPos = clampPill({ x: e.clientX - drag.ox, y: e.clientY - drag.oy }, node);
      placePill();
    });
    node.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      try { node.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放 */ }
      if (moved) {
        if (pillPos) savePillPos(pillPos);
      } else if (onTap) {
        onTap();
      }
    });
    node.addEventListener('pointercancel', function () { drag = null; });
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
    var count = el('button', 'count');
    count.type = 'button';
    count.title = '查看当前列表';
    var countLabel = el('span', 'count-txt', '0/1000');
    count.appendChild(countLabel);
    count.appendChild(svgIcon(ICON_CHEVRON_UP, 10));
    var open = el('button', 'open', '管理');
    open.type = 'button';
    open.title = '打开管理页';
    var fold = el('button', 'fold');
    fold.type = 'button';
    fold.title = '收起悬浮球';
    fold.appendChild(svgIcon(ICON_CHEVRON_LEFT, 12));
    pill.appendChild(grip);
    pill.appendChild(dot);
    pill.appendChild(sel);
    pill.appendChild(count);
    pill.appendChild(open);
    pill.appendChild(fold);

    var ball = el('button', 'ball', '稍');
    ball.type = 'button';
    ball.title = '展开「额外稍后再看」';

    var toastNode = el('div', 'toast');
    var panel = el('div', 'panel');

    ui.shadow.appendChild(pill);
    ui.shadow.appendChild(ball);
    ui.shadow.appendChild(panel);
    ui.shadow.appendChild(toastNode);
    document.body.appendChild(ui.host);

    ui.pill = pill;
    ui.ball = ball;
    ui.sel = sel;
    ui.count = count;
    ui.countLabel = countLabel;
    ui.panel = panel;
    ui.toast = toastNode;

    count.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });
    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener('scroll', function () {
      closeMenu();
      closePanel();
    }, true);
    window.addEventListener('resize', function () {
      closeMenu();
      closePanel();
      placePill();
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenu();
        closePanel();
      }
    });

    open.addEventListener('click', openManager);
    sel.addEventListener('change', function () {
      S.setActiveList(sel.value).then(reload);
    });
    fold.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setCollapsed(true);
    });
    bindDrag(grip, null);
    bindDrag(ball, function () { setCollapsed(false); });
    applyCollapsed();
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
    var node = state.cfg.pill.collapsed ? ui.ball : ui.pill;
    if (!node) return;
    node.classList.remove('err-flash');
    void node.offsetWidth;
    node.classList.add('err-flash');
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
    var list = data.lists.filter(function (l) { return l.id === active; })[0] || { limit: S.DEFAULT_LIMIT, name: '' };
    var arr = data.items[active] || [];
    ui.countLabel.textContent = arr.length + '/' + list.limit;
    if (ui.panelOpen) buildPanel();
    placePill();
    if (ui.ball) {
      ui.ball.title = '「额外稍后再看」当前列表：' + list.name + '（' + arr.length + '/' + list.limit + '）';
    }
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

  /* 节流而不是防抖：hover 预览会连续触发突变，防抖会让扫描一直不执行 */
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      scan();
    }, 400);
  }

  /* ---------- 设置 ---------- */

  function applyNativeHide() {
    var st = document.getElementById(NATIVE_STYLE_ID);
    if (state.cfg.card.hideNative) {
      if (!st) {
        st = document.createElement('style');
        st.id = NATIVE_STYLE_ID;
        st.textContent = NATIVE_CSS;
        (document.head || document.documentElement).appendChild(st);
      }
    } else if (st) {
      st.remove();
    }
  }

  function applySettings(raw) {
    state.cfg = S.normalizeSettings(raw);
    applyNativeHide();
    applyCardStyleAll();
    if (ui.pill) {
      applyCollapsed();
      renderPill();
    }
  }

  function boot() {
    S.readSettings().then(function (cfg) {
      state.cfg = cfg;
      buildUi();
      applyNativeHide();
      return reload();
    }).then(function () {
      var obs = new MutationObserver(scheduleScan);
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('popstate', scheduleScan);
      window.addEventListener('resize', applyCardStyleAll);
      document.addEventListener('pointerover', scheduleScan, true);
      document.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('scroll', scheduleHover, true);
      window.addEventListener('resize', scheduleHover);
      /* 触摸/无悬停设备没有 pointermove，直接常显 */
      try {
        if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
          for (var si = 0; si < state.slots.length; si++) state.slots[si].host.classList.add('near');
        }
      } catch (e) { /* 忽略 */ }
      /* 兜底：站点重建卡片内容后即使没有突变事件也能补回按钮 */
      setInterval(scheduleScan, 2500);
      var lastHref = location.href;
      setInterval(function () {
        if (location.href !== lastHref) {
          lastHref = location.href;
          scheduleScan();
        }
      }, 1200);
      try {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local') return;
          if (changes[S.KEY]) reload();
          if (changes[S.SETTINGS_KEY]) applySettings(changes[S.SETTINGS_KEY].newValue);
        });
      } catch (e) { /* 扩展上下文失效（更新后未刷新页面）时停止监听 */ }
    }).catch(function (err) {
      if (ui.countLabel) ui.countLabel.textContent = '加载失败';
      console.error('[额外稍后再看] 初始化失败', err);
    });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
