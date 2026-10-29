import { accessTo, connected, load, originOf, save } from '../lib/settings.js';
import { whoami } from '../lib/hunt.js';
import { explain, localise, t } from '../lib/i18n.js';

const form = document.getElementById('connection');
const server = document.getElementById('server');
const token = document.getElementById('token');
const accessId = document.getElementById('access-id');
const accessSecret = document.getElementById('access-secret');
const access = document.getElementById('access');
const state = document.getElementById('state');
const error = document.getElementById('error');
const connectedBox = document.getElementById('connected');
const connectedText = document.getElementById('connected-text');
const connectButton = document.getElementById('connect');
const disconnect = document.getElementById('disconnect');
const shortcuts = document.getElementById('shortcuts');

let settings = null;

function say(text, kind) {
  state.dataset.state = kind;
  state.textContent = text;
}

function showError(text) {
  error.textContent = text;
  error.hidden = !text;
}

/** How the connection stands, as kept. */
function show() {
  server.value = settings.server;
  token.value = settings.token;
  accessId.value = settings.accessId;
  accessSecret.value = settings.accessSecret;
  access.open = Boolean(settings.accessId || settings.accessSecret);
  const on = connected(settings);
  say(on ? t('Connected') : t('Not connected'), on ? 'saved' : 'failed');
  disconnect.hidden = !on;
  connectedBox.hidden = !on;
  if (on) {
    const host = new URL(settings.server).host;
    connectedText.textContent = t('Connected to {x}', settings.email ? host + ' · ' + settings.email : host);
  }
}

form.addEventListener('submit', function (event) {
  event.preventDefault();
  showError('');
  const origin = originOf(server.value);
  if (!origin) {
    showError(server.value.trim() ? t('That isn’t hunt’s address: give it as you open hunt, like https://hunt.example.com.') : t('Give hunt’s address, as you open it.'));
    server.focus();
    return;
  }
  if (!token.value.trim().startsWith('hunt_')) {
    showError(token.value.trim() ? t('That isn’t a token from hunt: they start with hunt_.') : t('Give a token from hunt.'));
    token.focus();
    return;
  }
  // Asked for in answer to the click, before anything's awaited: the
  // browser allows it only then.
  const asked = chrome.permissions.request(accessTo(origin));
  connect(origin, asked);
});

async function connect(origin, asked) {
  if (!(await asked)) {
    showError(t('The browser wasn’t allowed to reach that address, so the extension isn’t connected.'));
    return;
  }
  const trying = {
    server: origin,
    token: token.value.trim(),
    accessId: accessId.value.trim(),
    accessSecret: accessSecret.value.trim(),
  };
  connectButton.setAttribute('aria-disabled', 'true');
  say(t('Connecting…'), 'saving');
  try {
    const me = await whoami(trying);
    const was = settings.server;
    Object.assign(settings, trying, { email: me.email || '', language: me.language || '' });
    await save(settings);
    // The hunt it was connected to before, no longer reached.
    if (was && was !== origin) {
      chrome.permissions.remove(accessTo(was));
    }
    localise(document, settings.language);
    show();
    showShortcuts();
  } catch (e) {
    showError(explain(e));
    say(connected(settings) ? t('Connected') : t('Not connected'), connected(settings) ? 'saved' : 'failed');
  } finally {
    connectButton.removeAttribute('aria-disabled');
  }
}

disconnect.addEventListener('click', async function () {
  const was = settings.server;
  Object.assign(settings, { token: '', email: '' });
  await save({ token: '', email: '' });
  if (was) {
    chrome.permissions.remove(accessTo(was));
  }
  show();
  say(t('Disconnected. The token still works until you revoke it in hunt.'), 'failed');
  token.focus();
});

// ---- the keyboard shortcuts -------------------------------------------------

// What each does, as said here (the manifest's descriptions are English).
const DOES = {
  _execute_action: 'Open hunt',
  'send-page': 'Stash the page you’re on to your hunt',
};

// Set in the browser's own settings, not here: shown as they stand, with
// the way there. Chrome writes them with +s (Alt+Shift+H), or with symbols
// on a Mac (⌥⇧H).
async function showShortcuts() {
  const commands = await chrome.commands.getAll();
  shortcuts.replaceChildren();
  for (const command of commands) {
    if (!DOES[command.name]) {
      continue;
    }
    const keys = document.createElement('dt');
    if (command.shortcut) {
      keys.append.apply(keys, command.shortcut.split('+').map(function (key) {
        const kbd = document.createElement('kbd');
        kbd.className = 'al-kbd';
        kbd.textContent = key;
        return kbd;
      }));
    } else {
      keys.textContent = t('none set');
    }
    const does = document.createElement('dd');
    does.textContent = t(DOES[command.name]);
    shortcuts.append(keys, does);
  }
}

document.getElementById('change-shortcuts').addEventListener('click', function () {
  if (chrome.commands.openShortcutSettings) {
    chrome.commands.openShortcutSettings();
  } else {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  }
});

// Back from changing them: show what they are now.
window.addEventListener('focus', showShortcuts);

load().then(function (kept) {
  settings = kept;
  localise(document, settings.language);
  show();
  showShortcuts();
});
