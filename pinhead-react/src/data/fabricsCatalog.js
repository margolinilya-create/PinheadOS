// ═══════════════════════════════════════════════════════════════
// FABRICS_CATALOG_DEFAULT — каталог тканей (правки CRM 13.10)
// Источник: документ «правки срм», п. 3. Поставщики: Медас, ТД Коттон, ТониТекс
// + ткани для шопперов. priceRub — цена за 1 ПОГОННЫЙ МЕТР, ₽; mPerKg — метров
// в кг, только для пересчёта при закупке в кг (в цену изделия не входит).
// priceUSD = 0: прежнее поле хранило цену ЗА КГ в $, и формула множила её
// на метры — изделие дорожало втрое (сверка 13.10: 10,9 $ × 92,70 / 3,29 = 307,12 ₽/м)
// ═══════════════════════════════════════════════════════════════
/** @type {import('../types/catalog').Fabric[]} */
export const FABRICS_CATALOG_DEFAULT = [
  // ── МЕДАС — ЛЁГКИЕ ──
  { code:'medas-kulirnaya-100-160', name:'Кулирка', supplier:'Медас', composition:'100% хб', density:160, priceRub:307.12, unit:'m', mPerKg:3.29, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-100-180', name:'Кулирка', supplier:'Медас', composition:'100% хб', density:180, priceRub:308.09, unit:'m', mPerKg:3.09, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-100-250', name:'Кулирка', supplier:'Медас', composition:'100% хб', density:250, priceRub:503.7, unit:'m', mPerKg:2.16, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-100-300', name:'Кулирка', supplier:'Медас', composition:'100% хб', density:300, priceRub:685.96, unit:'m', mPerKg:1.71, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-92-165', name:'Кулирка', supplier:'Медас', composition:'92% хб / 8% лайкра', density:165, priceRub:316.16, unit:'m', mPerKg:3.28, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-92-200', name:'Кулирка', supplier:'Медас', composition:'92% хб / 8% лайкра', density:200, priceRub:371.48, unit:'m', mPerKg:2.7, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'medas-kulirnaya-92-230', name:'Кулирка', supplier:'Медас', composition:'92% хб / 8% лайкра', density:230, priceRub:441.28, unit:'m', mPerKg:2.35, priceUSD:0, forCategories:['tshirts','longsleeves'] },
  { code:'medas-pike-100-190', name:'Пике пачка', supplier:'Медас', composition:'100% хб', density:190, priceRub:443.13, unit:'m', mPerKg:2.11, priceUSD:0, forCategories:['tshirts','polo'] },
  { code:'medas-french-92-240', name:'Френч-терри (2-х нитка)', supplier:'Медас', composition:'92% хб / 8% лайкра', density:240, priceRub:457.99, unit:'m', mPerKg:2.19, priceUSD:0, forCategories:['sweatshirts','halfzips'] },
  { code:'medas-french-peach-92-240', name:'Френч-терри Peach с начёсом', supplier:'Медас', composition:'92% хб / 8% лайкра', density:240, priceRub:469.86, unit:'m', mPerKg:2.19, priceUSD:0, forCategories:['sweatshirts','halfzips'] },
  { code:'medas-french-pich-92-240', name:'Френч-терри Пич', supplier:'Медас', composition:'92% хб / 8% лайкра', density:240, priceRub:457.33, unit:'m', mPerKg:2.19, priceUSD:0, forCategories:['sweatshirts','halfzips'] },
  // ── МЕДАС — ТЯЖЁЛЫЕ ──
  { code:'medas-futher-petlya-65-320', name:'Футер 3-х нитка петля', supplier:'Медас', composition:'65% хб / 35% ПЭ', density:320, priceRub:488.17, unit:'m', mPerKg:1.69, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts'] },
  { code:'medas-futher-diag-65-320', name:'Футер 3-х нитка диагональ', supplier:'Медас', composition:'65% хб / 35% ПЭ', density:320, priceRub:543.2, unit:'m', mPerKg:1.69, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts'] },
  { code:'medas-futher-diag-100-350', name:'Футер 3-х нитка диагональ', supplier:'Медас', composition:'100% хб', density:350, priceRub:717.01, unit:'m', mPerKg:1.47, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'medas-futher-diag-80-320', name:'Футер 3-х нитка диагональ', supplier:'Медас', composition:'80% хб / 20% ПЭ', density:320, priceRub:580.49, unit:'m', mPerKg:1.64, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts'] },
  { code:'medas-futher-diag-excl-335', name:'Футер 3-х нитка диагональ эксклюзив', supplier:'Медас', composition:'85% хб / 15% ПЭ', density:335, priceRub:660.25, unit:'m', mPerKg:1.61, priceUSD:0, forCategories:['hoodies','sweatshirts','ziphoodies'] },
  { code:'medas-futher-velour-100-350', name:'Футер 3-х нитка велюр', supplier:'Медас', composition:'100% хб', density:350, priceRub:728.57, unit:'m', mPerKg:1.54, priceUSD:0, forCategories:['hoodies','ziphoodies'] },
  { code:'medas-futher-80-400', name:'Футер 3-х нитка диагональ эксклюзив', supplier:'Медас', composition:'80% хб / 20% ПЭ', density:400, priceRub:807.19, unit:'m', mPerKg:1.39, priceUSD:0, forCategories:['hoodies','ziphoodies','pants','bombers'] },
  { code:'medas-futher-barkhat-100-470', name:'Футер 3-х нитка диагональ бархатная', supplier:'Медас', composition:'100% хб', density:470, priceRub:1154.13, unit:'m', mPerKg:1.09, priceUSD:0, forCategories:['hoodies','ziphoodies'] },
  { code:'medas-futher-diag-100-470', name:'Футер 3-х нитка диагональ', supplier:'Медас', composition:'100% хб', density:470, priceRub:1107.34, unit:'m', mPerKg:1.09, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'medas-futher-nachez-65-320', name:'Футер 3-х нитка с начёсом', supplier:'Медас', composition:'65% хб / 35% ПЭ', density:320, priceRub:543.2, unit:'m', mPerKg:1.69, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies'] },
  // ── ТД КОТТОН — ЛЁГКИЕ ──
  { code:'cotton-kulirnaya-100-180', name:'Кулирка', supplier:'ТД Коттон', composition:'100% хб', density:180, priceRub:311.97, unit:'m', mPerKg:3.12, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-kulirnaya-100-230', name:'Кулирка', supplier:'ТД Коттон', composition:'100% хб', density:230, priceRub:415.42, unit:'m', mPerKg:2.41, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-kulirnaya-100-270', name:'Кулирка', supplier:'ТД Коттон', composition:'100% хб', density:270, priceRub:524.55, unit:'m', mPerKg:2.05, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-kulirnaya-90-200', name:'Кулирка', supplier:'ТД Коттон', composition:'90% хб / 10% лайкра', density:200, priceRub:345.99, unit:'m', mPerKg:2.84, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'cotton-pike-100-215', name:'Пике рулон', supplier:'ТД Коттон', composition:'100% хб', density:215, priceRub:399.96, unit:'m', mPerKg:2.48, priceUSD:0, forCategories:['tshirts','polo'] },
  { code:'cotton-french-95-250', name:'Френч-терри (2-х нитка)', supplier:'ТД Коттон', composition:'95% хб / 5% лайкра', density:250, priceRub:454.92, unit:'m', mPerKg:2.16, priceUSD:0, forCategories:['sweatshirts','halfzips'] },
  // ── ТД КОТТОН — ТЯЖЁЛЫЕ ──
  { code:'cotton-futher-petlya-70-350', name:'Футер 3-х нитка петля', supplier:'ТД Коттон', composition:'70% хб / 30% ПЭ', density:350, priceRub:559.81, unit:'m', mPerKg:1.54, priceUSD:0, forCategories:['hoodies','sweatshirts','ziphoodies','pants','shorts'] },
  { code:'cotton-futher-100-400', name:'Футер 3-х нитка', supplier:'ТД Коттон', composition:'100% хб', density:400, priceRub:767.67, unit:'m', mPerKg:1.28, priceUSD:0, forCategories:['hoodies','sweatshirts','ziphoodies','pants','bombers'] },
  { code:'cotton-futher-100-500', name:'Футер 3-х нитка', supplier:'ТД Коттон', composition:'100% хб', density:500, priceRub:999.71, unit:'m', mPerKg:1.02, priceUSD:0, forCategories:['hoodies','ziphoodies'] },
  { code:'cotton-futher-nachez-70-330', name:'Футер 3-х нитка с начёсом', supplier:'ТД Коттон', composition:'70% хб / 30% ПЭ', density:330, priceRub:540.28, unit:'m', mPerKg:1.63, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies'] },
  { code:'cotton-intersoft-65-320', name:'Интерсофт', supplier:'ТД Коттон', composition:'65% хб / 35% ПЭ', density:320, priceRub:556.2, unit:'m', mPerKg:1.6, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  // ── ТОНИТЕКС — ЛЁГКИЕ ──
  { code:'tonitex-kulirnaya-100-180', name:'Кулирка', supplier:'ТониТекс', composition:'100% хб', density:180, priceRub:372.17, unit:'m', mPerKg:3.09, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  { code:'tonitex-kulirnaya-92-200', name:'Кулирка', supplier:'ТониТекс', composition:'92% хб / 8% лайкра', density:200, priceRub:425.93, unit:'m', mPerKg:2.7, priceUSD:0, forCategories:['tshirts','longsleeves','polo'] },
  // ── ТОНИТЕКС — ТЯЖЁЛЫЕ ──
  { code:'tonitex-futher-100-340', name:'Футер 3-х нитка диагональ', supplier:'ТониТекс', composition:'100% хб', density:340, priceRub:644.35, unit:'m', mPerKg:1.63, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'tonitex-futher-90-330', name:'Футер 3-х нитка диагональ', supplier:'ТониТекс', composition:'90% хб / 10% ПЭ', density:330, priceRub:684.21, unit:'m', mPerKg:1.68, priceUSD:0, forCategories:['hoodies','sweatshirts','halfzips','ziphoodies','pants'] },
  { code:'tonitex-futher-100-380', name:'Футер 3-х нитка диагональ', supplier:'ТониТекс', composition:'100% хб', density:380, priceRub:809.86, unit:'m', mPerKg:1.42, priceUSD:0, forCategories:['hoodies','sweatshirts','ziphoodies','pants','bombers'] },
  { code:'tonitex-futher-100-430', name:'Футер 3-х нитка диагональ', supplier:'ТониТекс', composition:'100% хб', density:430, priceRub:891.47, unit:'m', mPerKg:1.29, priceUSD:0, forCategories:['hoodies','ziphoodies'] },
  { code:'tonitex-futher-100-490', name:'Футер 3-х нитка', supplier:'ТониТекс', composition:'100% хб', density:490, priceRub:1238.94, unit:'m', mPerKg:1.13, priceUSD:0, forCategories:['hoodies','ziphoodies'] },
  // ── ШОППЕРЫ (первая — ткань по умолчанию для сумок: Composite bag 0,9 м × 324,45 = 292,01 ₽) ──
  { code:'zenit-sarzha-100-270', name:'Саржа', supplier:'Зенит', composition:'100% хб', density:270, priceRub:324.45, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'canvas-55-280', name:'Канвас', supplier:'Не указан', composition:'55% хб / 45% ПЭ', density:280, priceRub:367.09, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'canvas-65-280', name:'Канвас', supplier:'Не указан', composition:'65% хб / 35% ПЭ', density:280, priceRub:329.09, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'baltex-sarzha-100-260', name:'Саржа суровая', supplier:'Балтекс', composition:'100% хб', density:260, priceRub:310.55, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'startex-canvas-100-260', name:'Канвас (беж, черн, хаки)', supplier:'Стартекс', composition:'100% хб', density:260, priceRub:477.41, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'startex-canvas-black-100-375', name:'Канвас (черн)', supplier:'Стартекс', composition:'100% хб', density:375, priceRub:740.67, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'bestfabrics-canvas-100-250', name:'Канвас', supplier:'Бест фабрикс', composition:'100% хб', density:250, priceRub:927, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'bestfabrics-canvas-100-340', name:'Канвас', supplier:'Бест фабрикс', composition:'100% хб', density:340, priceRub:927, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
  { code:'bestfabrics-canvas-100-435', name:'Канвас', supplier:'Бест фабрикс', composition:'100% хб', density:435, priceRub:1066.05, unit:'m', mPerKg:null, priceUSD:0, forCategories:['accessories'] },
];
// ── ОТДЕЛКА (trimCatalog) — раздельно по поставщикам, п. 4 ─────────────
// Рибана — футболки и лонги, кашкорсе — худи и свитшоты, воротник — поло и регбийки (шт.).
// Рибана 1×1 и 2×2 не сливаются с общей позицией до проверки характеристик.
/** @type {import('../types/catalog').Trim[]} */
export const TRIM_CATALOG_DEFAULT = [
  { code:'ribana-medas', name:'Рибана', supplier:'Медас', kind:'ribana', priceRub:600, unit:'m', mPerKg:2, priceUSD:0 },
  { code:'kashkorse-medas', name:'Кашкорсе', supplier:'Медас', kind:'kashkorse', priceRub:600, unit:'m', mPerKg:2, priceUSD:0 },
  { code:'ribana-cotton', name:'Рибана', supplier:'ТД Коттон', kind:'ribana', priceRub:579.38, unit:'m', mPerKg:2, priceUSD:0 },
  { code:'kashkorse-cotton', name:'Кашкорсе', supplier:'ТД Коттон', kind:'kashkorse', priceRub:579.38, unit:'m', mPerKg:2, priceUSD:0 },
  { code:'ribana-tonitex', name:'Рибана', supplier:'ТониТекс', kind:'ribana', priceRub:450.78, unit:'m', mPerKg:2.55, priceUSD:0 },
  { code:'kashkorse-tonitex', name:'Кашкорсе', supplier:'ТониТекс', kind:'kashkorse', priceRub:645.78, unit:'m', mPerKg:1.78, priceUSD:0 },
  { code:'ribana-tkanel', name:'Рибана', supplier:'Тканел', kind:'ribana', priceRub:772.5, unit:'m', mPerKg:2.1, priceUSD:0 },
  { code:'kashkorse-tkanel', name:'Кашкорсе', supplier:'Тканел', kind:'kashkorse', priceRub:820.17, unit:'m', mPerKg:2.1, priceUSD:0 },
  { code:'ribana-rutex', name:'Рибана', supplier:'Рутекс', kind:'ribana', priceRub:413.29, unit:'m', mPerKg:2.4, priceUSD:0 },
  { code:'kashkorse-rutex', name:'Кашкорсе', supplier:'Рутекс', kind:'kashkorse', priceRub:330.63, unit:'m', mPerKg:3, priceUSD:0 },
  { code:'collar-cotton', name:'Воротник к пике', supplier:'ТД Коттон', kind:'collar', priceRub:37.1, unit:'pcs', mPerKg:null, priceUSD:0 },
  { code:'collar-tonitex', name:'Воротник', supplier:'ТониТекс', kind:'collar', priceRub:49.2, unit:'pcs', mPerKg:null, priceUSD:0 },
  // legacy-коды моделей — обратная совместимость
  { code:'ribana-1x1', name:'Рибана 1×1', supplier:'Медас', kind:'ribana', priceRub:600, unit:'m', mPerKg:2, priceUSD:0 },
  { code:'ribana-2x2', name:'Рибана 2×2', supplier:'Медас', kind:'ribana', priceRub:600, unit:'m', mPerKg:2, priceUSD:0 },
  { code:'kashkorse', name:'Кашкорсе', supplier:'Медас', kind:'kashkorse', priceRub:600, unit:'m', mPerKg:2, priceUSD:0 },
];
export const FABRIC_SUPPLIERS = ['Медас', 'ТД Коттон', 'ТониТекс', 'Зенит', 'Балтекс', 'Стартекс', 'Бест фабрикс', 'Не указан'];
export const TRIM_SUPPLIERS = ['Медас', 'ТД Коттон', 'ТониТекс', 'Тканел', 'Рутекс'];
// Категории изделий по типу ткани
export const LAYER1_TYPES = ['tshirts','longsleeves','polo'];
export const LAYER2_TYPES = ['hoodies','sweatshirts','halfzips','ziphoodies','pants','shorts','bombers'];
