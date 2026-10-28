// Keeping things without opening the popup: "Send … to hunt" in the menu
// when you right-click a page, a link, an image or a selection, and a
// keyboard shortcut that keeps the page you're on. The toolbar button
// says how it went, for a few seconds: ✓, or ! (its tooltip says why, and
// the settings open when there's nothing to send to yet).
import { connected, load } from './lib/settings.js';
import { keep } from './lib/hunt.js';
import { explain, setLanguage, t } from './lib/i18n.js';

const MENUS = [
  { id: 'send-page', title: 'Send this page to hunt', contexts: ['page', 'frame'] },
  { id: 'send-link', title: 'Send this link to hunt', contexts: ['link'] },
  { id: 'send-image', title: 'Send this image to hunt', contexts: ['image'] },
  { id: 'send-selection', title: 'Send the selection to hunt', contexts: ['selection'] },
];

// How long the toolbar button shows how it went.
const BADGE_MS = 4000;

async function buildMenus() {
  const settings = await load();
  // The menu's words in the account's language.
  setLanguage(settings.language);
  await chrome.contextMenus.removeAll();
  for (const menu of MENUS) {
    chrome.contextMenus.create({ id: menu.id, title: t(menu.title), contexts: menu.contexts });
  }
}

chrome.runtime.onInstalled.addListener(function (details) {
  buildMenus();
  // New: straight to connecting it.
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onStartup.addListener(buildMenus);
// A new language, from hunt: the menu follows.
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.language) {
    buildMenus();
  }
});

/** The toolbar button, for a moment: how it went. */
function badge(tab, ok, why) {
  const target = tab && tab.id !== undefined ? { tabId: tab.id } : {};
  chrome.action.setBadgeBackgroundColor(Object.assign({ color: ok ? '#2f7d4f' : '#b3261e' }, target));
  chrome.action.setBadgeText(Object.assign({ text: ok ? '✓' : '!' }, target));
  chrome.action.setTitle(Object.assign({ title: ok ? t('Kept in your stash') : why }, target));
  setTimeout(function () {
    chrome.action.setBadgeText(Object.assign({ text: '' }, target));
    chrome.action.setTitle(Object.assign({ title: t('Send to hunt') }, target));
  }, BADGE_MS);
}

async function send(tab, capture) {
  const settings = await load();
  setLanguage(settings.language);
  if (!connected(settings)) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    await keep(settings, capture);
    badge(tab, true);
  } catch (error) {
    badge(tab, false, explain(error));
  }
}

/** A tab's page, if it's a web page (not the browser's own). */
function webPage(tab) {
  return tab && tab.url && /^https?:/i.test(tab.url) ? tab.url : null;
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  const pageUrl = info.pageUrl || webPage(tab);
  const pageTitle = (tab && tab.title) || null;
  switch (info.menuItemId) {
    case 'send-page':
      send(tab, { url: info.frameUrl || pageUrl, title: pageTitle });
      break;
    case 'send-link':
      // Firefox says the link's text; Chrome only what's selected.
      send(tab, { url: info.linkUrl, title: info.linkText || info.selectionText || null });
      break;
    case 'send-image':
      send(tab, {
        url: info.srcUrl,
        title: pageTitle,
        body: pageUrl ? t('An image on {x}', pageUrl) : null,
      });
      break;
    case 'send-selection':
      send(tab, { url: pageUrl, title: pageTitle, body: info.selectionText });
      break;
  }
});

chrome.commands.onCommand.addListener(async function (command, tab) {
  if (command !== 'send-page') {
    return;
  }
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  const url = webPage(tab);
  if (url) {
    send(tab, { url, title: tab.title || null });
  } else {
    badge(tab, false, t('Only web pages can be kept.'));
  }
});
