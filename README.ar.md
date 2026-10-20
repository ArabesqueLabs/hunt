# hunt

تابِع بحثك عن عمل لوحةً من عمليات التوظيف.

hunt برمجيات حرة، بموجب رخصة [GNU AGPL v3](LICENSE): شغّله بنفسك، لنفسك أو لغيرك. وهو من
منتجات [معامل آرابيسك](https://arabesquelabs.com/ar/)، التي تشغّله أيضًا لمن يفضّلون ألا
يستضيفوه بأنفسهم. وموقعه، [careerhunt.app](https://careerhunt.app/ar/)، فيه هذا التوثيق ولقطات
الشاشة (وهي أيضًا في [`docs/screenshots.md`](docs/screenshots.md)) والصفحات القانونية لـhunt
المستضاف؛ وهو مستودع مستقل،
[ArabesqueLabs/careerhunt.app](https://github.com/ArabesqueLabs/careerhunt.app).

لتجرّبه على جهازك، بـDocker أو بـRust، ثم افتح http://localhost:4848:

```sh
docker run -p 4848:4848 -v hunt-data:/data ghcr.io/arabesquelabs/hunt
cargo install --git https://github.com/ArabesqueLabs/hunt && hunt serve
```

لا يحتاج hunt الخاص بشخص واحد إلى تسجيل دخول على جهازك. ولتصل إليه من مكان آخر، أعطه كلمة مرور
(`HUNT_PASSWORD`)، أو ضع تسجيل دخول أمامه: انظر «ما هو عام، وما يحتاج إلى تسجيل الدخول»، أدناه.
وللعمل على hunt نفسه:

يشغّل `hunt serve` خدمة واحدة. تملك قاعدة البيانات (SQLite أو PostgreSQL أو MySQL)
وتقدّم واجهة برمجة JSON، وواجهة ويب تستخدم تلك الواجهة. وبقية أوامر `hunt` تستخدم الواجهة
نفسها، فيتّفق سطر الأوامر والمتصفح دائمًا.

```sh
make serve                      # http://127.0.0.1:4848, database ~/.hunt/hunt.db, for several people (as dev-tenants)
make dev                        # the same, with a throwaway database in target/
make demo                       # fill that throwaway database with demo data (replacing it)
make watch                      # serve it for several people, rebuilding and restarting on every change
make                            # every target: build, release, test, lint, fmt, ci, install…
```

## Docker

صورة hunt، ‏[`ghcr.io/arabesquelabs/hunt`](https://github.com/ArabesqueLabs/hunt/pkgs/container/hunt)، صغيرة: بلا صدفة، وتعمل بمستخدم غير الجذر. تستمع على
:4848، وتحفظ قاعدة بيانات SQLite في `/data` (وحدة تخزين)، وتجيب على `/healthz` حين تجيب قاعدة
بياناتها.

### المتطلبات

- Docker
- Docker Compose، لتشغيله من ملف compose (اختياري)

### 1. شغّله

```sh
docker run -d --name hunt --restart unless-stopped \
  -p 127.0.0.1:4848:4848 -v hunt-data:/data \
  ghcr.io/arabesquelabs/hunt:latest
```

أو بـDocker Compose: احفظ هذا باسم `compose.yaml`، وشغّل `docker compose up -d` بجانبه.

```yaml
services:
  hunt:
    image: ghcr.io/arabesquelabs/hunt:latest
    ports: ["127.0.0.1:4848:4848"]
    volumes: ["hunt-data:/data"]
    restart: unless-stopped
volumes:
  hunt-data:
```

بياناتك في وحدة التخزين `hunt-data`، وتبقى حين تُستبدل الحاوية.

### 2. افتحه

زُر http://localhost:4848. ويقصر `127.0.0.1:4848` الوصول إلى hunt على هذا الحاسوب. وقبل أن تفتحه
لشبكة (`-p 4848:4848`)، أعطه كلمة مرور (`-e HUNT_PASSWORD=…`)، أو ضع تسجيل دخول أمامه: انظر «ما هو
عام، وما يحتاج إلى تسجيل الدخول».

### 3. اختر إصدارًا (اختياري)

`latest` أحدث بناء من main. وكل إصدار موسوم أيضًا برقمه (`v0.15.0`)، وكل بناء بإيداعه
(`sha-…`): استخدم أحدها لتختار متى تُرقّي.

### 4. استخدم PostgreSQL أو MySQL (اختياري)

أعطِ الحاوية عنوان قاعدة البيانات في `HUNT_DB` (`-e HUNT_DB=postgres://hunt:secret@db/hunt`):
انظر «قاعدة البيانات».

### التحديث

```sh
docker pull ghcr.io/arabesquelabs/hunt:latest
docker rm -f hunt        # the data stays, in its volume
```

ثم شغّله من جديد، كما في الخطوة 1. ومع Compose: ‏`docker compose pull && docker compose up -d`.
ويرقّي hunt الأحدث قاعدة بيانات SQLite في مكانها.

### بناء الصورة بنفسك

```sh
docker build --platform linux/amd64 -t hunt .
docker run -p 127.0.0.1:4848:4848 -v hunt-data:/data hunt
```

يشغّل سير العمل `image` (`.github/workflows/image.yml`) الأمر `make ci`، ثم ينشر
`ghcr.io/arabesquelabs/hunt` (`latest` من main، و`v<version>`، والبصمة sha لكل إيداع)، فلا
تحتاج إلى بنائها بنفسك.

تعيد عمليات البناء استخدام ما تستطيع. يبني الـDockerfile اعتماديات hunt في طبقة خاصة بها، من
وصفة [cargo-chef](https://github.com/LukeMathWalker/cargo-chef) (ما يعتمد عليه hunt، دون إصداره
هو)، ويحفظ سير العمل الطبقات في ذاكرة GitHub Actions المؤقتة. تغيير في الشيفرة أو إصدار جديد لا
يترجم إلا hunt نفسه؛ وتغيير الاعتماديات يترجمها من جديد. وتتسع الذاكرة المؤقتة لـ10 غيغابايت لكل
مستودع، فبناء كامل بين حين وآخر، بعد حذف المدخلات القديمة، أمر متوقع.

## Kubernetes

hunt حاوية (pod) واحدة بوحدة تخزين واحدة. ولا يمكن تشغيل إلا نسخة واحدة في كل مرة، لأن SQLite
ملف على تلك الوحدة، فالتحديثات تستبدل الحاوية بدل أن تتدرّج.

### المتطلبات

- عنقود Kubernetes، فيه فئة تخزين لوحدة التخزين
- kubectl

### 1. اكتب الملفات

احفظ هذا باسم `hunt.yaml`: وحدة التخزين، والنشر، وخدمته.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: hunt-data }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: hunt }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: hunt } }
  template:
    metadata: { labels: { app: hunt } }
    spec:
      securityContext: { fsGroup: 65532 }
      containers:
        - name: hunt
          image: ghcr.io/arabesquelabs/hunt:latest
          ports: [{ containerPort: 4848 }]
          volumeMounts: [{ name: data, mountPath: /data }]
          readinessProbe: { httpGet: { path: /healthz, port: 4848 } }
          livenessProbe: { httpGet: { path: /healthz, port: 4848 } }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: hunt-data }
---
apiVersion: v1
kind: Service
metadata: { name: hunt }
spec:
  selector: { app: hunt }
  ports: [{ port: 4848, targetPort: 4848 }]
```

- **نسخة واحدة، تُعاد من جديد:** لا حاويتان على ملف SQLite واحد أبدًا.
- **‏`fsGroup: 65532`:** تعمل الصورة بذلك المستخدم، فيمنحها هذا وحدة التخزين.
- **الفحوص:** يجيب `/healthz` بـ«ok» حين يجيب hunt وقاعدة بياناته، ولا يحتاج إلى تسجيل دخول.

### 2. انشره

```sh
kubectl create namespace hunt
kubectl -n hunt apply -f hunt.yaml
kubectl -n hunt rollout status deployment/hunt
```

### 3. افتحه

عبر تحويل منفذ، من حاسوبك:

```sh
kubectl -n hunt port-forward svc/hunt 4848
```

ثم زُر http://localhost:4848. ويعمل سطر الأوامر عبره أيضًا (`HUNT_URL=http://127.0.0.1:4848`).

ولتصل إليه من مكان آخر، وجّه Ingress أو موازن أحمال أو Cloudflare Tunnel إلى المنفذ 4848 في
الخدمة `hunt`، مع تسجيل دخول أمامه: انظر «ما هو عام، وما يحتاج إلى تسجيل الدخول».

### 4. استخدم PostgreSQL أو MySQL (اختياري)

أعطِ الحاوية عنوان قاعدة البيانات في `HUNT_DB`، من سرّ:

```yaml
          env:
            - name: HUNT_DB
              valueFrom: { secretKeyRef: { name: hunt-db, key: url } }
```

### التحديث

```sh
kubectl -n hunt rollout restart deployment/hunt     # pulls latest again
kubectl -n hunt set image deployment/hunt hunt=ghcr.io/arabesquelabs/hunt:v0.15.0   # or a version
```

## قاعدة البيانات

يحدّدها `--db` (أو `HUNT_DB`، أو `make serve DB=…`):

```sh
hunt serve --db ~/.hunt/hunt.db                              # SQLite, a file (the default)
hunt serve --db postgres://hunt:secret@localhost/hunt        # PostgreSQL (12 or later)
hunt serve --db mysql://hunt:secret@localhost:3306/hunt      # MySQL (8.0.16 or later)
```

- **يجب أن تكون قاعدة البيانات فارغة، أو قاعدة hunt.** الفارغة تحصل على جداول hunt عند أول
  تشغيل؛ ولـPostgreSQL وMySQL، أنشئ قاعدة البيانات أولًا (`CREATE DATABASE hunt`).
- **الترقيات:** تُرقّى قواعد بيانات SQLite في مكانها حين يفتحها hunt أحدث. أما قواعد
  PostgreSQL وMySQL فتبدأ بالمخطط الحالي؛ ولنقل إحداها عبر تغيير في المخطط، خذ نسخة احتياطية
  منها بـhunt الذي أنشأها واستوردها في قاعدة بيانات جديدة.
- **الاتصالات:** يُتّصل بـPostgreSQL وMySQL دون TLS، فاستخدمهما على الجهاز نفسه أو على شبكة
  خاصة.
- **الاختبارات:** يشغّل `make db-up` الخادمين كليهما في Docker؛ ويشغّل `make test-all`
  اختبارات الواجهة على SQLite وPostgreSQL وMySQL.

## النسخ الاحتياطي

الإعدادات ← **النسخ الاحتياطي والاستيراد**، أو `hunt backup` و`hunt restore`.

- **ما في النسخة:** ملف JSON واحد فيه كل شيء (العمليات، والطلبات، والشركات، والأشخاص، والملفات،
  والوسوم، والإعدادات، وسجل التغييرات). ويُستبعد اتصال Gmail، فلا تكون في نسخة احتياطية أبدًا
  كلمة مرور أو بيانات تسجيل دخول.
- **النقل بين قواعد البيانات:** النسخة الاحتياطية تعمل مع أيٍّ منها، فهي تنقل البيانات أيضًا من
  واحدة إلى أخرى، كمن SQLite إلى PostgreSQL.
- **الاستيراد:**
  - يستبدل كل شيء، كله أو لا شيء: نسخة لا تناسب تترك الأمور كما كانت؛
  - يقول ما يحويه الملف ويسأل أولًا؛
  - لا يقبل إلا النسخ الاحتياطية بإصدار المخطط الحالي.

## واجهة الويب

واجهة hunt على الويب هي حيث يعيش بحثك عن عمل: لوحة لكل طلباتك، وصفحات للشركات والأشخاص والملفات
والمواعيد من حولها. وهي مبنية بنظام التصميم
[Arabesque](https://design.arabesquelabs.com/).

لكل جزء صفحة خاصة:

- [لوحة المتابعة](docs/web-ui/tracking-board.ar.md): اللوحة والجدول، وعوامل التصفية، والإخفاء والطيّ.
- [المسارات والمراحل الفرعية](docs/web-ui/swimlanes-and-sub-stages.ar.md): صفوف اللوحة، وأجزاء
  العمود.
- [إضافة الطلبات](docs/web-ui/adding-applications.ar.md): من رابط إعلان أو يدويًا، ووظيفة منشورة في
  أكثر من مكان.
- [صفحة الطلب](docs/web-ui/an-application.ar.md): ما تعرضه، وتعديلها.
- [كثير دفعة واحدة](docs/web-ui/many-at-once.ar.md): تحديد عدة عمليات، وتغييرها معًا.
- [الإغلاق، وقبول عرض](docs/web-ui/closing-and-offers.ar.md): المراحل النهائية وأسبابها، وقبول عرض.
- [الشركات والأشخاص](docs/web-ui/companies-and-people.ar.md): قوائمهم وصفحاتهم، واستيرادهم، ومن
  LinkedIn أيضًا.
- [الملفات والبريد والملاحظات](docs/web-ui/files-email-and-notes.ar.md): المستندات وإصداراتها،
  والرسائل، وملاحظات عن البحث.
- [التقويم](docs/web-ui/calendar.ar.md): المقابلات والمواعيد النهائية، بالشهر أو الأسبوع أو اليوم.
- [الإحصاءات](docs/web-ui/stats.ar.md): البحث في رسوم بيانية، وما يستخدمه hunt من جهازه.
- [الإعدادات والوسوم والقوائم](docs/web-ui/settings.ar.md): كيف يبدو hunt ويعمل، والوسوم، وأعمدة
  القوائم.

## ما هو عام، وما يحتاج إلى تسجيل الدخول

التطبيق في `/`، وكل صفحة منه في عنوانها الخاص (`/stats`، `/applications/2`)، وبياناته تحت `/api`:
وهذه تحتاج إلى تسجيل الدخول. والباقي لا يحتاج إلى أحد: تسجيل الدخول (`/login`)، وفحص السلامة
(`/healthz`)، والنصوص البرمجية والأنماط والخطوط والشعار، ورابط التقويم المشترك. والعناوين من حين كان
التطبيق تحت `/app` (`/app/companies/3`) تقود إلى الصفحة نفسها دونه، وصفحات الموقع التي كان hunt
يقدّمها (`/docs`، `/privacy`، `/terms`، `/data-deletion`، `/screenshots`، و`/ar/…`) تقود إليها في
الموقع (`HUNT_SITE_URL`، أدناه).

وهناك ثلاث طرق لتسجيل الدخول.

### كلمة مرور، لشخص واحد

```sh
HUNT_PASSWORD='a long passphrase' hunt serve
docker run -e HUNT_PASSWORD='a long passphrase' -p 4848:4848 -v hunt-data:/data ghcr.io/arabesquelabs/hunt
```

- **التطبيق وبياناته** يطلبانها، في `/login`، ويتذكرانك 30 يومًا. وفي الشريط الجانبي **تسجيل
  الخروج**.
- **سطر الأوامر** يرسل `HUNT_PASSWORD` الخاص به: اضبطه حيث تشغّل `hunt`.
- **تغييرها** يُخرج الجميع. وتحتاج إلى 8 أحرف أو أكثر؛ والخاطئة تكلّف ثانية.
- **عبر الإنترنت**، ضع hunt خلف HTTPS (وكيل عكسي مثل Caddy، الذي يفعل ذلك وحده): فتُعلَّم ملفات
  تعريف الارتباط بأنها آمنة حين يقول الوكيل إن الزيارة كانت عبر HTTPS (`X-Forwarded-Proto`).

### وكيل تسجيل دخول، لعدة أشخاص

إن كنت تُدخل الناس عند وكيل (Authelia، أو Authentik، أو oauth2-proxy، أو Tailscale)، فيمكنه أن
يخبر hunt بمن يسأل، في ترويسة:

```sh
hunt serve --tenants --admins you@example.com \
  --auth-header Remote-Email --trusted-proxies 172.18.0.0/16
# or HUNT_TENANTS=1 HUNT_ADMINS=… HUNT_AUTH_HEADER=… HUNT_TRUSTED_PROXIES=…
```

| الوكيل | ترويسته |
|---|---|
| Authelia | `Remote-Email` |
| Authentik | `X-authentik-email` |
| oauth2-proxy | `X-Auth-Request-Email` (مع `--set-xauthrequest`) |
| Tailscale (`tailscale serve`) | `Tailscale-User-Login` |

- **`--trusted-proxies`** (أو `HUNT_TRUSTED_PROXIES`) يسرد العناوين، أو النطاقات، التي تأتي منها
  طلبات الوكيل: هذا الجهاز (`127.0.0.1`، `::1`) ما لم يُذكر غيره، وفي Docker، شبكة الوكيل
  (`172.18.0.0/16`، مثلًا). ولا تُعتمد الترويسة إلا منها، فلا يستطيع من يصل إلى hunt بطريق آخر أن
  يدّعي أنه أي أحد. وأبقِ منفذ hunt نفسه بعيدًا عن الإنترنت مع ذلك.
- **الوكيل** عليه أن يضبط الترويسة بنفسه، فيستبدل أي ترويسة أرسلها الزائر: وإعدادات Authelia
  وoauth2-proxy المعتادة تفعل ذلك.
- ثم ينضم الناس ويُدخَلون كما مع Cloudflare Access: انظر «عدة أشخاص»، أدناه.
- **سطر الأوامر**، من عنوان موثوق (على جهاز hunt نفسه، مثلًا)، يقول بنفسه من يسأل: اضبط
  `HUNT_AUTH_HEADER` (الترويسة نفسها) و`HUNT_USER` (بريدك) حيث تشغّله.

مع Caddy وAuthelia، مثلًا:

```
hunt.example.com {
  forward_auth authelia:9091 {
    uri /api/authz/forward-auth
    copy_headers Remote-User Remote-Groups Remote-Email Remote-Name
  }
  reverse_proxy hunt:4848
}
```

ولا يحتاج hunt الخاص بشخص واحد خلف وكيل تسجيل دخول إلى شيء من hunt: فالوكيل يُبقي الآخرين خارجًا.

### Cloudflare Access

احمِ اسم المضيف كله (`hunt.example.com`). وتصل فحوص Kubernetes إلى `/healthz` داخل العنقود، لا عبر
Access؛ وتطبيق التقويم الذي يشترك في رابط تقويم مشترك يحتاج إلى استثناء لـ`/api/calendar/`. وفي hunt
مشترك، يتحقق hunt أيضًا من الرمز الموقّع من Access في كل طلب للبيانات، فلا يكشف خطأٌ في إعداد Access
بيانات أحد.

خلف Cloudflare Access، في الشريط الجانبي **تسجيل الخروج** (ينهي جلسة Access)، وفي «معلومات
التصحيح» في مركز الإدارة الهوية التي يحملها Access لك ولوحة تحكم Zero Trust، مع فحص سلامة hunt
ورابط اشتراك التقويم والنسخة الاحتياطية والشيفرة المصدرية وعمليات بناء الصورة. ويستخدم سطر الأوامر
رمز خدمة: اضبط `HUNT_ACCESS_CLIENT_ID` و`HUNT_ACCESS_CLIENT_SECRET` على معرّفه وسرّه، و`HUNT_URL`
على العنوان العام. وإشارة «أرسل إلى hunt» المرجعية تفتح hunt في تبويب، فتسجّل الدخول كأي زيارة
أخرى.

## عدة أشخاص (تعدد المستخدمين)

يمكن لـhunt واحد أن يخدم عدة أشخاص، كلٌّ يرى ويغيّر طلباته وشركاته وأشخاصه وملفاته وملاحظاته
ووسومه وإعداداته وحده. يتشاركون قاعدة بيانات واحدة: كل صف يحمل مالكه، وكل طلب يعمل باسم الحساب
الذي جاء منه (يقصر `src/scope.rs` كل استعلام على صفوف الحساب، فلا يحتاج شيء إلى أن يتذكّر ذلك).
وتفعيله يحتفظ بما هو موجود: يصير ملكًا لأول مسؤول.

```sh
hunt serve --tenants --admins you@example.com,other-admin@example.com \
  --access-team yourteam --access-aud <the Access application's AUD tag>
# or HUNT_TENANTS=1 HUNT_ADMINS=… HUNT_ACCESS_TEAM=… HUNT_ACCESS_AUD=…
```

- **تسجيل الدخول** مهمة Cloudflare Access: تسجّل دخول الناس بـGitHub وLinkedIn (أو أي طريقة دخول
  مُعدّة هناك) وتسلّم hunt رمزًا موقّعًا، يتحقق منه hunt بمفاتيح الفريق ووسم جمهور التطبيق. والطلب
  الذي لم يأتِ عبر Access لا يمكن أن ينتحل صفة أحد. ولكي يطلب الآخرون حسابًا، يجب أن تسمح لهم سياسة
  تطبيق Access بالدخول: Include ← Login Methods ← GitHub وLinkedIn (أي من سجّل الدخول بأحدهما)،
  بدل بريدك الإلكتروني.
- **قائمة الوصول المبكر**: طلب حساب يُقدَّم انضمامًا إلى قائمة وصول مبكر، بلا مواعيد ولا وعود. والقادم
  الجديد، بعد تسجيل دخوله، لا يرى إلا «انضم إلى قائمة الوصول المبكر»: اسمه، واختياريًا، ما الذي جاء
  به إلى hunt. وإلى أن يُدخله مسؤول، يرى أنه على القائمة؛ وإن رُفض، يمكنه الانضمام مجددًا.
- **مركز الإدارة** (/admin، للمسؤولين): قائمة الوصول المبكر، لإدخال الناس أو رفضهم (مع ملاحظة)، وكل
  حساب: حالته، ودوره (اجعله مسؤولًا آخر)، وطلباته، ومتى شوهد آخر مرة، ورمز سطر الأوامر الخاص به؛
  عطّله أو فعّله أو أزله (مع كل ما يخصه، إن اخترت)؛ ومفتاح لتحديد ما إذا كان يمكن للجدد طلب حساب
  أصلًا (مغلقًا، يُقال لهم إن القائمة مغلقة حاليًا؛ والحسابات الموجودة تستمر). وفي «معلومات التصحيح»
  روابط في المتناول: هوية Cloudflare Access الخاصة بك وتسجيل الخروج، وفحص السلامة، ورابط اشتراك
  التقويم، والنسخة الاحتياطية وواجهة البرمجة، والشيفرة المصدرية وبناء الصور. وهو تحت الإعدادات في الشريط الجانبي. ويرى المسؤولون
  أيضًا موارد النظام في الإحصاءات؛ ولا يراها غيرهم. والمسؤولون المذكورون في `HUNT_ADMINS` مسؤولون
  كلما بدأ hunt؛ والأول هو الحساب 1.
- **سطر الأوامر** يسجّل الدخول برمز خدمة من Access، لا بريد له: اضبط معرّف العميل (Client ID) الخاص
  به رمزًا لسطر الأوامر للحساب في مركز الإدارة، فيعمل سطر الأوامر باسم ذلك الحساب.
- **النسخ الاحتياطية** من إصدارات hunt الأقدم (من المخطط 8 فصاعدًا) تُستورد أيضًا، في الوضعين.
  و**النسخ الاحتياطية** لكل حساب نسخه: النسخة تحوي صفوفه (والملفات التي تستخدمها فقط)، واستيرادها
  لا يستبدل إلا ما لذلك الحساب، بمعرّفات جديدة لا يمكن أن تتعارض مع غيرها.
- مزامنة Gmail لـhunt شخص واحد فقط، حاليًا.
- **التجربة محليًا**: يقدّم `make dev-tenants` (أو `make watch`) الملف `target/dev.db` لعدة أشخاص،
  مع `ADMINS` (افتراضيًا admin@example.test) مسؤولين. لا يوجد Cloudflare Access، فهوية السائل تؤخذ
  على الثقة (`--identity-header X-Hunt-User`): في المتصفح، افتح `/dev/as?email=admin@example.test`
  لتكون المسؤول، أو أي بريد آخر لتكون قادمًا جديدًا يطلب حسابًا؛ و`/dev/as` وحده يسجّل الخروج. لا
  تشغّله هكذا أبدًا حيث يمكن للآخرين الوصول إلى hunt.

## صافي الأجر (المملكة المتحدة)

في الشريط الجانبي، موسومًا بـ«تجريبية»: لمن يقولون إنهم يعيشون في المملكة المتحدة (الإعدادات ←
الموقع)؛ ويُطلب ذلك من غيرهم. ويمكن أن يرافق الراتبَ مكافأةٌ مستهدفة (بمضاعفك ومضاعف الشركة)،
ومكافأة توقيع، ومنح أسهم (RSUs، وخيارات unapproved وEMI وCSOP وSharesave، تُستحق على مدى السنوات،
وتُفرض عليها الضريبة كما يقول gov.uk)، ومزايا عينية (سيارة شركة ووقودها، وشاحنة، وتأمين طبي،
وقرض) وتوقّع سنة بسنة (`src/equity.rs`). معلومات الأجر أولًا: الأجر الإجمالي المعروض أو صافي الأجر
المرغوب؛ موظفًا (PAYE)، أو متعاقدًا داخل IR35 أو خارجه، أو الثلاثة جنبًا إلى جنب؛ والمبلغ وعملته
وفترة الدفع (من الساعة إلى السنة). يحسب ما يبقى من الراتب بعد ضريبة الدخل والتأمين الوطني وقروض
الطلاب والمعاش (التضحية بالراتب، أو صافي الأجر، أو الإعفاء عند المصدر)، بالسنة والشهر والأسبوع
واليوم؛ وما يبقى من أجر المتعاقد (بالساعة أو اليوم أو الأسبوع أو الشهر أو السنة) داخل IR35 (عبر
شركة مظلّة) وخارجه (عبر شركتك المحدودة: راتب، وضريبة الشركات، وأرباح أسهم)، جنبًا إلى جنب، كلٌّ
مع الراتب الذي يعادله. أو بالعكس: من صافي الأجر الذي تريده، الراتب، أو الأجر على جانبي IR35، الذي
يُبقيه. ويمكن كتابة الأجر بعملة أخرى، يُحوَّل إلى الجنيه بسعر اليوم. والطلب الذي يذكر أجره يعرض ما
سيُبقيه نطاقه شهريًا، مع رابط لحسابه. وأقسام مطويّة لرمز ضريبي (1257L، ورموز K، وBR، وD0، وNT…)،
مع الرمز الذي تعطيه الأرقام موصًى به كما تحسبه HMRC (إرشادات gov.uk حول الرموز الضريبية ودليل
PAYE)، وبدل الزواج، وقروض الطلاب، ومعاش مكان العمل (حصتك وحصة صاحب العمل)، وسن معاش الدولة،
وإعانة الطفل ورسوم الدخل المرتفع عليها، والتضحية بالراتب الأخرى (Cycle to Work، وسيارة كهربائية)،
وGift Aid والتبرع من الراتب. وتُقارن النتائج بصافي الأجر الذي تريده (الإعدادات ← صافي الأجر
المرغوب)، الذي يبدأ منه الحساب العكسي. إنجلترا وويلز وأيرلندا الشمالية، أو اسكتلندا؛ والسنتان
الضريبيتان 2025/26 و2026/27 (`src/takehome.rs`).

## التجارب

الميزات التي ما تزال قيد التجربة معطّلة ما لم تُفعَّل حين يبدأ hunt، وحينها للحسابات المسمّاة فقط
(`--experiment name=you@example.com`، أو `HUNT_EXPERIMENTS`). لا يوجد شيء منها الآن؛ وقد صار
`take-home` ميزة، وما يزال مقبولًا، فالخادم الذي يبدأ به يظل يبدأ.

## تشغيل hunt للآخرين: إشعار الخصوصية والشروط والتذييل

تنتهي كل صفحة بتذييل يقول من صنع hunt، ويربط بالتوثيق وبشيفرته المصدرية (`HUNT_SOURCE_URL`، إن
كنت قد غيّرت hunt: فرخصة AGPL تطلب من الخدمة التي يستخدمها الناس عبر الشبكة أن تتيح لهم
شيفرتها).

حين تشغّل hunt لأناس آخرين، تكون مسؤولًا عن بياناتهم، ويطلب القانون (في المملكة المتحدة والاتحاد
الأوروبي، على الأقل) إشعار خصوصية وشروطًا وتفاصيل شركتك. ونشرها من شأن موقعك؛ وhunt يربط بها،
ويطلب من الناس الموافقة على الشروط:

| الإعداد | |
|---|---|
| `HUNT_SITE_URL` | موقعك (مثل `https://careerhunt.app`)، وفيه `/privacy/` و`/terms/` و`/data-deletion/` و`/docs/` (ونسخها العربية تحت `/ar/`): ضبطه يعني أن hunt يُشغَّل للآخرين |
| `HUNT_OPERATOR` | من يشغّله، باسمه (مثل `Arabesque Labs Ltd`)، لصفحة الحساب وإخلاء المسؤولية في صافي الأجر |

ثم:

- **التذييل** يربط بتوثيق الموقع وإشعار الخصوصية والشروط وملفات تعريف الارتباط
  (`/privacy/#cookies`).
- **طلب حساب** يتطلب الموافقة على الشروط، مع رابطها. وأيّ إصدار (`UPDATED` في `src/site.rs`:
  تاريخ شروط الموقع)، ومتى، يُحفظ مع الحساب، ويُعرض للمسؤولين (`agreed_terms`).
- **حذف حساب** (الإعدادات ← حسابك) يربط بصفحة حذف البيانات في الموقع، وصافي الأجر بشروطه.
- **الصفحات التي كان hunt يقدّمها** (`/privacy`، `/terms`، `/data-deletion`، `/docs`، `/ar/…`)
  تقود إلى صفحات الموقع، فتبقى الروابط إليها من أماكن أخرى صالحة (تطلب خدمة تسجيل الدخول من
  Facebook إشعار الخصوصية وصفحة حذف البيانات بعنوانيهما).

والصفحات القانونية لمعامل آرابيسك، بالإنجليزية والعربية، هي صفحات careerhunt.app، في مستودعه:
اجعل من يراجع صفحاتك لخدمتك قبل الاعتماد عليها. وكانت إصدارات hunt السابقة تقدّمها بنفسها، مع
`HUNT_LEGAL_*`: والآن يرفض hunt البدء مع `HUNT_LEGAL_COMPANY` دون `HUNT_SITE_URL`، بدل أن
يُسقطها دون أن يلاحظ أحد.

## الشعار

في `docs/logo/` شعار hunt بصيغة PNG، للتطبيقات والملفات الشخصية الأخرى: بألوان التطبيق على خلفيته
الفاتحة أو الداكنة (`logo-light-SIZE.png`، `logo-dark-SIZE.png`)، وعلى خلفية شفافة
(`logo-SIZE.png`)، من 16 إلى 1024 بكسلًا، ومع هامش لصور الملفات الشخصية التي تُقصّ دائرةً
(`avatar-light-SIZE.png`، `avatar-dark-SIZE.png`). ويرسمها `make logo` من جديد من
`src/web/img/logo.svg`.

## اللغات

تتحدث واجهة الويب الإنجليزية والعربية (الإعدادات ← عام ← اللغة والمنطقة). الإنجليزية، وهي
الافتراضية، تُقرأ من اليسار إلى اليمين؛ والعربية من اليمين إلى اليسار: ينتقل الشريط الجانبي إلى
اليمين، وتسير أعمدة اللوحة من اليمين إلى اليسار، وينعكس كل شيء معها. وتُقدَّم الصفحة مضبوطة مسبقًا
على اللغة المختارة، فتُرسم بالاتجاه الصحيح من البداية.

وهذا التوثيق بالعربية هو `README.ar.md`، الذي يعرضه الموقع تحت `/ar/docs/`: حدّثه مع `README.md`
(يتحقق اختبار من أن لهما الأقسام نفسها).

- **ما يُترجم**: كلمات hunt نفسه: القوائم والأزرار والعناوين والنماذج والرسائل والخيارات التي تقدّمها
  الخدمة (المراحل والأسباب والأنواع). وما كتبه الناس يبقى كما كُتب: الأسماء والإعلانات والرسائل
  والملاحظات والوسوم وجمل سجل التغييرات (تكتبها الخدمة، بالإنجليزية). وأسماء المراحل الافتراضية
  تُترجم حيث تُعرض، وتبقى كما هي في قاعدة البيانات. وسطر الأوامر يتحدث الإنجليزية.
- **المنطقة**: كيف تُكتب التواريخ والأوقات والأرقام. وإن تُركت على افتراضيها، تتبع اللغة (أسماء الأشهر
  والأيام بالعربية، مثلًا).
- **الأرقام**: أرقام اللغة نفسها (العربية الهندية، ٠١٢٣، للعربية)، أو الغربية (0123) دائمًا أو
  العربية الهندية دائمًا. والعناوين والبريد وأرقام الإصدارات تحتفظ بأرقامها. والمبالغ
  (<span dir="ltr">£85k–100k/yr</span>) تُقرأ من اليسار إلى اليمين داخل النص العربي.
- **المنطقة الزمنية** (الإعدادات ← التقويم): ما «اليوم» و«الآن»، لـhunt وللصفحة: متى أُضيفت الأشياء،
  وما تأخّر، والتقويم. وإن تُركت فارغة، فهي منطقة الجهاز الذي يعمل عليه hunt (الحاوية عادةً UTC).
  ومع اختيار منطقة، يعطي رابط اشتراك التقويم أوقاته بها (`TZID`).

### إضافة لغة

1. انسخ `src/web/i18n-ar.js` إلى `src/web/i18n-<code>.js`، وغيّر رمزه واسمه واتجاهه (`ltr` أو
   `rtl`) وأرقامه، وترجم كل عبارة. والأنماط تملأ `{names}` بالأجزاء المتغيّرة؛ و`{n}` و`{m}`
   و`{n1}` … لا تطابق إلا الأرقام. والعبارة المتروكة تظهر بالإنجليزية.
2. أضفها إلى `LANGUAGES` في `src/service.rs`، وقدّمها بجانب `/i18n-ar.js` في `src/api.rs`،
   وحمّلها في `src/web/index.html` بعد `i18n.js`.

تُترجم الصفحة أثناء رسمها (`src/web/i18n.js`): الشيفرة تكتب بالإنجليزية، وكل نص وعنصر نائب وعنوان
وaria-label وalt موجود في الفهرس يُستبدل بترجمته. وما داخل `translate="no"`، أو في قائمة محتوى
المستخدم هناك، يُترك كما هو.

## سطر الأوامر

كل أمر عدا `serve` يخاطب الخدمة (`--url`، أو `$HUNT_URL`؛ والافتراضي `http://127.0.0.1:4848`).
ويمكن تسمية العملية بمعرّفها أو بكلمة تميّزها (`acme`). ويمكن أن تكون التواريخ ودّية: `tomorrow`،
`+3d`، `-1w`، `fri 15:00`، `10-30`، `2026-10-30`.

ولكل أمر صفحة خاصة به في [`docs/cli/`](docs/cli/)، فيها ما يفعله، وأمثلة، ومساعدته (وفي الموقع، تحت
«سطر الأوامر»). ويكتب `make cli-docs` مساعدة كل صفحة من البرنامج، ويتحقق اختبار من أنها محدّثة: إن
غيّرت أمرًا، فشغّله.

```sh
hunt                                        # the board
hunt add --link https://jobs.ashbyhq.com/acme/1234 -s applied   # read the posting
hunt add Acme -r "Staff Engineer" -s applied --source referral --applied -3d
hunt add TikTok --next "reply to recruiter" --due "fri 10:00"
hunt move acme interviewing                 # --top to put it first
hunt step acme "system design" --at "fri 15:00"
hunt person acme "Sam Lee" --role hiring-manager
hunt note acme "asked about the team's on-call"
hunt next acme "send availability" --due tomorrow
hunt archive tiktok role-closed -n "hiring freeze till November"
hunt archive acme role-filled -n "went with an internal candidate"
hunt resume acme screening
hunt show acme                              # everything, with its change log
hunt board --all                            # every archived process, not just the last 30 days

hunt upload Resume cv.pdf --tag rust-focused   # the next version (the document is made if new)
hunt attach acme resume                     # sent its latest version with acme (--version N)
hunt detach acme 7                          # take version #7 off
hunt download 7 -o ~/Desktop/cv.pdf

hunt lookup ashbyhq.com                     # what a company's site (or LinkedIn page) says
hunt lookup linkedin.com/company/ashbyhq --save   # add it, or fill in what it's missing

hunt mail list acme                         # a process's emails; `hunt mail show 12` reads one
hunt mail import acme ~/Downloads/offer.eml
pbpaste | hunt mail import acme -           # after Gmail's Show original → Copy to clipboard
hunt mail rm 12

hunt tag applications 4 +remote "dream job" -fintech   # add and remove tags; no changes shows them
hunt list applications --where tag=remote

hunt backup                                 # everything, to hunt-backup-<date>.json (-o to choose)
hunt restore hunt-backup-2026-10-06.json    # replace everything with it (asks; --yes not to)

hunt list applications -q rust              # any resource: stages, companies, people,
hunt get companies 3                        #   applications, processes, steps, notes,
                                            #   documents, versions, lanes, tags
hunt edit applications 4 location=London salary_min=150k currency=GBP work_mode=remote
hunt new people name="Pat Chen" company_id=acme title=Recruiter
hunt rm stages 6 --move-to applied
hunt list reasons                           # the reasons for closing: the terminal stages' lanes
hunt new lanes stage_id=their name="Salary too low"    # another reason
hunt edit stages 3 active=0                 # terminal: what's in it closes
hunt new swimlanes name="On hold"           # another row of the board
hunt order considering applied screening interviewing offer
hunt fields applications                    # what each resource has
hunt log processes 12                       # the change log
```

المزيد في [`docs/design.md`](docs/design.md) (بالإنجليزية).

## المساهمة

نرحّب بالبلاغات وطلبات الدمج: انظر [CONTRIBUTING.md](CONTRIBUTING.md)، و[SECURITY.md](SECURITY.md)
للإبلاغ عن ثغرة أمنية بشكل خاص.

## الرخصة

hunt برمجيات حرة: يمكنك إعادة توزيعه و/أو تعديله بموجب شروط
[رخصة GNU Affero العمومية، الإصدار 3](LICENSE). وإن شغّلت نسخة معدّلة لغيرك عبر الشبكة، فأتِح لهم
شيفرتها المصدرية أيضًا.

الاسمان «hunt» و«Arabesque Labs»، وشعاراهما (`docs/logo/`، `src/web/img/`)، لا تشملهما الرخصة:
يُرجى عدم استخدامها لتسمية نسختك أو وسمها دون إذن كتابي من Arabesque Labs. والخطوط المرفقة (Jost وNewsreader
وIBM Plex Sans Arabic وAmiri) مرخّصة بموجب SIL Open Font License 1.1: ترخيص كلٍّ منها وحقوق
نشره في `src/web/fonts/` (انظر ملف README فيه).

---

hunt من منتجات [معامل آرابيسك](https://arabesquelabs.com/ar/).
