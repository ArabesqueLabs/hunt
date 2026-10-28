// Someone's LinkedIn profile, brought into hunt. LinkedIn only shows a
// profile to people signed in, so hunt can't read one itself: the extension
// collects the profile's text from the page open in the browser, and opens
// hunt with it (/linkedin?d=…), where hunt reads it and you tick what to
// keep. It only collects text: reading it is hunt's, so when LinkedIn
// changes its pages, hunt changes, not the extension.
import { page } from './hunt.js';
import { t } from './i18n.js';

/** Whether an address is someone's LinkedIn profile. */
export function isProfile(url) {
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/.test(u.hostname) && /^\/in\//.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Run in the profile's page, so it can't use anything outside itself: its
 * name, the card at the top, about, experience, current company and photo.
 */
function collect() {
  const text = (el) => ((el && el.innerText) || '').trim();
  const name = document.querySelector('main h1') || document.querySelector('h1');
  const top = name && (name.closest('section') || name.parentElement);
  const section = (id) => {
    const anchor = document.getElementById(id);
    return anchor && anchor.closest('section');
  };
  // The biggest of LinkedIn's photos of them, in the card at the top.
  let photo = { src: '', width: 0 };
  if (top) {
    for (const img of top.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || '';
      const width = img.naturalWidth || 1;
      const theirs = /profile-displayphoto|profile-framedphoto/.test(src) || (name && img.alt && img.alt.includes(text(name)));
      if (/licdn\.com/.test(src) && width >= photo.width && theirs) {
        photo = { src, width };
      }
    }
  }
  const company = document.querySelector('[aria-label^="Current company"]');
  return {
    url: location.href.split('?')[0],
    title: document.title,
    name: text(name),
    top: text(top).slice(0, 3000),
    about: text(section('about')).slice(0, 4000),
    experience: text(section('experience')).slice(0, 2500),
    company: company ? company.getAttribute('aria-label') || '' : '',
    photo: photo.src,
  };
}

/** Bring the profile open in `tab` into hunt: hunt opens beside it, with what it found. */
export async function bringIn(settings, tab) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collect });
  const profile = result && result.result;
  if (!profile || !profile.name) {
    throw new Error(t('Couldn’t read this profile. Let the page finish loading, then try again.'));
  }
  await chrome.tabs.create({
    url: page(settings, '/linkedin?d=' + encodeURIComponent(JSON.stringify(profile))),
    index: tab.index + 1,
  });
}
