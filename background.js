/* 额外稍后再看 · 后台
 * 只做两件事：点击工具栏图标 / 安装时打开管理页；接收内容脚本的「打开管理页」消息。
 * 不发起任何网络请求。
 */
'use strict';

function openManager() {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
}

chrome.action.onClicked.addListener(openManager);

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') openManager();
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'bew-open-manager') {
    openManager();
    sendResponse({ ok: true });
  }
  return false;
});
