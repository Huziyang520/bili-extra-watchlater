/* 额外稍后再看 · 管理页 */
(function () {
  'use strict';

  var S = window.BEWStore;
  var state = { data: null, activeId: null, q: '', scope: 'list' };
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
  }

  function boot() {
    if (!$('btnExport')) return;
    bind();
    refresh().catch(function (err) {
      toast('读取本地数据失败：' + (err && err.message ? err.message : '未知错误'), 'err');
    });
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[S.KEY]) refresh();
      });
    } catch (e) { /* 非扩展环境（如自动化验证）下跳过 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
