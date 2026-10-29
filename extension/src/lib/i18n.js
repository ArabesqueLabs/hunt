// The extension in its account's language: English, or Arabic (right to
// left), as hunt says the account is in (or, before it's said, the
// browser's). Its text is written in English in the pages, marked with
// data-i18n (the text), data-i18n-label (aria-label and title) and
// data-i18n-placeholder; Arabic is looked up by the English, as hunt's
// own web UI does (src/web/src/lib/i18n-ar.ts).

const AR = {
  'Send to hunt': 'أرسل إلى hunt',
  'Settings': 'الإعدادات',
  'Close this popup': 'أغلق هذه النافذة',
  'Connect your hunt first': 'اربط hunt أولًا',
  'Give the extension your hunt’s address and a token from hunt’s Settings → Connected apps.':
    'أعطِ الإضافة عنوان hunt ورمزًا من الإعدادات ← التطبيقات المتصلة في hunt.',
  'Open settings': 'افتح الإعدادات',
  'Title': 'العنوان',
  'Note': 'ملاحظة',
  '(optional)': '(اختياري)',
  'What you selected on the page is here already.': 'ما حدّدته في الصفحة موجود هنا.',
  'Keep the page’s link': 'احتفظ برابط الصفحة',
  'Keep in stash': 'احفظ في الحافظة',
  'Kept in your stash': 'حُفظ في حافظتك',
  'Sort it in hunt': 'رتّبه في hunt',
  'To': 'إلى',
  'Open hunt to sign in': 'افتح hunt لتسجيل الدخول',
  'hunt didn’t take the token: it may have been revoked. Make a new one in hunt’s Settings → Connected apps.':
    'لم يقبل hunt الرمز: ربما أُلغي. أنشئ رمزًا جديدًا من الإعدادات ← التطبيقات المتصلة في hunt.',
  'The browser hasn’t allowed the extension to reach your hunt. Connect it again in the settings.':
    'لم يسمح المتصفح للإضافة بالوصول إلى hunt. اربطه من جديد في الإعدادات.',
  'Your hunt is behind Cloudflare Access: sign in to it in this browser, then try again.':
    'hunt خلف Cloudflare Access: سجّل الدخول إليه في هذا المتصفح، ثم أعد المحاولة.',
  'Couldn’t reach your hunt. Is it running, at the address in the settings?':
    'تعذّر الوصول إلى hunt. هل يعمل على العنوان الموجود في الإعدادات؟',

  // The settings page.
  'hunt settings': 'إعدادات «hunt»',
  'Your hunt': 'hunt الخاص بك',
  'hunt’s address': 'عنوان hunt',
  'Where you open hunt: https://hunt.example.com, or http://localhost:4848.':
    // No full stop after the address: right to left, it would land before it.
    'حيث تفتح hunt: https://hunt.example.com أو http://localhost:4848',
  'Token': 'الرمز',
  'Make one in hunt: Settings → Connected apps → New token. One that adds to your stash is enough.':
    'أنشئه في hunt: الإعدادات ← التطبيقات المتصلة ← رمز جديد. يكفي رمز يضيف إلى حافظتك.',
  'Connect': 'اربط',
  'Connecting…': 'جارٍ الربط…',
  'Disconnect': 'افصل',
  'Behind Cloudflare Access': 'خلف Cloudflare Access',
  'If your hunt is behind Cloudflare Access, the extension gets in with your sign-in to it in this browser. Or give it a service token (a Service Auth policy lets it in), and it gets in without one.':
    'إن كان hunt خلف Cloudflare Access، تدخل الإضافة بتسجيل دخولك إليه في هذا المتصفح. أو أعطها رمز خدمة (تسمح له سياسة Service Auth بالدخول)، فتدخل من دونه.',
  'Client ID': 'معرّف العميل',
  'Client secret': 'سرّ العميل',
  'Keyboard shortcuts': 'اختصارات لوحة المفاتيح',
  'Open hunt': 'افتح «hunt»',
  'Keep the page you’re on in your stash, at once': 'احفظ الصفحة الحالية في حافظتك فورًا',
  'none set': 'غير محدّد',
  'Change them': 'غيّرها',
  'In the right-click menu': 'في قائمة النقر بالزر الأيمن',
  'Right-click a page, a link, an image or what you’ve selected: Stash to your hunt.':
    'انقر بالزر الأيمن على صفحة أو رابط أو صورة أو نص محدّد: «hunt» يحفظه في حافظتك.',
  'Give hunt’s address, as you open it.': 'أدخل عنوان hunt كما تفتحه.',
  'Give a token from hunt.': 'أدخل رمزًا من hunt.',
  'That isn’t a token from hunt: they start with hunt_.': 'هذا ليس رمزًا من hunt: رموزه تبدأ بـ hunt_.',
  'The browser wasn’t allowed to reach that address, so the extension isn’t connected.':
    'لم يُسمح للمتصفح بالوصول إلى هذا العنوان، فلم تُربط الإضافة.',
  'Connected': 'متصل',
  'Not connected': 'غير متصل',
  'Connected to {x}': 'متصل بـ {x}',
  'That isn’t hunt’s address: give it as you open hunt, like https://hunt.example.com.':
    'هذا ليس عنوان hunt: أدخله كما تفتح hunt، مثل https://hunt.example.com.',
  'Disconnected. The token still works until you revoke it in hunt.':
    'فُصلت. يبقى الرمز صالحًا حتى تلغيه في hunt.',

  // The right-click menu, and the toolbar button.
  'Send this page to hunt': 'أرسل هذه الصفحة إلى hunt',
  'Send this link to hunt': 'أرسل هذا الرابط إلى hunt',
  'Send this image to hunt': 'أرسل هذه الصورة إلى hunt',
  'Send the selection to hunt': 'أرسل النص المحدّد إلى hunt',
  'An image on {x}': 'صورة في {x}',
  'Only web pages can be kept.': 'لا يُحفظ إلا صفحات الويب.',

  // Someone's LinkedIn profile.
  'Add this person to hunt': 'أضف هذا الشخص إلى hunt',
  'Someone’s LinkedIn profile': 'ملف شخص على LinkedIn',
  'hunt opens with what it found on it: their name, role, company, location, about and photo. Tick what to keep.':
    'يُفتح hunt بما وجده فيه: الاسم والدور والشركة والموقع والنبذة والصورة. اختر ما تحتفظ به.',
  'Add to hunt’s people': 'أضف إلى أشخاص hunt',
  'Couldn’t read this profile. Let the page finish loading, then try again.':
    'تعذّرت قراءة هذا الملف. انتظر حتى تكتمل الصفحة، ثم أعد المحاولة.',

  // What hunt thinks something could become.
  'It’s in hunt already: {x}.': 'إنه في hunt بالفعل: {x}.',
  'It looks like a job posting: it could be an application.': 'يبدو أنه إعلان وظيفة: يمكن أن يصبح طلبًا.',
  'It looks like someone’s profile: they could be a person in hunt.': 'يبدو أنه ملف شخص: يمكن إضافته إلى الأشخاص.',
  'It looks like a company’s page: it could be a company in hunt.': 'يبدو أنه صفحة شركة: يمكن إضافتها إلى الشركات.',
  'It could go with {x}.': 'يمكن أن يُضاف إلى {x}.',
  'It could be a task, to read or watch.': 'يمكن أن يصبح مهمة للقراءة أو المشاهدة.',
  'It could be a note.': 'يمكن أن يصبح ملاحظة.',
};

let language = 'en';

/** Text in the extension's language: `{x}` filled in with `x`. */
export function t(text, x) {
  const said = (language === 'ar' && AR[text]) || text;
  return x === undefined ? said : said.replace('{x}', x);
}

/** Text from now on in `lang` (hunt's code for it; empty: the browser's). */
export function setLanguage(lang) {
  const browser = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'en';
  language = (lang || browser).toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/**
 * The page in `lang` (hunt's language code for the account; empty: the
 * browser's). Can be called again when hunt says the language has changed.
 */
export function localise(root, lang) {
  setLanguage(lang);
  const html = root.documentElement;
  html.lang = language;
  html.dir = language === 'ar' ? 'rtl' : 'ltr';
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.dataset.i18n = el.dataset.i18n || el.textContent.trim();
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    el.dataset.i18nLabel = el.dataset.i18nLabel || el.getAttribute('aria-label');
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
    if (el.hasAttribute('title')) {
      el.title = t(el.dataset.i18nLabel);
    }
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.dataset.i18nPlaceholder = el.dataset.i18nPlaceholder || el.placeholder;
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  const title = root.querySelector('title');
  if (title) {
    title.dataset.i18n = title.dataset.i18n || title.textContent;
    title.textContent = t(title.dataset.i18n);
  }
}

/**
 * What hunt suggests the item could become, said: in English, hunt's own
 * reason; in Arabic, by what it could become (hunt's reasons are English).
 */
export function suggestionText(s) {
  if (!s || !s.to) {
    return '';
  }
  if (language !== 'ar' && s.why) {
    return s.why + '.';
  }
  const label = s.target && s.target.label;
  switch (s.to) {
    case 'open':
      return label ? t('It’s in hunt already: {x}.', label) : '';
    case 'application':
      return t('It looks like a job posting: it could be an application.');
    case 'person':
      return t('It looks like someone’s profile: they could be a person in hunt.');
    case 'company':
      return t('It looks like a company’s page: it could be a company in hunt.');
    case 'link':
    case 'note':
      return label ? t('It could go with {x}.', label) : t('It could be a note.');
    case 'prep':
      return t('It could be a task, to read or watch.');
    default:
      return t('It could be a note.');
  }
}

/** Why a request to hunt didn't work (a HuntError, from hunt.js), said. */
export function explain(error) {
  const messages = {
    token: t('hunt didn’t take the token: it may have been revoked. Make a new one in hunt’s Settings → Connected apps.'),
    permission: t('The browser hasn’t allowed the extension to reach your hunt. Connect it again in the settings.'),
    access: t('Your hunt is behind Cloudflare Access: sign in to it in this browser, then try again.'),
    unreachable: t('Couldn’t reach your hunt. Is it running, at the address in the settings?'),
  };
  return messages[error && error.kind] || (error && error.message) || String(error);
}
