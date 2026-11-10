/* 额外稍后再看 · 本地数据层
 * 被 content.js 与 manager.html 共用；只读写 chrome.storage.local，不发任何网络请求。
 */
(function (global) {
  'use strict';

  var KEY = 'bew_data';
  var SETTINGS_KEY = 'bew_settings';
  var DEFAULT_LIMIT = 1000;
  var MIN_LIMIT = 10;
  var MAX_LIMIT = 5000;
  var DEFAULT_LIST_ID = 'default';
  var MIN_SCALE = 0.7;
  var MAX_SCALE = 1.6;
  var DEFAULT_POS = { x: 2, y: 2 };

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function newListId() {
    return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function defaultData() {
    return {
      v: 1,
      activeListId: DEFAULT_LIST_ID,
      lists: [{ id: DEFAULT_LIST_ID, name: '默认列表', limit: DEFAULT_LIMIT, createdAt: Date.now() }],
      items: { default: [] }
    };
  }

  function slimItem(it) {
    return {
      bvid: String(it.bvid || '').slice(0, 32),
      title: String(it.title || '').slice(0, 300),
      up: String(it.up || '').slice(0, 80),
      cover: String(it.cover || '').slice(0, 500),
      url: String(it.url || '').slice(0, 500),
      duration: String(it.duration || '').slice(0, 16),
      addedAt: Number(it.addedAt) || Date.now()
    };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return defaultData();
    var lists = [];
    var items = {};
    var seen = Object.create(null);
    if (Array.isArray(raw.lists)) {
      raw.lists.forEach(function (l) {
        if (!l || typeof l.id !== 'string' || !l.id || seen[l.id]) return;
        seen[l.id] = 1;
        var limit = parseInt(l.limit, 10);
        if (!isFinite(limit)) limit = DEFAULT_LIMIT;
        var src = (raw.items && Array.isArray(raw.items[l.id])) ? raw.items[l.id] : [];
        var arr = [];
        var ids = Object.create(null);
        src.forEach(function (it) {
          if (!it || typeof it.bvid !== 'string' || !it.bvid || ids[it.bvid]) return;
          ids[it.bvid] = 1;
          arr.push(slimItem(it));
        });
        lists.push({
          id: l.id,
          name: String(l.name || '').trim().slice(0, 40) || '未命名列表',
          limit: clamp(limit, MIN_LIMIT, MAX_LIMIT),
          createdAt: Number(l.createdAt) || Date.now()
        });
        items[l.id] = arr;
      });
    }
    if (!lists.length) return defaultData();
    var active = seen[raw.activeListId] ? raw.activeListId : lists[0].id;
    return { v: 1, activeListId: active, lists: lists, items: items };
  }

  /* ---------- 设置（界面偏好，与列表数据分开存放） ---------- */

  function defaultSettings() {
    return {
      v: 2,
      theme: 'auto',
      card: { x: DEFAULT_POS.x, y: DEFAULT_POS.y, scale: 1, showIcon: true, showLabel: true, showMenu: true, hideNative: false },
      pill: { collapsed: false }
    };
  }

  function normalizeSettings(raw) {
    var d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;
    if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'auto') d.theme = raw.theme;
    var c = raw.card || {};
    var x = Number(c.x);
    var y = Number(c.y);
    var sc = Number(c.scale);
    if (isFinite(x)) d.card.x = clamp(x, 0, 100);
    if (isFinite(y)) d.card.y = clamp(y, 0, 100);
    if (isFinite(sc)) d.card.scale = Math.round(clamp(sc, MIN_SCALE, MAX_SCALE) * 100) / 100;
    ['showIcon', 'showLabel', 'showMenu', 'hideNative'].forEach(function (k) {
      if (typeof c[k] === 'boolean') d.card[k] = c[k];
    });
    if (raw.pill && typeof raw.pill.collapsed === 'boolean') d.pill.collapsed = raw.pill.collapsed;
    /* v1 的默认位置是右下角（98/98）；未改动过位置的旧数据升级到新的左上角默认 */
    if (Number(raw.v) < 2 && d.card.x === 98 && d.card.y === 98) {
      d.card.x = DEFAULT_POS.x;
      d.card.y = DEFAULT_POS.y;
    }
    return d;
  }

  function readSettings() {
    return chrome.storage.local.get(SETTINGS_KEY).then(function (got) {
      return normalizeSettings(got && got[SETTINGS_KEY]);
    });
  }

  function writeSettings(settings) {
    var clean = normalizeSettings(settings);
    var payload = {};
    payload[SETTINGS_KEY] = clean;
    return chrome.storage.local.set(payload).then(function () { return clean; });
  }

  function readAll() {
    return chrome.storage.local.get(KEY).then(function (got) {
      return normalize(got && got[KEY]);
    });
  }

  function writeAll(data) {
    var payload = {};
    payload[KEY] = data;
    return chrome.storage.local.set(payload);
  }

  function findList(data, listId) {
    for (var i = 0; i < data.lists.length; i++) {
      if (data.lists[i].id === listId) return data.lists[i];
    }
    return null;
  }

  /* 返回 {ok:true, code:'added'|'exists', list, count} 或 {ok:false, code:'full'|'bad-list'|'bad-item', list}
   * opts.keepActive=true 时不改变当前选中的列表（三点菜单指定列表时使用） */
  function addItem(listId, item, opts) {
    if (!item || !item.bvid) return Promise.resolve({ ok: false, code: 'bad-item' });
    var keepActive = !!(opts && opts.keepActive);
    return readAll().then(function (data) {
      var list = findList(data, listId || data.activeListId);
      if (!list) return { ok: false, code: 'bad-list' };
      var arr = data.items[list.id] || (data.items[list.id] = []);
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].bvid === item.bvid) {
          return { ok: false, code: 'exists', list: list, count: arr.length };
        }
      }
      if (arr.length >= list.limit) {
        return { ok: false, code: 'full', list: list, count: arr.length };
      }
      var rec = slimItem(item);
      rec.addedAt = Date.now();
      arr.unshift(rec);
      if (!keepActive) data.activeListId = list.id;
      return writeAll(data).then(function () {
        return { ok: true, code: 'added', list: list, count: arr.length };
      });
    });
  }

  function removeItem(listId, bvid) {
    return readAll().then(function (data) {
      var arr = data.items[listId];
      if (!Array.isArray(arr)) return { ok: false, code: 'bad-list' };
      var next = arr.filter(function (it) { return it.bvid !== bvid; });
      if (next.length === arr.length) return { ok: false, code: 'not-found' };
      data.items[listId] = next;
      return writeAll(data).then(function () { return { ok: true, count: next.length }; });
    });
  }

  function createList(name) {
    var clean = String(name || '').trim().slice(0, 40);
    if (!clean) return Promise.resolve({ ok: false, code: 'bad-name' });
    return readAll().then(function (data) {
      for (var i = 0; i < data.lists.length; i++) {
        if (data.lists[i].name === clean) return { ok: false, code: 'dup-name' };
      }
      var list = { id: newListId(), name: clean, limit: DEFAULT_LIMIT, createdAt: Date.now() };
      data.lists.push(list);
      data.items[list.id] = [];
      data.activeListId = list.id;
      return writeAll(data).then(function () { return { ok: true, list: list }; });
    });
  }

  function renameList(listId, name) {
    var clean = String(name || '').trim().slice(0, 40);
    if (!clean) return Promise.resolve({ ok: false, code: 'bad-name' });
    return readAll().then(function (data) {
      var list = findList(data, listId);
      if (!list) return { ok: false, code: 'bad-list' };
      for (var i = 0; i < data.lists.length; i++) {
        if (data.lists[i].id !== listId && data.lists[i].name === clean) {
          return { ok: false, code: 'dup-name' };
        }
      }
      list.name = clean;
      return writeAll(data).then(function () { return { ok: true, list: list }; });
    });
  }

  function setLimit(listId, limit) {
    var n = parseInt(limit, 10);
    if (!isFinite(n)) return Promise.resolve({ ok: false, code: 'bad-limit' });
    return readAll().then(function (data) {
      var list = findList(data, listId);
      if (!list) return { ok: false, code: 'bad-list' };
      var count = (data.items[list.id] || []).length;
      if (n < count) return { ok: false, code: 'below-count', count: count };
      list.limit = clamp(n, MIN_LIMIT, MAX_LIMIT);
      return writeAll(data).then(function () { return { ok: true, list: list }; });
    });
  }

  function deleteList(listId) {
    return readAll().then(function (data) {
      if (data.lists.length <= 1) return { ok: false, code: 'last-list' };
      var idx = -1;
      for (var i = 0; i < data.lists.length; i++) if (data.lists[i].id === listId) idx = i;
      if (idx < 0) return { ok: false, code: 'bad-list' };
      data.lists.splice(idx, 1);
      delete data.items[listId];
      if (data.activeListId === listId) data.activeListId = data.lists[0].id;
      return writeAll(data).then(function () { return { ok: true, activeListId: data.activeListId }; });
    });
  }

  function setActiveList(listId) {
    return readAll().then(function (data) {
      if (!findList(data, listId)) return { ok: false, code: 'bad-list' };
      data.activeListId = listId;
      return writeAll(data).then(function () { return { ok: true }; });
    });
  }

  function stats() {
    return readAll().then(function (data) {
      var total = 0;
      data.lists.forEach(function (l) { total += (data.items[l.id] || []).length; });
      return { lists: data.lists.length, total: total };
    });
  }

  function exportPayload() {
    return readAll().then(function (data) {
      return {
        app: 'bili-extra-watchlater',
        schema: 1,
        exportedAt: new Date().toISOString(),
        lists: data.lists,
        items: data.items
      };
    });
  }

  /* 合并导入：同名列表合并条目（按 bvid 去重），新列表按导出时的名称创建 */
  function importPayload(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.lists)) {
      return Promise.resolve({ ok: false, code: 'bad-file' });
    }
    var incoming = {};
    payload.lists.forEach(function (l) {
      if (!l || !l.id) return;
      var arr = (payload.items && Array.isArray(payload.items[l.id])) ? payload.items[l.id] : [];
      incoming[String(l.name || '').trim() || '未命名列表'] = arr;
    });
    return readAll().then(function (data) {
      var added = 0, skipped = 0, dropped = 0, made = 0;
      Object.keys(incoming).forEach(function (name) {
        var list = null;
        for (var i = 0; i < data.lists.length; i++) {
          if (data.lists[i].name === name) { list = data.lists[i]; break; }
        }
        if (!list) {
          list = { id: newListId(), name: name, limit: DEFAULT_LIMIT, createdAt: Date.now() };
          data.lists.push(list);
          data.items[list.id] = [];
          made++;
        }
        var arr = data.items[list.id];
        var have = Object.create(null);
        arr.forEach(function (it) { have[it.bvid] = 1; });
        incoming[name].forEach(function (it) {
          if (!it || typeof it.bvid !== 'string' || !it.bvid) { skipped++; return; }
          if (have[it.bvid]) { skipped++; return; }
          if (arr.length >= list.limit) { dropped++; return; }
          have[it.bvid] = 1;
          arr.push(slimItem(it));
          added++;
        });
      });
      return writeAll(data).then(function () {
        return { ok: true, added: added, skipped: skipped, dropped: dropped, newLists: made };
      });
    });
  }

  global.BEWStore = {
    KEY: KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    MIN_LIMIT: MIN_LIMIT,
    MAX_LIMIT: MAX_LIMIT,
    MIN_SCALE: MIN_SCALE,
    MAX_SCALE: MAX_SCALE,
    DEFAULT_POS: DEFAULT_POS,
    readAll: readAll,
    writeAll: writeAll,
    addItem: addItem,
    removeItem: removeItem,
    createList: createList,
    renameList: renameList,
    setLimit: setLimit,
    deleteList: deleteList,
    setActiveList: setActiveList,
    stats: stats,
    exportPayload: exportPayload,
    importPayload: importPayload,
    normalize: normalize,
    normalizeSettings: normalizeSettings,
    readSettings: readSettings,
    writeSettings: writeSettings
  };
})(typeof window !== 'undefined' ? window : globalThis);
