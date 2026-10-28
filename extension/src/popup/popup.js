import { connected, load, save } from '../lib/settings.js';
import { keep, page, whoami } from '../lib/hunt.js';
import { bringIn, isProfile } from '../lib/linkedin.js';
import { explain, localise, suggestionText, t } from '../lib/i18n.js';

const form = document.getElementById('form');
const pageLine = document.getElementById('page');
const title = document.getElementById('title');
const note = document.getElementById('note');
const noteHint = document.getElementById('note-hint');
const withLink = document.getElementById('with-link');
const withLinkChoice = document.getElementById('with-link-choice');
const keepButton = document.getElementById('keep');
const done = document.getElementById('done');
const why = document.getElementById('why');
const openStash = document.getElementById('open-stash');
const problem = document.getElementById('problem');
const problemText = document.getElementById('problem-text');
const problemActions = document.getElementById('problem-actions');
const fix = document.getElementById('fix');
const footer = document.getElementById('footer');
const who = document.getElementById('who');
const profile = document.getElementById('profile');
const addPerson = document.getElementById('add-person');

let settings = null;
// The tab the popup was opened on.
let tab = null;
// The page the popup was opened on: its address, if it's a web page's.
let url = null;
let sending = false;

function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}

document.getElementById('settings').addEventListener('click', openSettings);
document.getElementById('connect-open').addEventListener('click', openSettings);
document.getElementById('dismiss').addEventListener('click', function () {
  window.close();
});

// ⌘ on a Mac, Ctrl elsewhere, for sending from the note.
if (/Mac|iPhone|iPad/.test(navigator.platform)) {
  document.getElementById('mod').textContent = '⌘';
}

/** Whom it's sent to: their address, and which hunt. */
function showWho() {
  if (!settings.server) {
    return;
  }
  const host = new URL(settings.server).host;
  who.textContent = settings.email ? settings.email + ' · ' + host : host;
  footer.hidden = false;
}

/** Something in the way: said, with the way round it where there is one. */
function showProblem(error) {
  const ways = {
    token: [t('Open settings'), openSettings],
    permission: [t('Open settings'), openSettings],
    access: [t('Open hunt to sign in'), function () {
      chrome.tabs.create({ url: page(settings, '/stash') });
      window.close();
    }],
  };
  problemText.textContent = explain(error);
  const way = ways[error.kind];
  problemActions.hidden = !way;
  if (way) {
    fix.textContent = way[0];
    fix.onclick = way[1];
  }
  problem.hidden = false;
}

async function send() {
  if (sending) {
    return;
  }
  const capture = {
    url: url && withLink.checked ? url : null,
    title: title.value.trim() || null,
    body: note.value.trim() || null,
  };
  if (!capture.url && !capture.body) {
    note.focus();
    return;
  }
  sending = true;
  keepButton.setAttribute('aria-disabled', 'true');
  problem.hidden = true;
  try {
    const item = await keep(settings, capture);
    form.hidden = true;
    const said = suggestionText(item.suggestion);
    why.textContent = said || '';
    why.hidden = !said;
    openStash.href = page(settings, '/stash');
    done.hidden = false;
    openStash.focus();
  } catch (error) {
    showProblem(error);
  } finally {
    sending = false;
    keepButton.removeAttribute('aria-disabled');
  }
}

addPerson.addEventListener('click', async function () {
  problem.hidden = true;
  try {
    await bringIn(settings, tab);
    window.close();
  } catch (error) {
    showProblem(error);
  }
});

form.addEventListener('submit', function (event) {
  event.preventDefault();
  send();
});
form.addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    send();
  }
});

/** What's selected on the page, where the browser lets the extension read it. */
async function selectionOn(tab) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        return String(getSelection() || '').trim();
      },
    });
    return (result && result.result) || '';
  } catch {
    // The browser's own pages, and the stores', can't be read.
    return '';
  }
}

async function open() {
  settings = await load();
  localise(document, settings.language);
  if (!connected(settings)) {
    document.getElementById('connect').hidden = false;
    return;
  }
  showWho();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const web = tab && tab.url && /^https?:/i.test(tab.url);
  url = web ? tab.url : null;
  pageLine.textContent = url || '';
  pageLine.hidden = !url;
  withLinkChoice.hidden = !url;
  title.value = (web && tab.title) || '';
  const selected = web ? await selectionOn(tab) : '';
  note.value = selected;
  noteHint.hidden = !selected;
  form.hidden = false;
  // On a profile, bringing them in comes first; keeping the page stays.
  const someone = Boolean(url && isProfile(url));
  profile.hidden = !someone;
  keepButton.classList.toggle('al-button--primary', !someone);
  (someone ? addPerson : url ? keepButton : note).focus();

  // Who it is now, and their language, for next time (and this time, if
  // it's changed).
  whoami(settings).then(function (me) {
    const changes = { email: me.email || '', language: me.language || '' };
    if (changes.language !== settings.language) {
      localise(document, changes.language);
    }
    Object.assign(settings, changes);
    save(changes);
    showWho();
  }, function (error) {
    if (error.kind !== 'unreachable') {
      showProblem(error);
    }
  });
}

open();
