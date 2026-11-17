/**
 * Real-Filesystem Zero-Key Sandbox Agent Engine
 *
 * Unlike fake UI mocks, this engine operates on 100% REAL files on disk,
 * commits REAL Git checkpoints at every step, triggers REAL `chokidar` events
 * and `jsdiff` unified diffs, spawns REAL `git worktree add -b fork/<id>`
 * directories when the user intervenes mid-run, modifies REAL files in parallel
 * while the Builder Agent continues executing its remaining steps, and merges
 * via REAL Mergiraf tree-sitter AST + Git 3-way merge!
 */
import type { ScenarioPreset, SelectedDomElement } from '../../shared/types.js'
import type { SessionWorktreeManager } from '../vcs/worktreeManager.js'

export interface SandboxBuildStep {
  title: string
  titleAr: string
  filePath: string
  previewSection: string
  durationMs: number
  /**
   * Produces or surgically updates the file relative to current `main` state
   * so that any parallel fork merges that already landed on `main` are preserved!
   */
  apply: (vcs: SessionWorktreeManager, mainDir: string, userTaskPrompt: string) => Promise<string>
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'atlas-store',
    name: 'Atlas Digital Storefront',
    nameAr: 'متجر أطلس للمنتجات التقنية',
    description:
      'Builds a multi-file e-commerce store (CSS tokens, catalog, cart with coupon engine, reviews & stats). Includes a real coupon math bug at Step 4 for the Observer to catch!',
    descriptionAr:
      'يبني متجراً إلكترونياً متكاملاً من 7 ملفات (الألوان، الواجهة، المنتجات، السلة وكود الخصم، التقييمات، والتفاعل). يتضمن خطأً حقيقياً في حساب الخصم بالخطوة 4 يكتشفه الوكيل المشاهد حياً!',
    defaultPrompt:
      'Build Atlas Tech Store with product cards, category filters, shopping cart with ATLAS20 coupon discount, and customer reviews.',
    defaultPromptAr:
      'قم ببناء متجر أطلس التقني مع بطاقات منتجات وتصنيفات وسلة مشتريات تدعم كود خصم ATLAS20 وقسم تقييمات العملاء.',
    quickForkSuggestions: [
      {
        label: 'Fix +20% Coupon Bug in cart.js',
        labelAr: 'إصلاح خطأ الخصم (+20%) في السلة',
        prompt:
          'Fix the discount bug in js/cart.js so coupon ATLAS20 subtracts 20% instead of adding 20%',
        promptAr: 'أصلح خطأ حساب الخصم في js/cart.js ليخصم 20% من المجموع بدلاً من إضافتها',
        category: 'bugfix',
      },
      {
        label: 'Switch Theme to Emerald & Gold',
        labelAr: 'تحويل الألوان للأخضر الزمردي',
        prompt: 'Change the theme color palette to emerald green with warm gold accents',
        promptAr: 'غيّر ألوان الموقع إلى الأخضر الزمردي الفاخر مع لمسات ذهبية',
        category: 'design',
      },
      {
        label: 'Add Instant Live Search Bar',
        labelAr: 'إضافة شريط بحث فوري للمنتجات',
        prompt: 'Add a live instant search bar above the product catalog to filter items in real time',
        promptAr: 'أضف شريط بحث فوري أعلى المنتجات لتصفية النتائج لحظياً أثناء الكتابة',
        category: 'feature',
      },
      {
        label: 'Add Currency Switcher (MAD/USD/EUR)',
        labelAr: 'إضافة محوّل عملات (درهم/دولار/يورو)',
        prompt: 'Add a live currency switcher supporting MAD, USD, and EUR in the header',
        promptAr: 'أضف محوّل عملات فوري يدعم الدرهم MAD والدولار USD واليورو EUR في الهيدر',
        category: 'feature',
      },
    ],
  },
  {
    id: 'pulse-analytics',
    name: 'Pulse SaaS Live Analytics',
    nameAr: 'لوحة نبض لتحليلات الإيرادات',
    description:
      'Builds an executive SaaS analytics dashboard (KPI cards, conversion formula, SVG revenue chart, transactions table & live alerts). Observer spots an impossible >400% conversion rate bug at Step 4!',
    descriptionAr:
      'يبني لوحة تحكم تحليلية متكاملة (مؤشرات الأداء، معادلة التحويل، رسم بياني تفاعلي للإيرادات، وجدول العمليات). يرصد المشاهد خطأً في معادلة التحويل بالخطوة 4!',
    defaultPrompt:
      'Build Pulse SaaS Analytics dashboard with live KPI cards, conversion metrics, interactive monthly revenue chart, and recent customer transactions.',
    defaultPromptAr:
      'قم ببناء لوحة تحكم نبض لتحليلات المبيعات مع بطاقات KPI ومعدل التحويل ورسم بياني تفاعلي للإيرادات وجدول أحدث العمليات.',
    quickForkSuggestions: [
      {
        label: 'Fix >400% Conversion Formula Bug',
        labelAr: 'إصلاح معادلة معدل التحويل الخاطئة',
        prompt:
          'Fix conversionRate formula in js/metrics.js to divide conversions by visitors instead of totalRevenue',
        promptAr:
          'أصلح معادلة معدل التحويل في js/metrics.js لتقسم عدد التحويلات على الزوار بدلاً من الإيرادات',
        category: 'bugfix',
      },
      {
        label: 'Add CSV Report Export Button',
        labelAr: 'إضافة زر تصدير التقرير CSV',
        prompt: 'Add an Export CSV button in the header to download the analytics dataset',
        promptAr: 'أضف زر تصدير CSV في أعلى اللوحة لتحميل بيانات العمليات فوراً',
        category: 'feature',
      },
      {
        label: 'Switch Palette to Warm Amber/Rose',
        labelAr: 'تغيير الثيم للبرتقالي الذهبي',
        prompt: 'Change dashboard accent colors to warm amber and coral rose',
        promptAr: 'غيّر ألوان لوحة التحكم إلى الذهبي الدافئ والمرجاني',
        category: 'design',
      },
      {
        label: 'Add Instant Search to Transactions',
        labelAr: 'إضافة بحث فوري في جدول العمليات',
        prompt: 'Add a live search input to filter customer transactions instantly',
        promptAr: 'أضف حقل بحث فوري لتصفية جدول العملاء والعمليات لحظياً',
        category: 'feature',
      },
    ],
  },
]

export function getScenarioSteps(scenarioId: string): SandboxBuildStep[] {
  if (scenarioId === 'pulse-analytics') {
    return buildPulseAnalyticsSteps()
  }
  return buildAtlasStoreSteps()
}

function buildAtlasStoreSteps(): SandboxBuildStep[] {
  return [
    {
      title: 'Create design system tokens & typography (styles/tokens.css)',
      titleAr: 'إنشاء نظام الألوان والمتغيرات البصرية (styles/tokens.css)',
      filePath: 'styles/tokens.css',
      previewSection: 'hero-section',
      durationMs: 3200,
      apply: async (vcs, mainDir) => {
        const content = `:root {
  --bg: #0b1020;
  --surface: #131a2e;
  --surface-elevated: #1a2440;
  --border: rgba(148, 163, 184, 0.16);
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --primary-glow: rgba(99, 102, 241, 0.28);
  --accent: #38bdf8;
  --success: #10b981;
  --danger: #f43f5e;
  --warning: #f59e0b;
  --radius: 14px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'IBM Plex Sans Arabic', 'Inter', system-ui, -apple-system, sans-serif;
  background: radial-gradient(circle at top right, var(--primary-glow), transparent 42%), var(--bg);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.55;
}
`
        await vcs.writeFileInWorktree(mainDir, 'styles/tokens.css', content)
        return content
      },
    },
    {
      title: 'Scaffold semantic storefront layout & hero (index.html)',
      titleAr: 'بناء هيكل المتجر والواجهة الرئيسية (index.html)',
      filePath: 'index.html',
      previewSection: 'hero-section',
      durationMs: 3800,
      apply: async (vcs, mainDir) => {
        const content = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>أطلس ستور — Atlas Tech Store</title>
  <link rel="stylesheet" href="./styles/tokens.css" />
  <link rel="stylesheet" href="./styles/components.css" />
</head>
<body>
  <div id="promo-slot"></div>

  <header class="topbar" id="header-section" data-section="hero-section" data-file="index.html">
    <div class="brand">
      <span class="brand-dot"></span>
      <strong id="store-title">أطلس ستور</strong>
      <span class="badge">2026</span>
    </div>
    <div class="header-actions" id="header-actions">
      <span class="cart-pill" id="cart-count-pill">السلة: 0 منتجات</span>
    </div>
  </header>

  <main class="container">
    <section class="hero" id="hero-section" data-section="hero-section" data-file="index.html">
      <div class="hero-tag">إصدارات المطورين وصنّاع المحتوى</div>
      <h1 id="hero-heading">معدّات تقنية احترافية مصممة للإنتاجية العالية</h1>
      <p id="hero-subtitle">اكتشف أحدث الأجهزة الذكية مع شحن سريع واستخدم كود الخصم <code>ATLAS20</code> للحصول على خصم 20% فوري.</p>
      <div id="custom-feature-slot"></div>
    </section>

    <section class="workspace-grid">
      <div class="catalog-col" id="catalog-section" data-section="catalog-section" data-file="js/catalog.js">
        <div class="section-head">
          <h2>المنتجات المختارة</h2>
          <div class="filter-bar" id="category-filters"></div>
        </div>
        <div id="search-slot"></div>
        <div class="product-grid" id="product-grid">
          <div class="skeleton-note">جاري تحميل كتالوج المنتجات...</div>
        </div>
      </div>

      <aside class="cart-card" id="cart-section" data-section="cart-section" data-file="js/cart.js">
        <h3>سلة المشتريات</h3>
        <div id="cart-items" class="cart-items">
          <p class="muted">جاري تهيئة محرك السلة...</p>
        </div>
        <div class="coupon-row">
          <input id="coupon-input" type="text" value="ATLAS20" placeholder="كود الخصم (ATLAS20)" />
          <button id="apply-coupon-btn" class="btn-secondary">تطبيق</button>
        </div>
        <div id="cart-summary" class="cart-summary"></div>
        <button id="checkout-btn" class="btn-primary full">إتمام الطلب الآن</button>
        <div id="checkout-toast" class="toast" hidden></div>
      </aside>
    </section>

    <section class="reviews-section" id="analytics-section" data-section="analytics-section" data-file="js/reviews.js">
      <h2>تقييمات العملاء الموثّقة</h2>
      <div id="reviews-grid" class="reviews-grid"></div>
    </section>
  </main>

  <script src="./js/catalog.js"></script>
  <script src="./js/cart.js"></script>
  <script src="./js/reviews.js"></script>
  <script src="./js/app.js"></script>
</body>
</html>
`
        await vcs.writeFileInWorktree(mainDir, 'index.html', content)
        return content
      },
    },
    {
      title: 'Style responsive product cards, header & cart panel (styles/components.css)',
      titleAr: 'تصميم بطاقات المنتجات والهيدر ولوحة السلة (styles/components.css)',
      filePath: 'styles/components.css',
      previewSection: 'hero-section',
      durationMs: 4200,
      apply: async (vcs, mainDir) => {
        const content = `.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 24px; border-bottom: 1px solid var(--border);
  background: rgba(15, 23, 42, 0.72); backdrop-filter: blur(12px);
  position: sticky; top: 0; z-index: 20;
}
.brand { display: flex; align-items: center; gap: 10px; font-size: 1.05rem; }
.brand-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 12px var(--primary); }
.badge { font-size: 0.72rem; padding: 2px 8px; border-radius: 99px; background: var(--primary-glow); color: var(--accent); border: 1px solid var(--border); }
.header-actions { display: flex; align-items: center; gap: 10px; }
.cart-pill { font-size: 0.82rem; padding: 5px 12px; border-radius: 99px; background: var(--surface-elevated); border: 1px solid var(--border); }

.container { max-width: 1040px; margin: 0 auto; padding: 22px 20px 48px; }
.hero {
  padding: 26px; border-radius: var(--radius); background: linear-gradient(135deg, var(--surface), var(--surface-elevated));
  border: 1px solid var(--border); margin-bottom: 22px;
}
.hero-tag { display: inline-block; font-size: 0.75rem; color: var(--accent); margin-bottom: 8px; font-weight: 600; }
.hero h1 { font-size: 1.55rem; margin-bottom: 8px; letter-spacing: -0.01em; }
.hero p { color: var(--text-muted); font-size: 0.92rem; }
.hero code { background: var(--bg); color: var(--accent); padding: 2px 7px; border-radius: 6px; font-family: monospace; }

.workspace-grid { display: grid; grid-template-columns: 1fr 310px; gap: 18px; align-items: start; }
@media (max-width: 780px) { .workspace-grid { grid-template-columns: 1fr; } }

.section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.section-head h2 { font-size: 1.1rem; }
.filter-bar { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  background: var(--surface); color: var(--text-muted); border: 1px solid var(--border);
  padding: 5px 11px; border-radius: 99px; font-size: 0.78rem; cursor: pointer; transition: 150ms;
}
.chip.active, .chip:hover { background: var(--primary); color: #fff; border-color: var(--primary); }

.search-box {
  width: 100%; padding: 9px 13px; margin-bottom: 12px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.88rem;
}
.search-box:focus { outline: 2px solid var(--primary); border-color: transparent; }

.product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 12px; }
.product-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 15px; display: flex; flex-direction: column; gap: 8px; transition: transform 150ms, border-color 150ms;
}
.product-card:hover { transform: translateY(-2px); border-color: var(--primary); }
.product-icon { font-size: 1.6rem; }
.product-cat { font-size: 0.72rem; color: var(--accent); font-weight: 600; }
.product-title { font-size: 0.95rem; font-weight: 600; }
.product-desc { font-size: 0.78rem; color: var(--text-muted); flex: 1; }
.product-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.price { font-weight: 700; font-size: 1rem; color: var(--text); }

.btn-primary {
  background: var(--primary); color: #fff; border: none; padding: 7px 13px;
  border-radius: 9px; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: 150ms;
}
.btn-primary:hover { background: var(--primary-hover); }
.btn-primary.full { width: 100%; padding: 10px; margin-top: 10px; }
.btn-secondary {
  background: var(--surface-elevated); color: var(--text); border: 1px solid var(--border);
  padding: 7px 11px; border-radius: 9px; font-size: 0.8rem; cursor: pointer;
}
.currency-select {
  background: var(--surface-elevated); color: var(--text); border: 1px solid var(--border);
  border-radius: 8px; padding: 4px 8px; font-size: 0.78rem; cursor: pointer;
}

.cart-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px; position: sticky; top: 68px;
}
.cart-card h3 { font-size: 1rem; margin-bottom: 10px; }
.cart-items { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.cart-item { display: flex; justify-content: space-between; align-items: center; font-size: 0.83rem; padding-bottom: 6px; border-bottom: 1px dashed var(--border); }
.coupon-row { display: flex; gap: 6px; margin-bottom: 10px; }
.coupon-row input { flex: 1; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; font-size: 0.8rem; }
.cart-summary { font-size: 0.84rem; display: flex; flex-direction: column; gap: 5px; padding: 10px; border-radius: 10px; background: var(--bg); }
.summary-row { display: flex; justify-content: space-between; }
.summary-row.total { font-weight: 700; font-size: 0.96rem; padding-top: 6px; border-top: 1px solid var(--border); }
.bug-badge { color: var(--danger); font-weight: 600; }
.ok-badge { color: var(--success); font-weight: 600; }

.promo-banner {
  background: linear-gradient(90deg, var(--primary), var(--accent)); color: #fff;
  text-align: center; padding: 7px 14px; font-size: 0.82rem; font-weight: 600;
}
.custom-callout {
  margin-top: 12px; padding: 9px 13px; border-radius: 10px;
  background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(16, 185, 129, 0.4);
  font-size: 0.83rem; color: var(--text);
}
.reviews-section { margin-top: 26px; }
.reviews-section h2 { font-size: 1.05rem; margin-bottom: 12px; }
.reviews-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.review-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; font-size: 0.83rem; }
.review-stars { color: var(--warning); margin-bottom: 5px; }
.muted, .skeleton-note { color: var(--text-muted); font-size: 0.83rem; }
.toast { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(16, 185, 129, 0.16); color: var(--success); font-size: 0.8rem; text-align: center; }
`
        await vcs.writeFileInWorktree(mainDir, 'styles/components.css', content)
        return content
      },
    },
    {
      title: 'Implement product catalog & category filter (js/catalog.js)',
      titleAr: 'برمجة كتالوج المنتجات ونظام التصنيفات (js/catalog.js)',
      filePath: 'js/catalog.js',
      previewSection: 'catalog-section',
      durationMs: 4500,
      apply: async (vcs, mainDir) => {
        const content = `window.ATLAS_CURRENCY = window.ATLAS_CURRENCY || { code: 'USD', symbol: '$', rate: 1 };

window.ATLAS_PRODUCTS = [
  { id: 'p1', title: 'لوحة مفاتيح ميكانيكية K8 Pro', category: 'ملحقات', price: 129, icon: '⌨️', desc: 'مفاتيح هادئة قابلة للتبديل مع إضاءة محيطية وهيكل ألمنيوم.' },
  { id: 'p2', title: 'سماعة عزل ضوضاء Studio ANC', category: 'صوتيات', price: 249, icon: '🎧', desc: 'صوت نقي عالي الدقة مع بطارية تدوم 45 ساعة متواصلة.' },
  { id: 'p3', title: 'شاشة احترافية 4K UltraSharp', category: 'شاشات', price: 420, icon: '🖥️', desc: 'دقة ألوان 99% DCI-P3 مع منفذ USB-C بقدرة 90 واط.' },
  { id: 'p4', title: 'ماوس لاسلكي مريح MX Flow', category: 'ملحقات', price: 95, icon: '🖱️', desc: 'حساس بدقة 8000 DPI وعجلة تمرير كهرومغناطيسية فائقة السرعة.' },
  { id: 'p5', title: 'ميكروفون بودكاست Wave USB', category: 'صوتيات', price: 159, icon: '🎙️', desc: 'فلتر داخلي مضاد للضجيج مثالي للبث المباشر والاجتماعات.' },
  { id: 'p6', title: 'وحدة تخزين سريعة NVMe 2TB', category: 'تخزين', price: 179, icon: '💾', desc: 'سرعة نقل تصل إلى 2000 ميجابايت/ثانية بحجم الجيب.' }
];

window.atlasState = {
  category: 'الكل',
  searchQuery: ''
};

window.formatAtlasPrice = function formatAtlasPrice(usdAmount) {
  const cur = window.ATLAS_CURRENCY || { code: 'USD', symbol: '$', rate: 1 };
  const val = (usdAmount * cur.rate).toFixed(cur.code === 'MAD' ? 0 : 2);
  return cur.code === 'MAD' ? val + ' د.م' : cur.symbol + val;
};

window.renderCatalog = function renderCatalog() {
  const grid = document.getElementById('product-grid');
  const filterEl = document.getElementById('category-filters');
  if (!grid || !filterEl) return;

  const categories = ['الكل', 'ملحقات', 'صوتيات', 'شاشات', 'تخزين'];
  filterEl.innerHTML = categories.map(function(cat) {
    const cls = window.atlasState.category === cat ? 'chip active' : 'chip';
    return '<button class="' + cls + '" onclick="window.setAtlasCategory(\\'' + cat + '\\')">' + cat + '</button>';
  }).join('');

  const q = (window.atlasState.searchQuery || '').trim().toLowerCase();
  const filtered = window.ATLAS_PRODUCTS.filter(function(p) {
    const matchCat = window.atlasState.category === 'الكل' || p.category === window.atlasState.category;
    const matchQ = !q || p.title.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="skeleton-note">لا توجد منتجات مطابقة لبحثك.</div>';
    return;
  }

  grid.innerHTML = filtered.map(function(p) {
    return '<article class="product-card">' +
      '<div class="product-icon">' + p.icon + '</div>' +
      '<span class="product-cat">' + p.category + '</span>' +
      '<div class="product-title">' + p.title + '</div>' +
      '<p class="product-desc">' + p.desc + '</p>' +
      '<div class="product-foot">' +
        '<span class="price">' + window.formatAtlasPrice(p.price) + '</span>' +
        '<button class="btn-primary" onclick="window.addToCart && window.addToCart(\\'' + p.id + '\\')">+ أضف</button>' +
      '</div>' +
    '</article>';
  }).join('');
};

window.setAtlasCategory = function setAtlasCategory(cat) {
  window.atlasState.category = cat;
  window.renderCatalog();
};

window.renderCatalog();
`
        await vcs.writeFileInWorktree(mainDir, 'js/catalog.js', content)
        return content
      },
    },
    {
      title: 'Implement shopping cart & ATLAS20 coupon engine (js/cart.js)',
      titleAr: 'برمجة سلة المشتريات وحساب كود الخصم ATLAS20 (js/cart.js)',
      filePath: 'js/cart.js',
      previewSection: 'cart-section',
      durationMs: 5200,
      apply: async (vcs, mainDir) => {
        // Contains a realistic subtle arithmetic bug (`1 + discountRate`) that Observer detects live!
        const content = `window.cartItems = [
  { id: 'p1', qty: 1 },
  { id: 'p2', qty: 1 }
];
window.activeCoupon = 'ATLAS20';

window.calculateCartTotals = function calculateCartTotals(subtotal, couponCode) {
  const discountRate = couponCode === 'ATLAS20' ? 0.20 : 0;
  // Subtle bug introduced by Builder: accidentally wrote (1 + discountRate) instead of (1 - discountRate)
  const finalTotal = discountRate > 0 ? subtotal * (1 + discountRate) : subtotal;
  const delta = finalTotal - subtotal;
  if (delta > 0) {
    console.warn('[cart.js] Coupon ATLAS20 increased total from ' + subtotal + ' to ' + finalTotal);
  }
  return { subtotal: subtotal, discountRate: discountRate, delta: delta, finalTotal: finalTotal };
};

window.addToCart = function addToCart(productId) {
  const found = window.cartItems.find(function(i) { return i.id === productId; });
  if (found) found.qty += 1;
  else window.cartItems.push({ id: productId, qty: 1 });
  window.renderCart();
};

window.renderCart = function renderCart() {
  const listEl = document.getElementById('cart-items');
  const sumEl = document.getElementById('cart-summary');
  const pillEl = document.getElementById('cart-count-pill');
  if (!listEl || !sumEl || !window.ATLAS_PRODUCTS) return;

  let subtotal = 0;
  let totalQty = 0;
  listEl.innerHTML = window.cartItems.map(function(entry) {
    const prod = window.ATLAS_PRODUCTS.find(function(p) { return p.id === entry.id; });
    if (!prod) return '';
    subtotal += prod.price * entry.qty;
    totalQty += entry.qty;
    return '<div class="cart-item"><span>' + prod.icon + ' ' + prod.title + ' ×' + entry.qty + '</span><strong>' + window.formatAtlasPrice(prod.price * entry.qty) + '</strong></div>';
  }).join('');

  if (pillEl) pillEl.textContent = 'السلة: ' + totalQty + ' منتجات';

  const totals = window.calculateCartTotals(subtotal, window.activeCoupon);
  const deltaClass = totals.delta > 0 ? 'bug-badge' : 'ok-badge';
  const deltaSign = totals.delta > 0 ? '+' : '-';
  const deltaText = deltaSign + window.formatAtlasPrice(Math.abs(totals.delta));

  sumEl.innerHTML =
    '<div class="summary-row"><span>المجموع الفرعي</span><span>' + window.formatAtlasPrice(totals.subtotal) + '</span></div>' +
    '<div class="summary-row"><span>كوبون (' + (window.activeCoupon || 'بدون') + ')</span><span class="' + deltaClass + '">' + deltaText + '</span></div>' +
    '<div class="summary-row total"><span>الإجمالي النهائي</span><span>' + window.formatAtlasPrice(totals.finalTotal) + '</span></div>';
};

window.renderCart();
`
        await vcs.writeFileInWorktree(mainDir, 'js/cart.js', content)
        return content
      },
    },
    {
      title: 'Build verified customer reviews & ratings module (js/reviews.js)',
      titleAr: 'بناء قسم تقييمات العملاء ونسب الرضا (js/reviews.js)',
      filePath: 'js/reviews.js',
      previewSection: 'analytics-section',
      durationMs: 5200,
      apply: async (vcs, mainDir) => {
        const content = `window.ATLAS_REVIEWS = [
  { author: 'سارة المنصوري — مطورة واجهات', stars: 5, text: 'لوحة K8 Pro غيّرت تجربة الكتابة اليومية بالكامل، صوت المفاتيح مذهل وجودة التصنيع ممتازة.' },
  { author: 'يوسف بنعلي — مهندس سحابي', stars: 5, text: 'شاشة 4K UltraSharp واضحة جداً في الإضاءة القوية وكابل USB-C الواحد رتّب مكتبي تماماً.' },
  { author: 'ليلى الشرقاوي — صانعة محتوى', stars: 4, text: 'ميكروفون Wave USB أعطاني جودة استوديو بدون أي إعدادات معقدة والتوصيل كان خلال 24 ساعة.' }
];

window.renderReviews = function renderReviews() {
  const el = document.getElementById('reviews-grid');
  if (!el) return;
  el.innerHTML = window.ATLAS_REVIEWS.map(function(r) {
    return '<div class="review-card">' +
      '<div class="review-stars">' + '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) + '</div>' +
      '<p style="margin-bottom:8px;">"' + r.text + '"</p>' +
      '<div class="muted">' + r.author + '</div>' +
    '</div>';
  }).join('');
};

window.renderReviews();
`
        await vcs.writeFileInWorktree(mainDir, 'js/reviews.js', content)
        return content
      },
    },
    {
      title: 'Wire interactive coupon handler, checkout flow & live refresh (js/app.js)',
      titleAr: 'ربط تفاعل الكوبون وإتمام الطلب والتشغيل النهائي (js/app.js)',
      filePath: 'js/app.js',
      previewSection: 'hero-section',
      durationMs: 4800,
      apply: async (vcs, mainDir) => {
        const existing = await vcs.readFileInWorktree(mainDir, 'js/app.js') || ''
        const coreWiring = `// Atlas Storefront Interactive Controller
(function initAtlasController() {
  const applyBtn = document.getElementById('apply-coupon-btn');
  const couponInput = document.getElementById('coupon-input');
  const checkoutBtn = document.getElementById('checkout-btn');
  const toast = document.getElementById('checkout-toast');

  if (applyBtn && couponInput) {
    applyBtn.addEventListener('click', function() {
      window.activeCoupon = couponInput.value.trim().toUpperCase();
      if (window.renderCart) window.renderCart();
    });
  }

  if (checkoutBtn && toast) {
    checkoutBtn.addEventListener('click', function() {
      toast.hidden = false;
      toast.textContent = '✓ تم استلام طلبك بنجاح! رقم التتبع #ATL-' + Math.floor(1000 + Math.random() * 9000);
      setTimeout(function() { toast.hidden = true; }, 4000);
    });
  }

  if (window.renderCatalog) window.renderCatalog();
  if (window.renderCart) window.renderCart();
  if (window.renderReviews) window.renderReviews();
})();
`
        // Preserve any fork widgets already appended to js/app.js
        const content = existing ? `${existing}\n${coreWiring}` : coreWiring
        await vcs.writeFileInWorktree(mainDir, 'js/app.js', content)
        return content
      },
    },
  ]
}

function buildPulseAnalyticsSteps(): SandboxBuildStep[] {
  return [
    {
      title: 'Define analytics color tokens & surface system (styles/tokens.css)',
      titleAr: 'إنشاء نظام الألوان لـ Pulse Analytics (styles/tokens.css)',
      filePath: 'styles/tokens.css',
      previewSection: 'hero-section',
      durationMs: 3200,
      apply: async (vcs, mainDir) => {
        const content = `:root {
  --bg: #090d16;
  --surface: #111827;
  --surface-elevated: #1e293b;
  --border: rgba(148, 163, 184, 0.16);
  --text: #f8fafc;
  --text-muted: #94a3b8;
  --primary: #0ea5e9;
  --primary-hover: #0284c7;
  --primary-glow: rgba(14, 165, 233, 0.24);
  --accent: #38bdf8;
  --success: #10b981;
  --danger: #f43f5e;
  --warning: #f59e0b;
  --radius: 14px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif;
  background: radial-gradient(circle at top left, var(--primary-glow), transparent 45%), var(--bg);
  color: var(--text); min-height: 100vh; line-height: 1.5;
}
.topbar { display:flex; justify-content:space-between; align-items:center; padding:14px 24px; border-bottom:1px solid var(--border); background:rgba(9,13,22,0.8); backdrop-filter:blur(10px); }
.brand { display:flex; align-items:center; gap:10px; }
.brand-dot { width:10px; height:10px; border-radius:50%; background:var(--primary); box-shadow:0 0 12px var(--primary); }
.header-actions { display:flex; align-items:center; gap:8px; }
.container { max-width:1040px; margin:0 auto; padding:22px 20px 44px; }
.kpi-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:20px; }
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px; }
.kpi-label { font-size:0.78rem; color:var(--text-muted); margin-bottom:6px; }
.kpi-val { font-size:1.55rem; font-weight:700; }
.kpi-val.bug { color:var(--danger); }
.kpi-sub { font-size:0.76rem; color:var(--success); margin-top:4px; }
.btn-primary { background:var(--primary); color:#fff; border:none; border-radius:9px; padding:7px 13px; font-size:0.8rem; font-weight:600; cursor:pointer; }
.search-box { width:100%; padding:8px 12px; margin-bottom:12px; border-radius:9px; border:1px solid var(--border); background:var(--bg); color:var(--text); }
table { width:100%; border-collapse:collapse; font-size:0.84rem; }
th, td { text-align:right; padding:10px 8px; border-bottom:1px solid var(--border); }
th { color:var(--text-muted); font-weight:500; font-size:0.78rem; }
.status-ok { color:var(--success); font-weight:600; }
.custom-callout { margin-bottom:14px; padding:9px 13px; border-radius:10px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.4); font-size:0.83rem; }
.promo-banner { background:linear-gradient(90deg, var(--primary), var(--accent)); color:#fff; text-align:center; padding:7px; font-size:0.82rem; font-weight:600; }
`
        await vcs.writeFileInWorktree(mainDir, 'styles/tokens.css', content)
        return content
      },
    },
    {
      title: 'Scaffold executive dashboard layout (index.html)',
      titleAr: 'بناء الهيكل الرئيسي للوحة التحكم (index.html)',
      filePath: 'index.html',
      previewSection: 'hero-section',
      durationMs: 3600,
      apply: async (vcs, mainDir) => {
        const content = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>نبض — Pulse SaaS Analytics</title>
  <link rel="stylesheet" href="./styles/tokens.css" />
</head>
<body>
  <div id="promo-slot"></div>
  <header class="topbar" id="hero-section" data-section="hero-section" data-file="index.html">
    <div class="brand">
      <span class="brand-dot"></span>
      <strong id="store-title">لوحة نبض للتحليلات</strong>
    </div>
    <div class="header-actions" id="header-actions">
      <span style="font-size:0.78rem;color:var(--text-muted);">تحديث مباشر • Q4 2026</span>
    </div>
  </header>
  <main class="container">
    <h1 id="hero-heading" style="font-size:1.35rem;margin-bottom:14px;">نظرة تنفيذية على الإيرادات والنمو</h1>
    <div id="custom-feature-slot"></div>
    <section class="kpi-grid" id="kpi-grid" data-section="analytics-section" data-file="js/metrics.js"></section>
    <section class="card" style="margin-bottom:18px;" id="chart-card" data-section="analytics-section" data-file="js/charts.js">
      <h2 style="font-size:1rem;margin-bottom:12px;">نمو الإيرادات الشهرية (MRR)</h2>
      <div id="chart-box"></div>
    </section>
    <section class="card" id="catalog-section" data-section="catalog-section" data-file="js/dataset.js">
      <h2 style="font-size:1rem;margin-bottom:10px;">أحدث اشتراكات العملاء</h2>
      <div id="search-slot"></div>
      <table>
        <thead><tr><th>العميل</th><th>الباقة</th><th>المبلغ</th><th>الحالة</th></tr></thead>
        <tbody id="tx-body"></tbody>
      </table>
    </section>
  </main>
  <script src="./js/dataset.js"></script>
  <script src="./js/metrics.js"></script>
  <script src="./js/charts.js"></script>
  <script src="./js/app.js"></script>
</body>
</html>
`
        await vcs.writeFileInWorktree(mainDir, 'index.html', content)
        return content
      },
    },
    {
      title: 'Load SaaS revenue & customer transactions dataset (js/dataset.js)',
      titleAr: 'إنشاء بيانات الإيرادات واشتراكات العملاء (js/dataset.js)',
      filePath: 'js/dataset.js',
      previewSection: 'catalog-section',
      durationMs: 4200,
      apply: async (vcs, mainDir) => {
        const content = `window.PULSE_DATA = {
  visitors: 18400,
  conversions: 920,
  totalRevenue: 88700,
  monthlyMrr: [42, 51, 58, 64, 76, 88.7],
  months: ['يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر'],
  transactions: [
    { customer: 'شركة المدار السحابي', plan: 'Enterprise', amount: 2400, status: 'مكتمل' },
    { customer: 'مختبرات أطلس AI', plan: 'Scale', amount: 890, status: 'مكتمل' },
    { customer: 'منصة بريق المالية', plan: 'Enterprise', amount: 3100, status: 'مكتمل' },
    { customer: 'استوديو أفق الرقمي', plan: 'Pro', amount: 290, status: 'مكتمل' },
    { customer: 'نواة للبرمجيات', plan: 'Scale', amount: 890, status: 'مكتمل' }
  ]
};
window.pulseQuery = '';
window.renderTransactions = function renderTransactions() {
  const tbody = document.getElementById('tx-body');
  if (!tbody) return;
  const q = (window.pulseQuery || '').trim().toLowerCase();
  const rows = window.PULSE_DATA.transactions.filter(function(t) {
    return !q || t.customer.toLowerCase().includes(q) || t.plan.toLowerCase().includes(q);
  });
  tbody.innerHTML = rows.map(function(t) {
    return '<tr><td>' + t.customer + '</td><td>' + t.plan + '</td><td>$' + t.amount + '</td><td class="status-ok">' + t.status + '</td></tr>';
  }).join('');
};
window.renderTransactions();
`
        await vcs.writeFileInWorktree(mainDir, 'js/dataset.js', content)
        return content
      },
    },
    {
      title: 'Compute KPI cards & conversion rate engine (js/metrics.js)',
      titleAr: 'برمجة بطاقات المؤشرات ومعادلة معدل التحويل (js/metrics.js)',
      filePath: 'js/metrics.js',
      previewSection: 'analytics-section',
      durationMs: 5200,
      apply: async (vcs, mainDir) => {
        const content = `window.renderMetrics = function renderMetrics() {
  const el = document.getElementById('kpi-grid');
  if (!el || !window.PULSE_DATA) return;
  const totalRevenue = window.PULSE_DATA.totalRevenue;
  const visitors = window.PULSE_DATA.visitors;
  const conversions = window.PULSE_DATA.conversions;
  // Bug: divides totalRevenue by visitors instead of conversions by visitors (>480%!)
  const conversionRate = ((totalRevenue / visitors) * 100).toFixed(1);
  const isBroken = Number(conversionRate) > 100;
  if (isBroken) {
    console.warn('[metrics.js] Anomaly: conversionRate computed as ' + conversionRate + '% (>100%)');
  }
  el.innerHTML =
    '<div class="card"><div class="kpi-label">إجمالي الإيرادات الشهرية</div><div class="kpi-val">$' + totalRevenue.toLocaleString() + '</div><div class="kpi-sub">+16.7% عن الشهر السابق</div></div>' +
    '<div class="card"><div class="kpi-label">الزوار النشطون</div><div class="kpi-val">' + visitors.toLocaleString() + '</div><div class="kpi-sub">+9.2% نمو عضوي</div></div>' +
    '<div class="card"><div class="kpi-label">معدل التحويل (Conversion)</div><div class="kpi-val ' + (isBroken ? 'bug' : '') + '">' + conversionRate + '%</div><div class="kpi-sub">' + (isBroken ? '⚠ قيمة غير منطقية!' : '✓ ضمن النطاق المثالي') + '</div></div>' +
    '<div class="card"><div class="kpi-label">الاشتراكات الجديدة</div><div class="kpi-val">' + conversions + '</div><div class="kpi-sub">متوسط العقد $96</div></div>';
};
window.renderMetrics();
`
        await vcs.writeFileInWorktree(mainDir, 'js/metrics.js', content)
        return content
      },
    },
    {
      title: 'Render interactive SVG bar chart for monthly MRR (js/charts.js)',
      titleAr: 'بناء الرسم البياني التفاعلي لنمو الإيرادات (js/charts.js)',
      filePath: 'js/charts.js',
      previewSection: 'analytics-section',
      durationMs: 5200,
      apply: async (vcs, mainDir) => {
        const content = `window.renderChart = function renderChart() {
  const box = document.getElementById('chart-box');
  if (!box || !window.PULSE_DATA) return;
  const vals = window.PULSE_DATA.monthlyMrr;
  const months = window.PULSE_DATA.months;
  const max = Math.max.apply(null, vals) * 1.12;
  const bars = vals.map(function(v, idx) {
    const h = Math.round((v / max) * 130);
    const x = 35 + idx * 92;
    const y = 150 - h;
    return '<g>' +
      '<rect x="' + x + '" y="' + y + '" width="52" height="' + h + '" rx="8" fill="var(--primary)" opacity="0.9" />' +
      '<text x="' + (x + 26) + '" y="' + (y - 7) + '" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="600">$' + v + 'k</text>' +
      '<text x="' + (x + 26) + '" y="172" text-anchor="middle" fill="var(--text-muted)" font-size="11">' + months[idx] + '</text>' +
    '</g>';
  }).join('');
  box.innerHTML = '<svg viewBox="0 0 600 185" style="width:100%;height:auto;display:block;">' + bars + '</svg>';
};
window.renderChart();
`
        await vcs.writeFileInWorktree(mainDir, 'js/charts.js', content)
        return content
      },
    },
    {
      title: 'Finalize live controller & auto-refresh hooks (js/app.js)',
      titleAr: 'ربط وحدات اللوحة وإنهاء التشغيل التفاعلي (js/app.js)',
      filePath: 'js/app.js',
      previewSection: 'hero-section',
      durationMs: 4500,
      apply: async (vcs, mainDir) => {
        const existing = await vcs.readFileInWorktree(mainDir, 'js/app.js') || ''
        const init = `// Pulse Analytics Controller
if (window.renderMetrics) window.renderMetrics();
if (window.renderChart) window.renderChart();
if (window.renderTransactions) window.renderTransactions();
`
        const next = existing ? `${existing}\n${init}` : init
        await vcs.writeFileInWorktree(mainDir, 'js/app.js', next)
        return next
      },
    },
  ]
}

/**
 * Applies the user's mid-run instruction inside the REAL isolated Fork Git Worktree (`forkDir`).
 * Supports rich Arabic & English commands (bug fixes, palette/theme changes, light mode,
 * instant search bar, currency switcher, CSV export, promo banners, selected DOM element edits,
 * AND arbitrary custom feature requests) so every single test in zero-key mode produces genuine,
 * visible code diffs and live preview changes!
 */
export async function applySandboxForkIntervention(params: {
  vcs: SessionWorktreeManager
  forkDir: string
  userPrompt: string
  selectedElement?: SelectedDomElement
  onFileChanged: (relPath: string, content: string) => void
}): Promise<{ filesModified: string[]; summary: string; summaryAr: string }> {
  const { vcs, forkDir, userPrompt, selectedElement, onFileChanged } = params
  const modified: string[] = []
  const write = async (relPath: string, content: string) => {
    await vcs.writeFileInWorktree(forkDir, relPath, content)
    if (!modified.includes(relPath)) modified.push(relPath)
    onFileChanged(relPath, content)
  }

  const p = userPrompt

  // 1. Fix cart.js coupon bug (+20% -> -20%)
  const cartJs = await vcs.readFileInWorktree(forkDir, 'js/cart.js')
  if (
    cartJs &&
    /خصم|سلة|كوبون|خطأ|خطا|أصلح|اصلح|إصلاح|اصلاح|discount|coupon|cart|bug|fix|20%/i.test(p) &&
    cartJs.includes('1 + discountRate')
  ) {
    const fixed = cartJs
      .replace(
        /\/\/ Subtle bug[\s\S]*?const finalTotal = [^\n]+/,
        '// Fixed by parallel Fork Agent: subtract 20% discount cleanly with non-negative guard\n  const finalTotal = Math.max(0, discountRate > 0 ? subtotal * (1 - discountRate) : subtotal);',
      )
      .replace(
        /if \(delta > 0\) \{[\s\S]*?\}/,
        "console.info('[cart.js] Verified ATLAS20 discount applied: saved ' + Math.abs(delta).toFixed(2));",
      )
    await write('js/cart.js', fixed)
    return {
      filesModified: modified,
      summary: 'Fixed ATLAS20 coupon calculation in js/cart.js to subtract 20% (1 - discountRate)',
      summaryAr: 'تم إصلاح دالة الخصم في js/cart.js لتخصم 20% بشكل صحيح بدلاً من إضافتها',
    }
  }

  // 2. Fix metrics.js conversionRate bug
  const metricsJs = await vcs.readFileInWorktree(forkDir, 'js/metrics.js')
  if (
    metricsJs &&
    /تحويل|معادلة|نسب|خطأ|خطا|أصلح|اصلح|إصلاح|اصلاح|conversion|formula|metric|bug|fix|400/i.test(p) &&
    metricsJs.includes('totalRevenue / visitors')
  ) {
    const fixed = metricsJs
      .replace(
        /\/\/ Bug:[^\n]*\n\s*const conversionRate = \(\(totalRevenue \/ visitors\) \* 100\)\.toFixed\(1\);/,
        '// Fixed by parallel Fork Agent: conversions / visitors bounded [0, 100]\n  const conversionRate = Math.min(100, (conversions / Math.max(1, visitors)) * 100).toFixed(2);',
      )
    await write('js/metrics.js', fixed)
    return {
      filesModified: modified,
      summary: 'Fixed conversionRate formula in js/metrics.js (now accurately shows 5.00%)',
      summaryAr: 'تم إصلاح معادلة معدل التحويل في js/metrics.js (تعرض الآن 5.00% بدقة)',
    }
  }

  // 3. Theme / Color palette mutations in styles/tokens.css
  const tokensCss = await vcs.readFileInWorktree(forkDir, 'styles/tokens.css')
  if (
    tokensCss &&
    /لون|ألوان|الوان|ثيم|فاتح|داكن|أخضر|اخضر|زمرد|ذهبي|برتقالي|أحمر|احمر|وردي|مرجان|بنفسجي|سماوي|colou?r|theme|palette|emerald|green|gold|amber|orange|rose|red|pink|light|purple|cyan/i.test(
      p,
    )
  ) {
    let next = tokensCss
    let paletteName = 'Emerald & Gold'
    let paletteNameAr = 'الأخضر الزمردي والذهبي'

    if (/فاتح|أبيض|ابيض|light|white/i.test(p)) {
      paletteName = 'Clean Light Mode'
      paletteNameAr = 'الوضع النهاري الفاتح'
      next = next
        .replace(/--bg:\s*[^;]+;/, '--bg: #f8fafc;')
        .replace(/--surface:\s*[^;]+;/, '--surface: #ffffff;')
        .replace(/--surface-elevated:\s*[^;]+;/, '--surface-elevated: #f1f5f9;')
        .replace(/--border:\s*[^;]+;/, '--border: rgba(15, 23, 42, 0.12);')
        .replace(/--text:\s*[^;]+;/, '--text: #0f172a;')
        .replace(/--text-muted:\s*[^;]+;/, '--text-muted: #475569;')
        .replace(/--primary:\s*[^;]+;/, '--primary: #0284c7;')
        .replace(/--primary-hover:\s*[^;]+;/, '--primary-hover: #0369a1;')
        .replace(/--primary-glow:\s*[^;]+;/, '--primary-glow: rgba(2, 132, 199, 0.14);')
        .replace(/--accent:\s*[^;]+;/, '--accent: #0f766e;')
    } else if (/ذهبي|برتقالي|مرجان|أحمر|احمر|وردي|amber|gold|orange|rose|red|pink|coral/i.test(p) && !/أخضر|اخضر|زمرد|emerald|green/i.test(p)) {
      paletteName = 'Warm Amber & Coral Rose'
      paletteNameAr = 'الذهبي الدافئ والمرجاني'
      next = next
        .replace(/--primary:\s*[^;]+;/, '--primary: #f59e0b;')
        .replace(/--primary-hover:\s*[^;]+;/, '--primary-hover: #d97706;')
        .replace(/--primary-glow:\s*[^;]+;/, '--primary-glow: rgba(245, 158, 11, 0.28);')
        .replace(/--accent:\s*[^;]+;/, '--accent: #fb7185;')
    } else {
      next = next
        .replace(/--bg:\s*[^;]+;/, '--bg: #061512;')
        .replace(/--surface:\s*[^;]+;/, '--surface: #0c221d;')
        .replace(/--surface-elevated:\s*[^;]+;/, '--surface-elevated: #12312a;')
        .replace(/--primary:\s*[^;]+;/, '--primary: #10b981;')
        .replace(/--primary-hover:\s*[^;]+;/, '--primary-hover: #059669;')
        .replace(/--primary-glow:\s*[^;]+;/, '--primary-glow: rgba(16, 185, 129, 0.30);')
        .replace(/--accent:\s*[^;]+;/, '--accent: #fbbf24;')
    }

    await write('styles/tokens.css', next)
    return {
      filesModified: modified,
      summary: `Updated design tokens in styles/tokens.css to ${paletteName}`,
      summaryAr: `تم تحديث نظام الألوان في styles/tokens.css إلى ثيم ${paletteNameAr}`,
    }
  }

  // 4. Add instant live search bar
  const indexHtml = await vcs.readFileInWorktree(forkDir, 'index.html')
  if (indexHtml && /بحث|فلتر|تصفية|search|filter/i.test(p)) {
    const isPulse = indexHtml.includes('tx-body')
    const searchHtml = isPulse
      ? `<input id="live-search-input" class="search-box" type="search" placeholder="🔍 ابحث باسم العميل أو الباقة فوراً..." oninput="window.pulseQuery=this.value; window.renderTransactions && window.renderTransactions();" />`
      : `<input id="live-search-input" class="search-box" type="search" placeholder="🔍 ابحث عن منتج أو فئة (مثلاً: شاشة، سماعة، K8)..." oninput="if(window.atlasState){window.atlasState.searchQuery=this.value;} window.renderCatalog && window.renderCatalog();" />`

    const nextHtml = indexHtml.includes('id="search-slot"')
      ? indexHtml.replace('<div id="search-slot"></div>', `<div id="search-slot">${searchHtml}</div>`)
      : indexHtml.replace('<main class="container">', `<main class="container">\n${searchHtml}`)
    await write('index.html', nextHtml)
    return {
      filesModified: modified,
      summary: 'Added real-time instant search & filtering input into index.html',
      summaryAr: 'تمت إضافة شريط بحث وتصفية فوري حي في index.html',
    }
  }

  // 5. Add live currency switcher (MAD / USD / EUR)
  if (indexHtml && /عملة|عملات|درهم|يورو|دولار|currency|mad|eur|usd/i.test(p)) {
    const switcher = `<select class="currency-select" aria-label="Currency" onchange="(function(v){var map={USD:{code:'USD',symbol:'$',rate:1},MAD:{code:'MAD',symbol:'د.م',rate:9.9},EUR:{code:'EUR',symbol:'€',rate:0.92}};window.ATLAS_CURRENCY=map[v];window.renderCatalog&&window.renderCatalog();window.renderCart&&window.renderCart();})(this.value)">
        <option value="MAD" selected>🇲🇦 MAD (درهم)</option>
        <option value="USD">🇺🇸 USD ($)</option>
        <option value="EUR">🇪🇺 EUR (€)</option>
      </select>`
    const nextHtml = indexHtml.replace(
      '<div class="header-actions" id="header-actions">',
      `<div class="header-actions" id="header-actions">\n      ${switcher}`,
    )
    await write('index.html', nextHtml)

    const catJs = await vcs.readFileInWorktree(forkDir, 'js/catalog.js')
    if (catJs) {
      write(
        'js/catalog.js',
        catJs.replace(
          "code: 'USD', symbol: '$', rate: 1",
          "code: 'MAD', symbol: 'د.م', rate: 9.9",
        ),
      )
    }
    return {
      filesModified: modified,
      summary: 'Added live MAD / USD / EUR currency switcher to header & pricing formatter',
      summaryAr: 'تمت إضافة محوّل العملات الحي (الدرهم MAD / الدولار / اليورو) وتحديث الأسعار فوراً',
    }
  }

  // 6. Add CSV export button
  if (indexHtml && /تصدير|تحميل|csv|export|download/i.test(p)) {
    const exportBtn = `<button class="btn-primary" onclick="(function(){var rows=(window.PULSE_DATA?window.PULSE_DATA.transactions.map(function(t){return t.customer+','+t.plan+','+t.amount;}):(window.ATLAS_PRODUCTS||[]).map(function(p){return p.title+','+p.category+','+p.price;}));var blob=new Blob(['Name,Category,Amount\\n'+rows.join('\\n')],{type:'text/csv;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='report.csv';a.click();})()">⬇ تصدير CSV</button>`
    const nextHtml = indexHtml.replace(
      '<div class="header-actions" id="header-actions">',
      `<div class="header-actions" id="header-actions">\n      ${exportBtn}`,
    )
    await write('index.html', nextHtml)
    return {
      filesModified: modified,
      summary: 'Added one-click CSV export action button to header',
      summaryAr: 'تمت إضافة زر تصدير البيانات بصيغة CSV في الشريط العلوي',
    }
  }

  // 7. Generic custom instruction or selected DOM element edit — always produces a clean, visible real code update!
  if (indexHtml) {
    const safeText = p.replace(/[<>&"]/g, '').trim().slice(0, 110)
    let nextHtml = indexHtml

    if (selectedElement?.selector === '#hero-heading' || /عنوان|heading|title/i.test(p)) {
      const quoted = p.match(/["«']([^"»']+)["»']/)
      const newTitle = quoted ? quoted[1] : safeText
      nextHtml = nextHtml.replace(
        /(<h1 id="hero-heading"[^>]*>)[\s\S]*?(<\/h1>)/,
        `$1${newTitle}$2`,
      )
    } else if (/بانر|إعلان|اعلان|شريط علوي|شحن|عرض|banner|promo|shipping/i.test(p)) {
      nextHtml = nextHtml.replace(
        '<div id="promo-slot"></div>',
        `<div id="promo-slot"><div class="promo-banner">⚡ ${safeText}</div></div>`,
      )
    } else {
      const elemTag = selectedElement ? ` (${selectedElement.selector})` : ''
      nextHtml = nextHtml.replace(
        '<div id="custom-feature-slot"></div>',
        `<div id="custom-feature-slot"><div class="custom-callout">✨ <strong>تحديث مباشر مُدمج${elemTag}:</strong> ${safeText}</div></div>`,
      )
    }

    await write('index.html', nextHtml)
    return {
      filesModified: modified,
      summary: `Applied mid-run fork update to index.html: "${safeText.slice(0, 60)}"`,
      summaryAr: `تم تنفيذ تعديلك المباشر في فرع مستقل ودمجه في index.html: "${safeText.slice(0, 55)}"`,
    }
  }

  // Ultra-early fork (during step 1 before index.html exists): update styles/tokens.css
  if (tokensCss) {
    const updated =
      tokensCss + `\n/* Mid-run human fork directive: ${p.replace(/\*\//g, '').slice(0, 100)} */\n`
    await write('styles/tokens.css', updated)
  }
  return {
    filesModified: modified,
    summary: `Applied fork patch: "${p.slice(0, 60)}"`,
    summaryAr: `تم تطبيق تعديل الانقسام: "${p.slice(0, 60)}"`,
  }
}
