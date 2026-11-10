/* 额外稍后再看 · 管理页 */
(function () {
  'use strict';

  var S = window.BEWStore;
  var state = { data: null, activeId: null, q: '', scope: 'list', cfg: null };
  var els = {};
  var toastTimer = 0;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtTime(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function stamp() {
    var d = new Date();
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function toast(msg, kind) {
    els.toast.textContent = msg;
    els.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.className = 'toast'; }, 2600);
  }

  function activeList() {
    if (!state.data) return null;
    for (var i = 0; i < state.data.lists.length; i++) {
      if (state.data.lists[i].id === state.activeId) return state.data.lists[i];
    }
    return state.data.lists[0] || null;
  }

  function itemsOf(listId) {
    return (state.data.items[listId] || []).slice();
  }

  /* ---------- 渲染 ---------- */

  function renderLists() {
    var wrap = els.listUl;
    wrap.replaceChildren();
    var frag = document.createDocumentFragment();
    state.data.lists.forEach(function (list) {
      var count = itemsOf(list.id).length;
      var row = el('li', 'list-row' + (list.id === state.activeId ? ' active' : ''));

      var btn = el('button', 'list-btn');
      btn.type = 'button';
      btn.title = list.name;
      btn.appendChild(el('span', 'list-name', list.name));
      btn.appendChild(el('span', 'list-count', count + ' / ' + list.limit + (count >= list.limit ? ' · 已满' : '')));
      btn.addEventListener('click', function () {
        state.activeId = list.id;
        S.setActiveList(list.id).then(refresh);
      });

      var tools = el('div', 'list-tools');
      var bRename = el('button', 'btn mini', '重命名');
      bRename.type = 'button';
      bRename.addEventListener('click', function () {
        var name = prompt('列表名称（最多 40 字）', list.name);
        if (name == null) return;
        S.renameList(list.id, name).then(function (r) {
          if (!r.ok) return toast(r.code === 'dup-name' ? '已有同名列表' : '名称不能为空', 'err');
          refresh();
        });
      });
      var bLimit = el('button', 'btn mini', '容量');
      bLimit.type = 'button';
      bLimit.addEventListener('click', function () {
        var v = prompt('容量上限（' + S.MIN_LIMIT + '–' + S.MAX_LIMIT + '，当前已用 ' + count + ' 条）', String(list.limit));
        if (v == null) return;
        S.setLimit(list.id, v).then(function (r) {
          if (!r.ok) {
            toast(r.code === 'below-count' ? '不能小于当前条目数（' + r.count + '）' : '请输入 ' + S.MIN_LIMIT + ' 以上的整数', 'err');
            return;
          }
          refresh();
        });
      });
      var bDel = el('button', 'btn mini danger', '删除');
      bDel.type = 'button';
      bDel.addEventListener('click', function () {
        if (state.data.lists.length <= 1) return toast('至少保留一个列表', 'err');
        if (!confirm('删除列表「' + list.name + '」及其 ' + count + ' 条记录？此操作不可撤销。')) return;
        S.deleteList(list.id).then(function (r) {
          if (!r.ok) return toast('删除失败：' + r.code, 'err');
          refresh();
        });
      });

      tools.appendChild(bRename);
      tools.appendChild(bLimit);
      tools.appendChild(bDel);

      row.appendChild(btn);
      row.appendChild(tools);
      frag.appendChild(row);
    });
    wrap.appendChild(frag);
    els.statLists.textContent = String(state.data.lists.length);
  }

  function renderItems() {
    var list = activeList();
    var q = state.q.trim().toLowerCase();
    var rows = [];
    var pool = state.scope === 'all' ? state.data.lists : (list ? [list] : []);

    pool.forEach(function (l) {
      itemsOf(l.id).forEach(function (it) {
        if (q) {
          var hay = (it.title + ' ' + it.bvid + ' ' + (it.up || '')).toLowerCase();
          if (hay.indexOf(q) < 0) return;
        }
        rows.push({ item: it, list: l });
      });
    });

    if (state.scope === 'all' || q) {
      rows.sort(function (a, b) { return (b.item.addedAt || 0) - (a.item.addedAt || 0); });
    }

    var wrap = els.items;
    wrap.replaceChildren();
    var frag = document.createDocumentFragment();

    rows.forEach(function (pair) {
      var it = pair.item;
      var row = el('li', 'row');

      var img = el('img', 'thumb');
      img.loading = 'lazy';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      if (it.cover) img.src = it.cover;
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });

      var info = el('div', 'info');
      var a = el('a', 'title', it.title || it.bvid);
      a.href = it.url || ('https://www.bilibili.com/video/' + it.bvid + '/');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      info.appendChild(a);

      var meta = el('div', 'meta');
      if (state.scope === 'all') meta.appendChild(el('span', 'chip', pair.list.name));
      if (it.up) meta.appendChild(el('span', '', it.up));
      if (it.duration) meta.appendChild(el('span', '', it.duration));
      meta.appendChild(el('span', '', it.bvid));
      meta.appendChild(el('span', '', '加入于 ' + fmtTime(it.addedAt)));
      info.appendChild(meta);

      var tools = el('div', 'row-tools');
      var del = el('button', 'btn mini danger', '删除');
      del.type = 'button';
      del.addEventListener('click', function () {
        S.removeItem(pair.list.id, it.bvid).then(function (r) {
          if (!r.ok) return toast('删除失败：' + r.code, 'err');
          toast('已删除：' + (it.title || it.bvid), 'ok');
          refresh();
        });
      });
      tools.appendChild(del);

      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(tools);
      frag.appendChild(row);
    });

    wrap.appendChild(frag);
    els.empty.classList.toggle('hidden', rows.length > 0);
    var total = state.scope === 'all' ? countAll() : (list ? itemsOf(list.id).length : 0);
    els.range.textContent = '显示 ' + rows.length + ' / ' + total;
  }

  function countAll() {
    var n = 0;
    state.data.lists.forEach(function (l) { n += itemsOf(l.id).length; });
    return n;
  }

  function renderSummary() {
    var total = countAll();
    els.totalHint.textContent = '共 ' + total + ' 条，分布于 ' + state.data.lists.length + ' 个列表';
  }

  var lastBytes = 0;

  function renderStorage() {
    var id = chrome.runtime.id;
    els.extId.textContent = id;
    els.pathChrome.textContent = '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\<配置文件>\\Local Extension Settings\\' + id;
    els.pathEdge.textContent = '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\<配置文件>\\Local Extension Settings\\' + id;
    els.exportPath.textContent = '浏览器默认下载目录（chrome://settings/downloads 可查看或修改）';
    chrome.storage.local.getBytesInUse(null).then(function (b) {
      lastBytes = b || 0;
      els.usage.textContent = (lastBytes / 1024).toFixed(1) + ' KB';
    }).catch(function () {
      els.usage.textContent = '无法读取';
    });
  }

  function refresh() {
    return S.readAll().then(function (data) {
      state.data = data;
      if (!state.activeId || !data.lists.some(function (l) { return l.id === state.activeId; })) {
        state.activeId = data.activeListId || data.lists[0].id;
      }
      renderLists();
      renderItems();
      renderSummary();
      renderStorage();
    });
  }

  /* ---------- 导入导出 ---------- */

  function exportJson() {
    S.exportPayload().then(function (payload) {
      var text = JSON.stringify(payload, null, 2);
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'bili-extra-watchlater-' + stamp() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('已导出 ' + (text.length / 1024).toFixed(1) + ' KB 到浏览器默认下载目录', 'ok');
    }).catch(function (err) {
      toast('导出失败：' + (err && err.message ? err.message : '未知错误'), 'err');
    });
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try {
        payload = JSON.parse(String(reader.result || ''));
      } catch (err) {
        toast('不是有效的 JSON 文件', 'err');
        return;
      }
      S.importPayload(payload).then(function (r) {
        if (!r.ok) return toast('文件结构不认识，需要本扩展导出的备份', 'err');
        var msg = '导入完成：新增 ' + r.added + ' 条，跳过重复 ' + r.skipped + ' 条';
        if (r.newLists) msg += '，新建列表 ' + r.newLists + ' 个';
        if (r.dropped) msg += '；' + r.dropped + ' 条因容量已满未导入';
        toast(msg, r.dropped ? 'err' : 'ok');
        refresh();
      });
    };
    reader.onerror = function () { toast('读取文件失败', 'err'); };
    reader.readAsText(file);
  }

  /* ---------- 设置 ---------- */

  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var saveTimer = 0;
  var CARD_KEY = 'bew.mgr.card';

  function setSettingsCollapsed(collapsed) {
    els.settingsCard.classList.toggle('collapsed', !!collapsed);
    els.settingsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (!collapsed) requestAnimationFrame(renderPreview);
  }

  function applyTheme() {
    var mode = (state.cfg && state.cfg.theme) || 'auto';
    var dark = mode === 'dark' || (mode === 'auto' && mq.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (els.themeSeg) {
      Array.prototype.forEach.call(els.themeSeg.querySelectorAll('.seg-btn'), function (btn) {
        btn.classList.toggle('active', btn.dataset.theme === mode);
      });
    }
  }

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      S.writeSettings(state.cfg).catch(function () {
        toast('设置保存失败', 'err');
      });
    }, 160);
  }

  function show(node, on) {
    if (node) node.style.display = on ? '' : 'none';
  }

  function renderPreview() {
    if (!state.cfg || !els.pvBar) return;
    var c = state.cfg.card;
    var bar = els.pvBar;
    var x = Math.min(100, Math.max(0, c.x));
    var y = Math.min(100, Math.max(0, c.y));
    bar.style.left = x + '%';
    bar.style.top = y + '%';
    bar.style.transform = 'translate(' + (x > 50 ? '-100%' : '0') + ',' + (y > 50 ? '-100%' : '0') + ')';
    bar.style.setProperty('--h', Math.round(26 * c.scale) + 'px');
    show(bar.querySelector('.pv-add svg'), c.showIcon);
    show(bar.querySelector('.pv-label'), c.showLabel);
    var hasAdd = c.showIcon || c.showLabel;
    show(bar.querySelector('.pv-add'), hasAdd);
    show(bar.querySelector('.pv-more'), c.showMenu);
    show(bar.querySelector('.pv-sep'), c.showMenu && hasAdd);
    show(bar, hasAdd || c.showMenu);
  }

  function renderSettings() {
    if (!state.cfg) return;
    var c = state.cfg.card;
    els.optIcon.checked = c.showIcon;
    els.optLabel.checked = c.showLabel;
    els.optMenu.checked = c.showMenu;
    els.optHideNative.checked = c.hideNative;
    els.optScale.value = String(c.scale);
    els.scaleVal.textContent = c.scale.toFixed(2) + '×';
    renderPreview();
    applyTheme();
  }

  function setOption(key, value) {
    if (!state.cfg) return;
    state.cfg.card[key] = value;
    renderSettings();
    saveSettings();
  }

  function bindSettings() {
    els.stage = $('stage');
    els.pvBar = $('pvBar');
    els.settingsCard = $('settingsCard');
    els.settingsToggle = $('settingsToggle');
    els.optIcon = $('optIcon');
    els.optLabel = $('optLabel');
    els.optMenu = $('optMenu');
    els.optHideNative = $('optHideNative');
    els.optScale = $('optScale');
    els.scaleVal = $('scaleVal');
    els.themeSeg = $('themeSeg');
    els.storageCard = $('storageCard');
    els.storageToggle = $('storageToggle');

    els.optIcon.addEventListener('change', function () { setOption('showIcon', els.optIcon.checked); });
    els.optLabel.addEventListener('change', function () { setOption('showLabel', els.optLabel.checked); });
    els.optMenu.addEventListener('change', function () { setOption('showMenu', els.optMenu.checked); });
    els.optHideNative.addEventListener('change', function () { setOption('hideNative', els.optHideNative.checked); });

    els.optScale.addEventListener('input', function () {
      if (!state.cfg) return;
      state.cfg.card.scale = Math.round(Number(els.optScale.value) * 100) / 100;
      renderSettings();
      saveSettings();
    });

    Array.prototype.forEach.call(els.themeSeg.querySelectorAll('.seg-btn'), function (btn) {
      btn.addEventListener('click', function () {
        if (!state.cfg) return;
        state.cfg.theme = btn.dataset.theme;
        applyTheme();
        saveSettings();
      });
    });

    mq.addEventListener('change', function () {
      if (state.cfg && state.cfg.theme === 'auto') applyTheme();
    });

    $('btnResetPos').addEventListener('click', function () {
      if (!state.cfg) return;
      state.cfg.card.x = S.DEFAULT_POS.x;
      state.cfg.card.y = S.DEFAULT_POS.y;
      renderSettings();
      saveSettings();
      toast('位置已恢复为左上角', 'ok');
    });

    els.settingsToggle.addEventListener('click', function () {
      var collapsed = !els.settingsCard.classList.contains('collapsed');
      setSettingsCollapsed(collapsed);
      try { localStorage.setItem(CARD_KEY, collapsed ? '1' : '0'); } catch (err) { /* 隐私模式下忽略 */ }
    });
    /* 默认折叠，只有用户手动展开过才保持展开 */
    try {
      setSettingsCollapsed(localStorage.getItem(CARD_KEY) !== '0');
    } catch (err) {
      setSettingsCollapsed(true);
    }

    els.storageToggle.addEventListener('click', function () {
      var collapsed = els.storageCard.classList.toggle('collapsed');
      els.storageToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });

    bindPreviewDrag();
  }

  /* 在预览里拖动按钮：以按钮中心为锚点写入百分比坐标 */
  function bindPreviewDrag() {
    var bar = els.pvBar;
    var stage = els.stage;
    var drag = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !state.cfg) return;
      e.preventDefault();
      var r = bar.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
      bar.classList.add('dragging');
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* 指针已释放 */ }
    });
    bar.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var sr = stage.getBoundingClientRect();
      var cx = e.clientX - drag.dx + drag.w / 2;
      var cy = e.clientY - drag.dy + drag.h / 2;
      state.cfg.card.x = Math.round(Math.min(100, Math.max(0, (cx - sr.left) / sr.width * 100)) * 10) / 10;
      state.cfg.card.y = Math.round(Math.min(100, Math.max(0, (cy - sr.top) / sr.height * 100)) * 10) / 10;
      renderPreview();
      saveSettings();
    });
    bar.addEventListener('pointerup', function (e) {
      if (!drag) return;
      drag = null;
      bar.classList.remove('dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放 */ }
      saveSettings();
    });
    bar.addEventListener('pointercancel', function () {
      drag = null;
      bar.classList.remove('dragging');
    });
  }

  /* ---------- 绑定 ---------- */

  function bind() {
    els.toast = $('toast');
    els.listUl = $('listUl');
    els.items = $('items');
    els.empty = $('empty');
    els.range = $('range');
    els.search = $('search');
    els.scope = $('scope');
    els.newListName = $('newListName');
    els.statLists = $('statLists');
    els.totalHint = $('totalHint');
    els.extId = $('extId');
    els.pathChrome = $('pathChrome');
    els.pathEdge = $('pathEdge');
    els.usage = $('usage');
    els.exportPath = $('exportPath');

    var searchTimer = 0;
    els.search.addEventListener('input', function () {
      state.q = els.search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderItems, 140);
    });

    els.scope.addEventListener('change', function () {
      state.scope = els.scope.value;
      renderItems();
    });

    var form = $('newListForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = els.newListName.value.trim();
      if (!name) return;
      S.createList(name).then(function (r) {
        if (!r.ok) {
          toast(r.code === 'dup-name' ? '已有同名列表' : '名称不能为空', 'err');
          return;
        }
        els.newListName.value = '';
        state.activeId = r.list.id;
        toast('已新建列表「' + r.list.name + '」', 'ok');
        refresh();
      });
    });

    $('btnExport').addEventListener('click', exportJson);
    $('btnImport').addEventListener('click', function () { $('fileImport').click(); });
    $('fileImport').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importJson(f);
      e.target.value = '';
    });

    $('btnCopyPath').addEventListener('click', function () {
      var text = [
        '扩展 ID: ' + chrome.runtime.id,
        'Chrome: ' + els.pathChrome.textContent,
        'Edge: ' + els.pathEdge.textContent,
        '导出目录: 浏览器默认下载目录（chrome://settings/downloads）'
      ].join('\n');
      var done = function () { toast('路径已复制到剪贴板', 'ok'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { toast('复制失败，请手动选择文本', 'err'); });
      } else {
        toast('当前环境不支持一键复制，请手动选择文本', 'err');
      }
    });

    $('btnImport').title = '合并导入：同名列表按 BV 号去重，不覆盖已有条目';
    bindSettings();
  }

  function boot() {
    if (!$('btnExport')) return;
    bind();
    S.readSettings().then(function (cfg) {
      state.cfg = cfg;
      renderSettings();
    }).catch(function (err) {
      toast('读取设置失败：' + (err && err.message ? err.message : '未知错误'), 'err');
    });
    refresh().catch(function (err) {
      toast('读取本地数据失败：' + (err && err.message ? err.message : '未知错误'), 'err');
    });
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes[S.KEY]) refresh();
        if (changes[S.SETTINGS_KEY]) {
          state.cfg = S.normalizeSettings(changes[S.SETTINGS_KEY].newValue);
          renderSettings();
        }
      });
    } catch (e) { /* 非扩展环境（如自动化验证）下跳过 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
