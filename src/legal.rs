//! Who runs a hunt, and the pages the law asks of a service: the privacy
//! notice and terms of use (`/privacy`, `/terms`), and the footer under
//! every page.
//!
//! hunt is free software (the GNU AGPL v3), made by Arabesque Labs, who also
//! run it for others. Whoever runs a hunt is responsible for it, so the
//! legal pages and a company's registered details only appear when its
//! operator says who they are, with `HUNT_LEGAL_*` (see
//! [`Site::from_env`]); Arabesque Labs' hosted hunt sets theirs. Without
//! them, as for someone running hunt for themselves, the footer just says
//! who made hunt, and where its source is. Either way it links to the
//! source, as the AGPL asks of a service people use over a network.
//!
//! The pages need no sign-in: they're for reading before signing up too.

use crate::error::{Error, Result};

/// When the privacy notice and terms last changed: shown on them, and kept
/// with an account when its holder agrees to the terms.
pub const UPDATED: &str = "2026-10-08";
const UPDATED_WORDS: &str = "8 October 2026";
const UPDATED_WORDS_AR: &str = "8 أكتوبر 2026";
/// Where hunt's source is: the footer's link, unless `HUNT_SOURCE_URL` (a
/// changed copy's, say) is set.
pub const SOURCE: &str = "https://github.com/ArabesqueLabs/hunt";
/// When hunt was first published, for its copyright line.
const FIRST_YEAR: i16 = 2026;

/// The site's languages: English, and Arabic (right to left) under `/ar/`.
/// The app's own language is each person's setting; this is the public
/// site's, chosen by its address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    Ar,
}

impl Lang {
    /// A page's address in this language: "/docs" → "/ar/docs", "/" → "/ar/".
    pub fn path(self, path: &str) -> String {
        match (self, path) {
            (Lang::En, _) => path.to_string(),
            (Lang::Ar, "/") => "/ar/".to_string(),
            (Lang::Ar, _) => format!("/ar{path}"),
        }
    }

    fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Ar => "ar",
        }
    }

    fn dir(self) -> &'static str {
        match self {
            Lang::En => "ltr",
            Lang::Ar => "rtl",
        }
    }

    fn other(self) -> Lang {
        match self {
            Lang::En => Lang::Ar,
            Lang::Ar => Lang::En,
        }
    }

    /// Each language's name, in itself, as the link to it says.
    fn name(self) -> &'static str {
        match self {
            Lang::En => "English",
            Lang::Ar => "العربية",
        }
    }
}

/// An operator's English words for a place, in Arabic where they're one of
/// the usual ones; any other stays as they wrote it.
fn place_ar(place: &str) -> String {
    match place {
        "England and Wales" => "إنجلترا وويلز".into(),
        "Scotland" => "اسكتلندا".into(),
        "Northern Ireland" => "أيرلندا الشمالية".into(),
        "the United Kingdom" | "United Kingdom" | "the UK" | "UK" => "المملكة المتحدة".into(),
        "the European Union" | "the EU" => "الاتحاد الأوروبي".into(),
        "Ireland" => "أيرلندا".into(),
        "Germany" => "ألمانيا".into(),
        "the Netherlands" => "هولندا".into(),
        "France" => "فرنسا".into(),
        "the United States" | "the US" => "الولايات المتحدة".into(),
        other => format!("<span dir=\"ltr\" lang=\"en\">{}</span>", escape(other)),
    }
}

/// The company running a hunt for others, as its pages name it.
#[derive(Debug, Clone)]
pub struct Legal {
    /// The registered name, e.g. "Arabesque Labs Ltd".
    pub company: String,
    /// The name it's known by, e.g. "Arabesque Labs".
    pub short: String,
    pub number: String,
    pub registered_in: String,
    pub office: String,
    pub email: String,
    /// Where hunt's servers are, for the privacy notice (if said).
    pub hosting: Option<String>,
}

impl Legal {
    /// Arabesque Labs' own details, as their hosted hunt sets them.
    pub fn arabesque_labs() -> Self {
        Legal {
            company: "Arabesque Labs Ltd".into(),
            short: "Arabesque Labs".into(),
            number: "16408080".into(),
            registered_in: "England and Wales".into(),
            office: "71–75 Shelton Street, Covent Garden, London WC2H 9JQ".into(),
            email: "hello@arabesquelabs.com".into(),
            hosting: Some("the United Kingdom".into()),
        }
    }

    /// `{{name}}` in `text`, each replaced by its value (escaped), in
    /// `lang`: in Arabic, the date and the usual places are Arabic too, and
    /// the rest (the company's name, its office) stay as written.
    fn fill(&self, text: &str, lang: Lang) -> String {
        let (updated, registered_in, hosting) = match lang {
            Lang::En => (
                UPDATED_WORDS,
                escape(&self.registered_in),
                self.hosting
                    .as_deref()
                    .map(|h| format!(" in {}", escape(h)))
                    .unwrap_or_default(),
            ),
            Lang::Ar => (
                UPDATED_WORDS_AR,
                place_ar(&self.registered_in),
                self.hosting
                    .as_deref()
                    .map(|h| format!(" في {}", place_ar(h)))
                    .unwrap_or_default(),
            ),
        };
        [
            ("company", &self.company),
            ("short", &self.short),
            ("number", &self.number),
            ("office", &self.office),
            ("email", &self.email),
        ]
        .iter()
        .fold(
            text.replace("{{updated}}", updated)
                .replace("{{registered_in}}", &registered_in)
                .replace("{{hosting_in}}", &hosting),
            |t, (k, v)| t.replace(&format!("{{{{{k}}}}}"), &escape(v)),
        )
    }
}

/// What a hunt says about itself: who runs it, if they've said, and where
/// its source is.
#[derive(Debug, Clone)]
pub struct Site {
    pub operator: Option<Legal>,
    pub source: String,
}

impl Default for Site {
    /// Someone's own hunt: no operator, hunt's own source.
    fn default() -> Self {
        Site {
            operator: None,
            source: SOURCE.into(),
        }
    }
}

impl Site {
    /// From the environment. Setting `HUNT_LEGAL_COMPANY` (the registered
    /// name) says hunt is run for others: then `HUNT_LEGAL_NUMBER`,
    /// `HUNT_LEGAL_OFFICE` (the registered office) and `HUNT_LEGAL_EMAIL`
    /// are needed too; `HUNT_LEGAL_REGISTERED_IN` (England and Wales),
    /// `HUNT_LEGAL_SHORT_NAME` (the company's name without "Ltd") and
    /// `HUNT_LEGAL_HOSTING` (where the servers are) may be. `HUNT_SOURCE_URL`
    /// is where a changed copy's source is.
    pub fn from_env() -> Result<Self> {
        let var = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let source = var("HUNT_SOURCE_URL").unwrap_or_else(|| SOURCE.into());
        let Some(company) = var("HUNT_LEGAL_COMPANY") else {
            return Ok(Site {
                operator: None,
                source,
            });
        };
        let mut missing = Vec::new();
        let mut need = |name: &str| {
            var(name).unwrap_or_else(|| {
                missing.push(name.to_string());
                String::new()
            })
        };
        let (number, office, email) = (
            need("HUNT_LEGAL_NUMBER"),
            need("HUNT_LEGAL_OFFICE"),
            need("HUNT_LEGAL_EMAIL"),
        );
        if !missing.is_empty() {
            return Err(Error::Invalid(format!(
                "HUNT_LEGAL_COMPANY is set, so hunt is run for others: it needs {} too",
                missing.join(", ")
            )));
        }
        let short = var("HUNT_LEGAL_SHORT_NAME").unwrap_or_else(|| {
            ["Ltd", "Ltd.", "Limited", "LLP"]
                .iter()
                .find_map(|s| company.strip_suffix(s))
                .map(|s| s.trim_end().trim_end_matches(',').to_string())
                .unwrap_or_else(|| company.clone())
        });
        Ok(Site {
            operator: Some(Legal {
                company,
                short,
                number,
                registered_in: var("HUNT_LEGAL_REGISTERED_IN")
                    .unwrap_or_else(|| "England and Wales".into()),
                office,
                email,
                hosting: var("HUNT_LEGAL_HOSTING"),
            }),
            source,
        })
    }

    /// The footer under every page: who made hunt and its source; with an
    /// operator, their pages and registered details too (which UK law asks
    /// a company's website to show). The app's is this, in English: the
    /// app's own translation turns it to the person's language.
    pub fn footer(&self) -> String {
        self.footer_in(Lang::En)
    }

    fn footer_in(&self, lang: Lang) -> String {
        let year = jiff::Zoned::now().year().max(FIRST_YEAR);
        let years = if year > FIRST_YEAR {
            format!("{FIRST_YEAR}–{year}")
        } else {
            year.to_string()
        };
        let (footer, links) = match lang {
            Lang::En => (
                include_str!("web/legal/footer.html"),
                include_str!("web/legal/footer-links.html"),
            ),
            Lang::Ar => (
                include_str!("web/legal/ar/footer.html"),
                include_str!("web/legal/ar/footer-links.html"),
            ),
        };
        // The company's registered details are on its privacy notice and
        // terms, linked from here.
        let links = match &self.operator {
            Some(op) => op.fill(links, lang),
            None => String::new(),
        };
        footer
            .replace("{{links}}", &links)
            .replace("{{years}}", &years)
            .replace("{{source}}", &escape(&self.source))
    }

    /// A public page of the site, whole, in `lang`: its header (with a
    /// link to this page in the other language), `main`, and the footer.
    /// `path` is the page's address in English.
    fn shell(
        &self,
        lang: Lang,
        path: &str,
        (title, description): (&str, &str),
        class: &str,
        main: &str,
    ) -> String {
        let css = concat!(
            include_str!("web/vendor/arabesque/arabesque.css"),
            include_str!("web/tokens.css"),
            include_str!("web/legal/legal.css"),
            include_str!("web/site/home.css"),
            include_str!("web/site/docs.css"),
            include_str!("web/site/gallery.css"),
            include_str!("web/legal/footer.css")
        );
        // The header's words.
        let [site, features, screenshots, docs, menu, to_dark, to_light] = match lang {
            Lang::En => [
                "Site",
                "Features",
                "Screenshots",
                "Docs",
                "Menu",
                "Switch to dark theme",
                "Switch to light theme",
            ],
            Lang::Ar => [
                "الموقع",
                "الميزات",
                "لقطات الشاشة",
                "التوثيق",
                "القائمة",
                "التبديل إلى المظهر الداكن",
                "التبديل إلى المظهر الفاتح",
            ],
        };
        let other = lang.other();
        let mut header = include_str!("web/site/header.html")
            .replace("{{t_site}}", site)
            .replace("{{t_features}}", features)
            .replace("{{t_screenshots}}", screenshots)
            .replace("{{t_docs}}", docs)
            .replace("{{t_menu}}", menu)
            .replace("{{t_to_dark}}", to_dark)
            .replace("{{t_to_light}}", to_light)
            .replace("{{screenshots}}", &lang.path("/screenshots"))
            .replace("{{docs}}", &lang.path("/docs"))
            .replace("{{other_href}}", &other.path(path))
            .replace("{{other_code}}", other.code())
            .replace("{{other_name}}", other.name());
        // The header says which of its pages this is.
        let current = match class {
            "docs-page" => Some("/docs"),
            "gallery-page" => Some("/screenshots"),
            _ => None,
        };
        if let Some(at) = current.map(|at| lang.path(at)) {
            header = header.replace(
                &format!(r#"href="{at}">"#),
                &format!(r#"href="{at}" aria-current="page">"#),
            );
        }
        include_str!("web/legal/page.html")
            .replace("{{lang}}", lang.code())
            .replace("{{dir}}", lang.dir())
            .replace("{{title}}", &escape(title))
            .replace("{{description}}", &escape(description))
            .replace("{{body_class}}", class)
            .replace("{{css}}", css)
            .replace("{{header}}", &header)
            .replace("{{main}}", main)
            .replace("{{footer}}", &self.footer_in(lang))
            .replace("{{logo}}", include_str!("web/img/logo.svg").trim())
            .replace("{{home}}", &lang.path("/"))
            .replace("{{source}}", &escape(&self.source))
    }

    /// hunt's home page: what it is, what it does, and where its source is.
    /// Run for others, it invites people to join the early access list
    /// (or sign in); someone's own hunt just opens.
    pub fn home(&self, lang: Lang) -> String {
        let run_for_others = self.operator.is_some();
        let (actions, note) = match (lang, run_for_others) {
            (Lang::En, true) => (
                r#"<a class="al-button al-button--primary" href="/app">Join the early access list</a>"#,
                r#"<p class="signin-note">hunt is in early access: we’re letting people in a few at a time. Join with LinkedIn, GitHub, Facebook or Google. Already in? <a href="/app">Sign in</a>.</p>"#,
            ),
            (Lang::En, false) => (
                r#"<a class="al-button al-button--primary" href="/app">Open hunt</a>"#,
                "",
            ),
            (Lang::Ar, true) => (
                r#"<a class="al-button al-button--primary" href="/app">انضم إلى قائمة الوصول المبكر</a>"#,
                r#"<p class="signin-note">hunt في مرحلة الوصول المبكر: نُدخل الناس على دفعات صغيرة. انضم بحسابك على LinkedIn أو GitHub أو Facebook أو Google. لديك حساب؟ <a href="/app">سجّل الدخول</a>.</p>"#,
            ),
            (Lang::Ar, false) => (
                r#"<a class="al-button al-button--primary" href="/app">افتح hunt</a>"#,
                "",
            ),
        };
        let (template, words) = match lang {
            Lang::En => (
                include_str!("web/site/home.html"),
                (
                    "hunt · Know where every application stands",
                    "hunt keeps your whole job search in one place: applications, interviews, \
                     people and offers, with what to do next on each. Free and open source.",
                ),
            ),
            Lang::Ar => (
                include_str!("web/site/ar/home.html"),
                (
                    "hunt · اعرف أين وصل كل طلب",
                    "hunt يجمع بحثك عن عمل كله في مكان واحد: الطلبات والمقابلات والأشخاص \
                     والعروض، مع الخطوة التالية في كلٍّ منها. مجاني ومفتوح المصدر.",
                ),
            ),
        };
        let main = template
            .replace("{{actions}}", actions)
            .replace("{{signin_note}}", note);
        self.shell(lang, "/", words, "home", &main)
    }

    /// The docs: hunt's README (`README.ar.md` in Arabic), with its
    /// sections listed alongside.
    pub fn docs(&self, lang: Lang) -> String {
        let (template, readme, credit, anchor, words) = match lang {
            Lang::En => (
                include_str!("web/site/docs.html"),
                include_str!("../README.md"),
                "a product of",
                "Link to this section",
                (
                    "Docs · hunt",
                    "How to use hunt, run it yourself, and work on it.",
                ),
            ),
            Lang::Ar => (
                include_str!("web/site/ar/docs.html"),
                include_str!("../README.ar.md"),
                "من منتجات",
                "رابط إلى هذا القسم",
                ("التوثيق · hunt", "كيف تستخدم hunt، وتشغّله بنفسك، وتطوّره."),
            ),
        };
        let (toc, content) = docs_html(readme, credit, anchor, &self.source);
        let main = template
            .replace("{{toc}}", &toc)
            .replace("{{content}}", &content);
        self.shell(lang, "/docs", words, "docs-page", &main)
    }

    /// Every screenshot `make screenshots` took, light or dark as the
    /// visitor's system is.
    pub fn screenshots(&self, lang: Lang) -> String {
        let figure = |&(name, title, about, phone): &(&str, &str, &str, bool)| {
            let (title, about) = match lang {
                Lang::En => (title, about),
                Lang::Ar => shots_ar(name).unwrap_or((title, about)),
            };
            format!(
                r##"      <figure class="{class}" id="{name}">
        <picture>
          <source srcset="/screenshots/{name}-dark.png" media="(prefers-color-scheme: dark)">
          <img src="/screenshots/{name}-light.png" alt="{title}" loading="lazy">
        </picture>
        <figcaption><a href="#{name}">{title}</a>{about}</figcaption>
      </figure>
"##,
                class = if phone { "shot-fig phone" } else { "shot-fig" },
                title = escape(title),
                about = if about.is_empty() {
                    String::new()
                } else {
                    format!("<span>{}</span>", escape(about))
                },
            )
        };
        let figures: String = shots::GALLERY.iter().map(figure).collect();
        let (template, words) = match lang {
            Lang::En => (
                include_str!("web/site/gallery.html"),
                (
                    "Screenshots · hunt",
                    "hunt's pages, with made-up demo data.",
                ),
            ),
            Lang::Ar => (
                include_str!("web/site/ar/gallery.html"),
                ("لقطات الشاشة · hunt", "صفحات hunt، ببيانات تجريبية مختلَقة."),
            ),
        };
        let main = template.replace("{{figures}}", &figures);
        self.shell(lang, "/screenshots", words, "gallery-page", &main)
    }

    /// A public page, whole: none without an operator, whose page it is.
    pub fn page(&self, doc: Doc, lang: Lang) -> Option<String> {
        let op = self.operator.as_ref()?;
        let (title, body) = match (doc, lang) {
            (Doc::Privacy, Lang::En) => ("Privacy notice", include_str!("web/legal/privacy.html")),
            (Doc::Terms, Lang::En) => ("Terms of use", include_str!("web/legal/terms.html")),
            (Doc::Deletion, Lang::En) => (
                "Deleting your data",
                include_str!("web/legal/data-deletion.html"),
            ),
            (Doc::Privacy, Lang::Ar) => {
                ("إشعار الخصوصية", include_str!("web/legal/ar/privacy.html"))
            }
            (Doc::Terms, Lang::Ar) => ("شروط الاستخدام", include_str!("web/legal/ar/terms.html")),
            (Doc::Deletion, Lang::Ar) => (
                "حذف بياناتك",
                include_str!("web/legal/ar/data-deletion.html"),
            ),
        };
        let main = format!(
            "  <main class=\"legal\">\n{}\n  </main>",
            op.fill(body, lang)
        );
        Some(self.shell(
            lang,
            doc.path(),
            (&format!("{title} · hunt"), title),
            "legal-page",
            &main,
        ))
    }
}

/// The screenshots, as `make screenshots` took them (its own file).
pub mod shots {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/web/site/screenshots/shots.rs"
    ));
}

/// A screenshot's caption in Arabic: (its title, what it shows), by its
/// name. A new screenshot needs one here (a test says so).
fn shots_ar(name: &str) -> Option<(&'static str, &'static str)> {
    Some(match name {
        "board" => (
            "لوحة المتابعة",
            "الطلبات حسب المرحلة، مع الخطوة التالية في كلٍّ منها؛ والدورات تسير جنبًا إلى جنب.",
        ),
        "swimlanes" => (
            "المسارات والمراحل الفرعية والطيّ",
            "صفوف اللوحة: ما هو نشط، والعروض، وما أُغلق، وكل مرحلة عمود. المقابلات مقسّمة إلى مراحل فرعية؛ و«أخرى» في القائمة الأولية، والمغلقة، مطويّة في أكوام.",
        ),
        "table" => (
            "لوحة المتابعة، جدولًا",
            "كل الطلبات، قابلة للترتيب، بمرشّحات اللوحة نفسها.",
        ),
        "new-application" => ("إضافة طلب", "من رابط إعلان الوظيفة، أو يدويًا، إلى اللوحة."),
        "application" => (
            "طلب",
            "الخطوة التالية، وخطّه الزمني، وبجانبه الأجر والتفاصيل والتحضير والروابط والأشخاص.",
        ),
        "cycles" => (
            "الدورات",
            "عمليات بحث عن عمل، أكثر من واحدة في آن؛ والدورة المنتهية تحتفظ بلوحتها.",
        ),
        "past-cycle" => ("دورة انتهت", "لوحتها، للقراءة فقط، كما كانت حين انتهت."),
        "prep" => (
            "التحضير",
            "ما تقرؤه وتتدرّب عليه وتستعدّ له، حول المقابلات القادمة.",
        ),
        "calendar" => ("التقويم", "المقابلات والخطوات التالية والمواعيد النهائية."),
        "calendar-week" => (
            "التقويم: أسبوع",
            "كل حدث في وقته، حول ما هو قادم هذا الأسبوع.",
        ),
        "companies" => ("جهات الاتصال: الشركات", ""),
        "company" => ("شركة", "تفاصيلها، وطلباتها بمراحلها ووسومها، والأشخاص فيها."),
        "people" => ("جهات الاتصال: الأشخاص", ""),
        "person" => ("شخص", ""),
        "files" => (
            "الملفات",
            "السير الذاتية وخطابات التقديم والعروض وغيرها، كلٌّ بإصداراته.",
        ),
        "file" => ("ملف", "إصداراته، مع معاينة."),
        "notes" => ("الملاحظات", ""),
        "stats" => ("إحصاءات المقابلات", "كيف يسير البحث."),
        "take-home" => (
            "صافي الأجر",
            "ما يبقى من الراتب بعد ضريبة الدخل والتأمين الوطني، وما يكلّفه صاحب العمل.",
        ),
        "take-home-compare" => (
            "صافي الأجر، بثلاث طرق",
            "أجر يومي كموظف، وكمتعاقد داخل IR35 وخارجه، جنبًا إلى جنب.",
        ),
        "activity" => ("سجل التدقيق", "كل تغيير، الأحدث أولًا."),
        "settings" => ("الإعدادات", ""),
        "settings-board" => (
            "الإعدادات: اللوحة",
            "المسارات ومراحلها ومراحلها الفرعية: أيّ المراحل تُغلق العملية، وأيّها تبدأ مطويّة، وإلى أين تذهب البطاقة افتراضيًا.",
        ),
        "board-ar" => (
            "بالعربية: اللوحة",
            "من اليمين إلى اليسار، بالأرقام العربية الهندية؛ وما كتبه الناس يبقى كما كُتب.",
        ),
        "application-ar" => ("بالعربية: طلب", ""),
        "celebrate" => (
            "قبول عرض",
            "الصفحة الرئيسية تحتفل به، وتحته البحث الذي أوصل إليه.",
        ),
        "phone-board" => ("على الهاتف: اللوحة", ""),
        "phone-application" => ("على الهاتف: طلب", ""),
        _ => return None,
    })
}

/// The README as the docs: (its sections' contents, its HTML). Section
/// headings get anchors; links to the repository's files go to them at
/// `source` (on GitHub); its title and closing credit are
/// the page's own (the credit: the line after its last `---` that says
/// `credit`).
fn docs_html(readme: &str, credit: &str, anchor: &str, source: &str) -> (String, String) {
    use pulldown_cmark::{CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
    let body = readme
        .split_once('\n')
        .map(|(title, rest)| {
            if title.starts_with("# ") {
                rest
            } else {
                readme
            }
        })
        .unwrap_or(readme);
    let body = match body.rsplit_once("\n---\n") {
        Some((before, after)) if after.contains(credit) => before,
        _ => body,
    };
    let events: Vec<Event> = Parser::new_ext(body, Options::ENABLE_TABLES).collect();
    let (mut out, mut toc, mut used) =
        (Vec::new(), String::new(), std::collections::HashSet::new());
    let mut i = 0;
    while i < events.len() {
        match &events[i] {
            Event::Start(Tag::Heading { level, .. }) => {
                let end = (i..events.len())
                    .find(|&j| matches!(events[j], Event::End(TagEnd::Heading(_))))
                    .unwrap_or(events.len() - 1);
                let title: String = events[i + 1..end]
                    .iter()
                    .filter_map(|e| match e {
                        Event::Text(t) | Event::Code(t) => Some(t.as_ref()),
                        _ => None,
                    })
                    .collect();
                let mut id = slug(&title);
                while !used.insert(id.clone()) {
                    id.push('-');
                }
                if *level == HeadingLevel::H2 {
                    toc.push_str(&format!(
                        "        <li><a href=\"#{id}\">{}</a></li>\n",
                        escape(&title)
                    ));
                }
                out.push(Event::Start(Tag::Heading {
                    level: *level,
                    id: Some(CowStr::from(id.clone())),
                    classes: vec![],
                    attrs: vec![],
                }));
                out.extend(events[i + 1..end].iter().cloned());
                if *level <= HeadingLevel::H3 {
                    out.push(Event::Html(CowStr::from(format!(
                        "<a class=\"anchor\" href=\"#{id}\" aria-label=\"{anchor}\">#</a>"
                    ))));
                }
                out.push(events[end].clone());
                i = end + 1;
                continue;
            }
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                title,
                id,
            }) if !dest_url.contains("://")
                && !dest_url.starts_with('#')
                && !dest_url.starts_with('/')
                && !dest_url.starts_with("mailto:") =>
            {
                out.push(Event::Start(Tag::Link {
                    link_type: *link_type,
                    dest_url: CowStr::from(format!("{source}/blob/main/{dest_url}")),
                    title: title.clone(),
                    id: id.clone(),
                }));
            }
            e => out.push(e.clone()),
        }
        i += 1;
    }
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, out.into_iter());
    (toc, html)
}

/// A heading's anchor: "In a container, or on Kubernetes" →
/// "in-a-container-or-on-kubernetes".
fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// The two pages.
#[derive(Debug, Clone, Copy)]
pub enum Doc {
    Privacy,
    Terms,
    /// How to delete your data: what Facebook's sign-in asks apps for.
    Deletion,
}

impl Doc {
    /// Its address, in English.
    fn path(self) -> &'static str {
        match self {
            Doc::Privacy => "/privacy",
            Doc::Terms => "/terms",
            Doc::Deletion => "/data-deletion",
        }
    }
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosted() -> Site {
        Site {
            operator: Some(Legal::arabesque_labs()),
            ..Site::default()
        }
    }

    #[test]
    fn a_hosted_hunts_pages_name_its_company_and_leave_nothing_unfilled() {
        for doc in [Doc::Privacy, Doc::Terms, Doc::Deletion] {
            let page = hosted().page(doc, Lang::En).unwrap();
            assert!(!page.contains("{{"), "{doc:?} left a placeholder");
            if !matches!(doc, Doc::Deletion) {
                assert!(page.contains("Arabesque Labs Ltd"), "{doc:?}");
                assert!(page.contains("16408080"), "{doc:?}");
            }
            assert!(page.contains("mailto:hello@arabesquelabs.com"));
            assert!(page.contains(UPDATED_WORDS));
            assert!(page.contains(SOURCE));
        }
        let footer = hosted().footer();
        assert!(footer.contains("Made with"));
        assert!(footer.contains(r#"href="/privacy""#));
    }

    #[test]
    fn someones_own_hunt_has_no_legal_pages_but_says_where_its_source_is() {
        let own = Site::default();
        assert!(own.page(Doc::Privacy, Lang::En).is_none());
        assert!(own.page(Doc::Privacy, Lang::Ar).is_none());
        let footer = own.footer();
        assert!(!footer.contains("{{"));
        assert!(!footer.contains("/privacy"));
        assert!(footer.contains("/docs"));
        assert!(footer.contains("Arabesque Labs"));
        assert!(footer.contains(SOURCE));
        assert!(footer.contains("GNU AGPL"));
    }

    #[test]
    fn the_home_page_invites_signing_in_where_hunt_is_run_for_others() {
        let home = hosted().home(Lang::En);
        assert!(!home.contains("{{"), "a placeholder left");
        assert!(home.contains("Join the early access list"));
        assert!(home.contains(r#"href="/privacy""#));
        let own = Site::default().home(Lang::En);
        assert!(own.contains(r#"href="/app">Open hunt</a>"#));
        assert!(!own.contains("early access"));
        // Signing in is the page's to offer: the header has no Sign in.
        assert!(!own.contains("Sign in"));
        assert!(own.contains(SOURCE));
    }

    #[test]
    fn the_docs_are_the_readme_with_its_sections_listed() {
        let docs = Site::default().docs(Lang::En);
        assert!(!docs.contains("{{"), "a placeholder left");
        assert!(docs.contains(r##"<li><a href="#the-web-ui">The web UI</a></li>"##));
        assert!(docs.contains(r#"<h2 id="the-cli">"#));
        // Its files on GitHub, not here.
        assert!(docs.contains(&format!(r#"href="{SOURCE}/blob/main/LICENSE""#)));
        assert!(!docs.contains(r#"href="LICENSE""#));
        assert_eq!(
            slug("In a container, or on Kubernetes"),
            "in-a-container-or-on-kubernetes"
        );
    }

    #[test]
    fn every_screenshot_is_shown_and_served() {
        let page = Site::default().screenshots(Lang::En);
        for (name, title, _, _) in shots::GALLERY {
            assert!(page.contains(&format!(r#"id="{name}""#)), "{title}");
            for theme in ["light", "dark"] {
                let file = format!("{name}-{theme}.png");
                assert!(shots::FILES.iter().any(|(n, _)| *n == file), "{file}");
            }
        }
    }

    #[test]
    fn an_operators_details_are_escaped() {
        let site = Site {
            operator: Some(Legal {
                company: "Acme <b>& Co</b>".into(),
                ..Legal::arabesque_labs()
            }),
            ..Site::default()
        };
        let page = site.page(Doc::Privacy, Lang::En).unwrap();
        assert!(page.contains("Acme &lt;b&gt;&amp; Co&lt;/b&gt;"));
        assert!(!page.contains("<b>& Co"));
        let page = site.page(Doc::Privacy, Lang::Ar).unwrap();
        assert!(!page.contains("<b>& Co"));
    }

    /// Every page of the site, in both languages: (its address, the page).
    fn every_page(site: &Site) -> Vec<(String, String)> {
        [Lang::En, Lang::Ar]
            .into_iter()
            .flat_map(|lang| {
                let mut pages = vec![
                    (lang.path("/"), site.home(lang)),
                    (lang.path("/docs"), site.docs(lang)),
                    (lang.path("/screenshots"), site.screenshots(lang)),
                ];
                for doc in [Doc::Privacy, Doc::Terms, Doc::Deletion] {
                    if let Some(page) = site.page(doc, lang) {
                        pages.push((lang.path(doc.path()), page));
                    }
                }
                pages
            })
            .collect()
    }

    #[test]
    fn the_arabic_site_reads_right_to_left_and_leaves_nothing_unfilled() {
        for site in [hosted(), Site::default()] {
            for (path, page) in every_page(&site) {
                assert!(!page.contains("{{"), "{path} left a placeholder");
                let arabic = path.starts_with("/ar/");
                assert_eq!(
                    page.contains(r#"<html lang="ar" dir="rtl">"#),
                    arabic,
                    "{path}"
                );
                if arabic {
                    // Its links stay in Arabic; English is a link away.
                    for to in ["/docs", "/screenshots"] {
                        assert!(page.contains(&format!(r#"href="/ar{to}""#)), "{path}: {to}");
                    }
                    assert!(
                        page.contains(r#"hreflang="en" lang="en">English</a>"#),
                        "{path}"
                    );
                    assert!(!page.contains("Made with"), "{path}: the footer's English");
                } else {
                    assert!(page.contains(r#"lang="ar">العربية</a>"#), "{path}");
                }
            }
        }
        let privacy = hosted().page(Doc::Privacy, Lang::Ar).unwrap();
        assert!(privacy.contains(UPDATED_WORDS_AR));
        assert!(privacy.contains("Arabesque Labs Ltd"));
        assert!(privacy.contains("16408080"));
        assert!(privacy.contains("mailto:hello@arabesquelabs.com"));
        // The usual places in Arabic.
        assert!(privacy.contains("إنجلترا وويلز"));
        assert!(privacy.contains("في المملكة المتحدة"));
        // The English governs, a link away.
        assert!(privacy.contains(r#"<a href="/privacy" hreflang="en">"#));
    }

    #[test]
    fn each_page_links_to_its_twin_in_the_other_language() {
        for (path, page) in every_page(&hosted()) {
            let twin = match path.strip_prefix("/ar") {
                Some(english) => english.to_string(),
                None => Lang::Ar.path(&path),
            };
            assert!(
                page.contains(&format!(r#"class="al-language" href="{twin}""#)),
                "{path} → {twin}"
            );
        }
    }

    #[test]
    fn the_arabic_docs_keep_up_with_the_english() {
        let sections = |readme: &str| readme.lines().filter(|l| l.starts_with("## ")).count();
        assert_eq!(
            sections(include_str!("../README.ar.md")),
            sections(include_str!("../README.md")),
            "README.ar.md has the same sections as README.md"
        );
        let docs = Site::default().docs(Lang::Ar);
        assert!(docs.contains(r#"<h2 id="سطر-الأوامر">"#));
        assert!(
            !docs.contains("من منتجات [معامل"),
            "its credit is the page's own"
        );
    }

    #[test]
    fn every_screenshot_has_an_arabic_caption() {
        for (name, ..) in shots::GALLERY {
            assert!(
                shots_ar(name).is_some(),
                "{name} needs an Arabic caption in shots_ar"
            );
        }
    }
}
