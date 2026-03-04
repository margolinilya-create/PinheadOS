// ════════════════════════════════════════════════════════════
//   NAVIGATION & STEPS
// ════════════════════════════════════════════════════════════
// Step rendering, goToStep, nextStep, prevStep, validation

// ─── NAVIGATION ───
function goToStep(n) { if (n > state.maxStep) return; state.step = n; renderStep(); window.scrollTo({top:0,behavior:"smooth"}); }
function nextStep() { if (!validateStep(state.step)) return; state.step = Math.min(state.step+1,5); state.maxStep = Math.max(state.maxStep, state.step); renderStep(); window.scrollTo({top:0,behavior:'smooth'}); scheduleSave(); }
function prevStep() { state.step = Math.max(state.step-1,0); renderStep(); window.scrollTo({top:0,behavior:'smooth'}); }
function renderStep() {
  document.querySelectorAll('.step-panel').forEach((p,i) => p.classList.toggle('active', i === state.step));
  document.querySelectorAll('.step-tab').forEach((t,i) => {
    t.classList.remove('active','done','visited');
    if (i === state.step) t.classList.add('active');
    else if (i < state.step) t.classList.add('done');
    else if (i <= state.maxStep) t.classList.add('visited');
  });
  // На шаге обработок — рендерим список обработок
  if (state.step === 1) renderExtrasStep();
  // На шаге дизайна — рендерим per-zone блоки и лейблы
  if (state.step === 2) { renderZonesGrid(); renderLabelsBlock(); }
  updateAccessoryUI();
  syncOneSizeInput();
  updateTotal();
  setTimeout(updateNextBtns, 50);
}


// ─── VALIDATION ───
function showToast(msg) {
  const t = document.getElementById('valToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function validateStep(step) {
  if (step === 0) {
    if (!state.type) { showToast('Выберите тип изделия'); return false; }
    const totalQty = getActiveTotalQty();
    if (totalQty < 1) { showToast('Укажите тираж — минимум 1 шт'); return false; }
    if (!isAccessory(state.type) && !state.color) { showToast('Выберите цвет изделия'); return false; }
    return true;
  }
  if (step === 1) {
    // Обработки — всегда можно пропустить
    return true;
  }
  if (step === 2) {
    if (hasNoPrint(state.type)) return true;
    if (state.noPrint) return true;
    if (!state.zones || state.zones.length === 0) { showToast('Выберите зону нанесения или нажмите «Без нанесения»'); return false; }
    return true;
  }
  if (step === 3) {
    const name = document.getElementById('clientName')?.value?.trim();
    if (!name) { showToast('Укажите имя или название компании'); return false; }
    return true;
  }
  return true;
}

function updateNextBtns() {
  const step = state.step;
  const btnId = step === 0 ? 'nextBtn0' : step === 1 ? 'nextBtn1' : step === 2 ? 'nextBtn2' : step === 3 ? 'nextBtn3' : null;
  if (!btnId) return;
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const ok = _silentValidate(step);
  btn.classList.toggle('disabled', !ok);
}

function _silentValidate(step) {
  if (step === 0) {
    if (!state.type) return false;
    const totalQty = getActiveTotalQty();
    if (totalQty < 1) return false;
    if (!isAccessory(state.type) && !state.color) return false;
    return true;
  }
  if (step === 1) { return true; } // Обработки — всегда можно пропустить
  if (step === 2) {
    if (hasNoPrint(state.type)) return true;
    if (state.noPrint) return true;
    if (!state.zones || state.zones.length === 0) return false;
    return true;
  }
  if (step === 3) {
    const name = document.getElementById('clientName')?.value?.trim();
    if (!name) return false;
    return true;
  }
  return true;
}








// ════════════════════════════════════════════════════════════
//   PROGRESSIVE SECTIONS
// ════════════════════════════════════════════════════════════
// updateStepSections, sec(), syncDividers, updateAccessoryUI, fit visibility

// ─── HIDE FABRIC/COLOR FOR ACCESSORIES ───
function _syncDividers() {
  const fabDiv = document.getElementById('fabricDivider');
  const colDiv = document.getElementById('colorDivider');
  const fabSec = document.getElementById('fabricSection');
  const colSec = document.getElementById('colorSection');
  if (fabDiv) fabDiv.style.display = (!fabSec || fabSec.style.display === 'none') ? 'none' : '';
  if (colDiv) colDiv.style.display = (!colSec || colSec.style.display === 'none') ? 'none' : '';
}

// ─── PROGRESSIVE DESIGN SECTIONS (step 1) ───
// Цепочка: Зоны → Техника → Загрузка + Комментарий
function updateDesignSections() {
  const techSec   = document.getElementById('zoneTechSection');
  const techPh    = document.getElementById('zoneTechPlaceholder');
  const uploadSec = document.getElementById('designUploadSection');
  const uploadPh  = document.getElementById('designUploadPlaceholder');
  const noPrintDesign = document.getElementById('noPrintDesignMsg');
  const noPrintBtnWrap = document.getElementById('noPrintBtnWrap');
  const noPrint   = hasNoPrint(state.type);
  const hasZones  = state.zones && state.zones.length > 0;

  // Для изделий без нанесения (носки) — скрываем всё
  if (noPrint) {
    if (techSec)   techSec.style.display   = 'none';
    if (techPh)    techPh.style.display    = 'none';
    if (uploadSec) uploadSec.style.display = 'none';
    if (uploadPh)  uploadPh.style.display  = 'none';
    if (noPrintDesign) noPrintDesign.style.display = '';
    if (noPrintBtnWrap) noPrintBtnWrap.style.display = 'none';
    return;
  }

  // Показать кнопку «Без нанесения»
  if (noPrintBtnWrap) noPrintBtnWrap.style.display = '';

  // «Без нанесения» выбрано
  if (state.noPrint) {
    if (techSec)   techSec.style.display   = 'none';
    if (techPh)    techPh.style.display    = 'none';
    if (uploadSec) uploadSec.style.display = 'none';
    if (uploadPh)  uploadPh.style.display  = 'none';
    if (noPrintDesign) noPrintDesign.style.display = '';
    return;
  }

  // Зоны не выбраны → техника locked, загрузка locked
  if (!hasZones) {
    if (techSec)   techSec.style.display   = 'none';
    if (techPh)    techPh.style.display    = 'none';
    if (uploadSec) uploadSec.style.display = 'none';
    if (uploadPh)  uploadPh.style.display  = 'none';
    if (noPrintDesign) noPrintDesign.style.display = 'none';
    return;
  }

  // Зоны выбраны → техника открыта, загрузка открыта, «Без нанесения» скрыт
  if (techSec)   techSec.style.display   = '';
  if (techPh)    techPh.style.display    = 'none';
  if (uploadSec) uploadSec.style.display = '';
  if (uploadPh)  uploadPh.style.display  = 'none';
  if (noPrintDesign) noPrintDesign.style.display = 'none';
}

function getFabricLabel(code) {
  if (!code) return '—';
  const fc = FABRICS_CATALOG.find(x => x.code === code);
  if (fc) return fc.name;
  const all = [...(FABRICS_LAYER1||[]), ...(FABRICS_LAYER2||[])];
  const f = all.find(x => x.key === code);
  return f ? f.name : code;
}

function updateStepSections() {
  const type    = state.type;
  const fabric  = state.fabric;
  const fit     = state.fit || 'regular';
  const isAcc   = isAccessory(type);
  const hasType   = !!type;
  const hasFabric = !!fabric;
  const hasColor  = !!state.color;

  // Лейблы для отображения в выполненных секциях
  function fabricLabel() {
    return getFabricLabel(fabric);
  }
  function fitLabel() {
    return {regular:'Regular', free:'Free Fit', oversize:'Oversize'}[fit] || fit;
  }

  // mode: 'active' — секция видна и раскрыта
  //       'locked' — скрыта, вместо неё серая плашка
  function sec(id, num, name, mode, hint) {
    const wrap = document.getElementById(id);
    if (!wrap) return;

    // Убираем старую плашку (она стоит ПОСЛЕ враппера)
    const ph = wrap.nextElementSibling;
    if (ph && ph.classList && ph.classList.contains('sec-placeholder')) {
      ph.remove();
    }

    if (mode === 'locked') {
      wrap.style.display = 'none';
      if (!name) return; // Не создаём пустую плашку
      const el = document.createElement('div');
      el.className = 'sec-placeholder';
      el.innerHTML =
        '<span class="sec-ph-num">' + (num||'') + '</span>' +
        '<span class="sec-ph-name">' + name + '</span>' +
        '<span class="sec-ph-hint">' + (hint||'') + '</span>';
      wrap.parentNode.insertBefore(el, wrap.nextSibling);
    } else {
      wrap.style.display = '';
    }
  }

  // ── Шаг 0: изделие не выбрано — всё закрыто ──
  if (!hasType) {
    sec('fitSection',    '', '',                   'locked', '');
    sec('fabricSection', '02', 'Ткань',            'locked', 'после выбора изделия');
    sec('colorSection',  '03', 'Цвет базы',        'locked', 'после выбора ткани');
    sec('sizeSection',   '04', 'Размерная сетка',  'locked', 'после выбора цвета');
    _syncDividers();
    return;
  }

  // ── Аксессуары: лекала/ткань/цвет не нужны — сразу размеры ──
  if (isAcc) {
    sec('fitSection',    '', '', 'locked', '');
    sec('fabricSection', '', '', 'locked', '');
    sec('colorSection',  '', '', 'locked', '');
    sec('sizeSection',   '02', 'Количество', 'active', '');
    _syncDividers();
    return;
  }

  // ── Одежда: строгая цепочка 1→2→3→4 ──
  const hasFit = !!state.sku || !!state.fitChosen;

  // 1. Изделие выбрано → fit через SKU, пропускаем лекала
  sec('fitSection', '', '', 'locked', '');

  // 2. SKU не выбрано — всё остальное закрыто
  if (!hasFit) {
    sec('fabricSection', '02', 'Ткань',            'locked', 'после выбора изделия');
    sec('colorSection',  '03', 'Цвет базы',        'locked', 'после выбора ткани');
    sec('sizeSection',   '04', 'Размерная сетка',  'locked', 'после выбора цвета');
    _syncDividers();
    return;
  }

  // 3. SKU выбрано → открываем ткань
  sec('fabricSection', '02', 'Ткань', 'active', '');

  // 4. Ткань не выбрана → цвет и размеры закрыты
  if (!hasFabric) {
    sec('colorSection', '03', 'Цвет базы',       'locked', 'после выбора ткани');
    sec('sizeSection',  '04', 'Размерная сетка', 'locked', 'после выбора цвета');
    _syncDividers();
    return;
  }

  // 5. Ткань выбрана → открываем цвет
  sec('colorSection', '03', 'Цвет базы', 'active', '');

  // 6. Цвет не выбран → размеры закрыты
  sec('sizeSection', '04', 'Размерная сетка', hasColor ? 'active' : 'locked', 'после выбора цвета');
  _syncDividers();
}


function updateAccessoryUI() {
  const acc = isAccessory(state.type);
  // Для аксессуаров — скрываем ткань/цвет целиком
  // Для одежды — НЕ трогаем display, этим управляет updateStepSections
  if (acc) {
    ['fabricSection','fabricDivider','colorSection','colorDivider'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  // Для аксессуаров — размерная сетка заменяется на ONE SIZE
  const sizeLabel = document.getElementById('sizeLabel');
  const sizeTable = document.querySelector('.size-table');
  const addSizeBtn = document.querySelector('.add-size-btn');
  const oneSizeWrap = document.getElementById('oneSizeWrap');

  if (acc) {
    if (sizeLabel) sizeLabel.textContent = 'Количество';
    if (sizeTable) sizeTable.style.display = 'none';
    if (addSizeBtn) addSizeBtn.style.display = 'none';
    if (oneSizeWrap) oneSizeWrap.style.display = 'flex';
  } else {
    if (sizeLabel) sizeLabel.textContent = 'Размерная сетка';
    if (sizeTable) sizeTable.style.display = '';
    if (addSizeBtn) addSizeBtn.style.display = '';
    if (oneSizeWrap) oneSizeWrap.style.display = 'none';
  }
}


// ─── FIT VISIBILITY (stub for accessories) ───
function updateFitVisibility() {
  const fitWrap = document.querySelector('.fit-selector');
  const fitLabel = Array.from(document.querySelectorAll('.section-label')).find(el => el.textContent.includes('Вид лекал'));
  const hide = isAccessory(state.type);
  if (fitWrap)  fitWrap.style.display  = hide ? 'none' : '';
  if (fitLabel) fitLabel.style.display = hide ? 'none' : '';
}


// ─── ACCESSORY CONFIG ───
const ACCESSORY_TYPES = ['shopper','basecap','dad-cap','5panel','socks'];
const NO_PRINT_TYPES  = ['socks']; // без нанесения вообще

const ACC_ZONES = {
  'shopper':  [{id:'front',  label:'Лицевая сторона'}, {id:'back-bag', label:'Обратная сторона'}],
  'basecap':  [{id:'front-panel', label:'Тулья спереди'}, {id:'back-panel', label:'Тулья сзади'}, {id:'side-panel', label:'Боковая панель'}],
  'dad-cap':  [{id:'front-panel', label:'Тулья спереди'}, {id:'back-panel', label:'Тулья сзади'}, {id:'side-panel', label:'Боковая панель'}],
  '5panel':   [{id:'front-panel', label:'Тулья спереди'}, {id:'back-panel', label:'Тулья сзади'}, {id:'side-panel', label:'Боковая панель'}],
};

const GARMENT_ZONES = [
  {id:'chest',       label:'Грудь'},
  {id:'back',        label:'Спина'},
  {id:'left-sleeve', label:'Лев. рукав'},
  {id:'right-sleeve',label:'Прав. рукав'},
];

function isAccessory(type) {
  if (ACCESSORY_TYPES.includes(type||state.type)) return true;
  if (state.sku && state.sku.category === 'accessories') return true;
  return false;
}
function hasNoPrint(type)   { return NO_PRINT_TYPES.includes(type||state.type); }
function getZonesForType(type) {
  if (hasNoPrint(type)) return [];
  // Если выбран SKU — используем зоны из SKU
  if (state.sku && state.sku.zones && state.sku.zones.length > 0) {
    return state.sku.zones.map(zId => {
      const found = ALL_PRINT_ZONES.find(pz => pz.id === zId);
      return found ? {id: found.id, label: found.name} : {id: zId, label: zId};
    });
  }
  return ACC_ZONES[type] || GARMENT_ZONES.map(z => ({id: z.id, label: z.label}));
}


function renderZonesGrid() {
  const container = document.getElementById('zonesGridContainer');
  const noPrintMsg  = document.getElementById('noPrintMsg');
  if (!container) return;

  const zones = getZonesForType(state.type);

  // Нет нанесения (носки)
  if (zones.length === 0) {
    container.innerHTML = '';
    if (noPrintMsg)  noPrintMsg.style.display = 'block';
    updateDesignSections();
    return;
  }

  if (noPrintMsg)  noPrintMsg.style.display = 'none';

  // Сбросить зоны если тип изменился и старые зоны не подходят
  const validIds = zones.map(z => z.id);
  state.zones = (state.zones||[]).filter(z => validIds.includes(z));
  if (state.zones.length === 0 && zones.length > 0) {
    state.zones = [zones[0].id];
  }

  container.innerHTML = zones.map(z => {
    const sel = state.zones.includes(z.id);
    return `<div class="zone-card${sel?' selected':''}" data-zone="${z.id}" onclick="toggleZone(this,'${z.id}')">
      <div class="zone-bar"></div>
      <div class="zone-card-inner"><div class="zone-label">${z.label}</div></div>
      <div class="zone-check">✓</div>
    </div>`;
  }).join('');

  // Обновить grid колонки под кол-во зон
  container.style.gridTemplateColumns = `repeat(${Math.min(zones.length, 4)}, 1fr)`;
  renderZoneTechBlocks();
  updateDesignSections();
}




