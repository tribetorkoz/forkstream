# ForkStream — غرفة البث المباشر وانقسام الوكلاء المتوازي (MVP)

منصة متكاملة لمراقبة وكلاء الذكاء الاصطناعي أثناء العمل لحظة بلحظة (ملفات + أكواد Diff + معاينة حية)، وإرسال أوامر تعديل أو إصلاح في منتصف المهمة بحيث **ينقسم الوكيل إلى جزأين متوازيين**: الأول يكمل المهمة الأساسية دون توقف، والثاني يصلح الجزء المطلوب في بيئة `Git Worktree` معزولة ثم يدمجه تلقائياً عبر **Mergiraf AST**.

## التقنيات والمشاريع الحقيقية المفتوحة المصدر المُدمجة في هذا الـ MVP

| الطبقة | الحزمة / المشروع المستخدم | المصدر |
| --- | --- | --- |
| بروتوكول البث الحي | `@ag-ui/core` + `@ag-ui/encoder` (v1.0 SSE + `SUBAGENT_STARTED/FINISHED`) | `github.com/ag-ui-protocol/ag-ui` |
| الخادم الخلفي | `hono` + `@hono/node-server` | `github.com/honojs/hono` & `github.com/simple10/agents-observe` |
| الوكيل المشاهد (مراقبة الملفات و Diff) | `chokidar` v5 + `diff` (`jsdiff`) + Capped 2K Digest | `github.com/paulmillr/chokidar` & `github.com/kpdecker/jsdiff` |
| العزل والانقسام المتوازي | `git worktree add -b fork/<id> <dir> <commit>` + Atomic Checkpoints | `github.com/BloopAI/vibe-kanban` & `github.com/smtg-ai/claude-squad` |
| الدمج الهيكلي الذكي بدون تعارض | `mergiraf` v0.20.0 (Tree-sitter AST Git Merge Driver) + `diff3` + AI Resolver | `codeberg.org/mergiraf/mergiraf` |
| محرر البث الحي و Unified Diff | `codemirror` 6 + `@codemirror/merge` (`unifiedMergeView`) | `github.com/codemirror/merge` |
| شجرة الانقسام والدمج التفاعلية | `@xyflow/react` v12 | `github.com/xyflow/xyflow` |
| تشغيل نماذج AI الحقيقية | `ai` (Vercel AI SDK v6 `streamText` + `tool`) + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` | `github.com/vercel/ai` |
| جسر خادم OpenCode | `POST /api/session/:id/fork` + `POST /api/session/:id/prompt` + `GET /api/event` SSE (v2) مع احتياطي v1 (`/session`, `/global/event`) | `github.com/idvxlab/VibeTrace` & `github.com/sst/opencode` |
| استخلاص المهارات من تدخلاتك | توليد ملفات `.agents/skills/<slug>/SKILL.md` (Context / Decision / Strategy) | `arXiv:2611.04466` (VibeTrace) & `agentskills.io` |

## التشغيل السريع

```bash
git clone https://github.com/tribetorkoz/forkstream.git
cd forkstream
npm install
```

يتطلب المشروع **Node.js 26 LTS أو أحدث**. يشير `.nvmrc` إلى الإصدار المستهدف؛ هذا مطلوب أيضاً لمكتبة حدود الملفات الآمنة المثبتة. على Node.js أقدم يتوقف التشغيل فوراً برسالة `requires Node.js 26 or newer`.

```bash
nvm use
npm install
npm run typecheck
npm run test:security
npm run test:engine   # اختبار شامل للانقسام المتوازي ودمج Mergiraf AST وبروتوكول AG-UI
npm run build
npm start             # محلياً فقط على http://127.0.0.1:3000
```

يستمع الخادم وVite على loopback افتراضياً حتى لا ينكشفا على الشبكة المحلية. لمعاينة Arena عبر proxy خارجي فقط، شغّل الخادم صراحةً بـ `FORKSTREAM_HOST=0.0.0.0 PORT=3101 npm start`؛ لا تستخدم هذا التجاوز على شبكة عامة دون ضوابط نشر إضافية.

عند أول تشغيل يُنشأ رمز مالك محلي ويظهر مرة واحدة في سجل الخادم. يمكن استخراجه محلياً لاحقاً بواسطة `npm run auth:token` لإلغاء قفل الواجهة. لا تُرسل الرمز إلى أحد ولا تضعه في ملفات المشروع.

## Mergiraf (اختياري لكنه موصى به)

يُدمج الفروع عبر مشغّل دمج حقيقي في Git. عند غياب Mergiraf يعود المشروع تلقائياً إلى `git merge-tree` ثم إلى حلّ `diff3`، لذا يعمل الدمج بلا خطوة إضافية، لكن الدمج الواعي بالشجرة النحوية (AST) يحتاج الملف التنفيذي:

```bash
# نزّل الإصدار المناسب لنظامك من codeberg.org/mergiraf/mergiraf
# وضعه إما في bin/mergiraf داخل المشروع أو في PATH باسم mergiraf
mergiraf --version   # يجب أن يطبع 0.20.x أو أحدث
```

ملف `bin/mergiraf` **مستبعد من Git** لأنه ثنائي كبير (~82 ميغابايت) خاص بمنصّة واحدة. تحقّق من الأداة المكتشفة عبر الواجهة (شريط الأدوات) أو من `GET /api/system`.

## ملاحظات Windows

- الأوامر أعلاه تعمل في PowerShell. إن لم يكن `nvm` مثبتاً، نزّل Node.js 26 LTS من `nodejs.org` مباشرة.
- يعمل Git على Windows بجهاز `NUL` بدلاً من `os.devNull`؛ هذا مُعالَج داخل `server/security/gitEnvironment.ts`.
- اختبارات التحقق تنشئ روابط مجلدات داخلية. تستخدم `verify-fork-merge.ts` رابط **junction** على Windows لتجنّب الحاجة إلى Developer Mode أو صلاحيات المدير.
- `npm run test:security` يحاول إنشاء symlink ملف، وهو ما يرفضه Windows دون Developer Mode؛ هذا القيد خاص بالنظام لا بالمشروع.

## الاختبار باستخدام OpenCode المثبّت محلياً

شغّل الخادمين على **الحاسوب نفسه**؛ عنوان `127.0.0.1` يُفسَّر بالنسبة إلى جهاز ForkStream، وليس جهاز المتصفح:

```bash
# الطرفية الأولى
opencode serve --hostname 127.0.0.1 --port 4096

# الطرفية الثانية، من مجلد ForkStream
npm start
```

افتح ForkStream على `http://127.0.0.1:3000`، ألغِ القفل برمز المالك، ثم من الإعدادات اختر OpenCode واترك العنوان `http://127.0.0.1:4096`. لا يقدر خادم Arena البعيد على الوصول إلى OpenCode الموجود على حاسوبك عبر هذا العنوان؛ لهذا الاختبار شغّل ForkStream محلياً أيضاً. `npm run test:opencode` يختبر عقد المحوّل محلياً بخادم محاكاة، ولا يستبدل اختبار الاتصال بإصدار OpenCode الذي لديك.

### OpenCode 2.x (واجهة `/api/*` وكلمة مرور الخادم)

`opencode v2` نقل الواجهة من `/session` و`/global/event` إلى `/api/*` ويطلب **HTTP Basic auth**. عند التشغيل يطبع سطراً مثل:

```
Server password: <كلمة-مرور-تُولَّد-مرة-واحدة>
```

انسخها والصقها في حقل **OpenCode server password (v2)** داخل نافذة الإعدادات (المستخدم الافتراضي `opencode`). تُحفظ في ذاكرة خادم ForkStream فقط، ولا تُكتب على القرص ولا تُعاد إلى المتصفح. تتغيّر الكلمة عند كل تشغيل جديد لـ `opencode serve`.

المحوّل يكتشف الإصدار تلقائياً بفحص ترويسة `Content-Type` لطلب `GET /api/session?limit=1`: إن جاءت `application/json` يستخدم عقد v2، وإلا يعود إلى عقد v1. في v2 تحديداً:

- إنشاء الجلسة: `POST /api/session` مع `location.directory` (دليل worktree).
- الإرسال: `POST /api/session/:id/prompt` بالحقل `text`، وهو **يُدرِج الرسالة فقط** ولا ينتظر الوكيل؛ لذلك ينتظر ForkStream انتهاء التنفيذ عبر `POST /api/experimental/session/:id/wait` قبل إنشاء نقطة التحقق.
- الشطر: `POST /api/session/:id/fork` بالحقل `before`، ثم `POST /api/session/:id/move` بالحقل `directory` لتوجيه الشطر إلى worktree المعزول.
- الأحداث: `GET /api/event` بدلاً من `/global/event`.
- الملفات المعدَّلة: `GET /api/session/:id/diff`.

اترك حقل `Model` فارغاً أو بصيغة `provider/model` المعروفة لديك؛ الصيغة بلا شرطة مائلة تُهمَل ليعمل OpenCode بطرازه الافتراضي.

## بدء البناء الإنتاجي — الجزء 01

تمت إضافة قاعدة بيانات SQLite WAL وترحيل أولي دائم، سجل أحداث قابل للقراءة من sequence، حفظ snapshots الجلسات، واكتشاف/تسجيل المشاريع المحلية وHTTPS GitHub. التفاصيل وحدود الجزء في [`docs/part-01-implementation.md`](docs/part-01-implementation.md).

```bash
npm run test:part01  # قاعدة البيانات والمشاريع والاستعادة من checkpoint
npm run test:clone:integration  # اختبار شبكة حقيقي اختياري لـ GitHub clone
npm run typecheck
npm run test:engine
npm run build
```

> تنبيه: الجزء 01 يؤسس التخزين وسجل المشاريع فقط. أُضيف في الجزء 02 قفل مالك ومصادقة للـAPI والمعاينة ومسارات ملفات مقيدة عبر `@openclaw/fs-safe`، لكن ضوابط الجزء 02 **غير مكتملة**: لا يوجد بعد عزل نظام تشغيل/حاوية، ولا موافقات أدوات، ولا صلاحيات دقيقة متعددة المستخدمين. المكتبة نفسها تصف ضمان القراءة العام بأنه best-effort؛ راجع [`docs/security-baseline.md`](docs/security-baseline.md). لا تفعّل الوكلاء على مشاريع مستوردة أو غير موثوقة قبل استكمال العزل والموافقات واختبارهما.
