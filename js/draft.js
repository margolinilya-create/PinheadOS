// ════════════════════════════════════════════════════════════
//   DRAFT & AUTOSAVE
// ════════════════════════════════════════════════════════════
// localStorage draft save/load/reset, scheduled saving

// ─── AUTOSAVE ───
let saveTimer = null;
function saveDraft() {
  if (saveDraft._blocked) return;
  const draft = {
    ...state,
    sku: state.sku ? {article: state.sku.article, name: state.sku.name, category: state.sku.category, fit: state.sku.fit} : null,
    name:        document.getElementById('clientName')?.value || state.name,
    contact:     document.getElementById('clientContact')?.value || state.contact,
    email:       document.getElementById('clientEmail')?.value || state.email,
    phone:       document.getElementById('clientPhone')?.value || state.phone,
    messenger:   document.getElementById('clientMessenger')?.value || state.messenger,
    deadline:    document.getElementById('clientDeadline')?.value || state.deadline,
    address:     document.getElementById('clientAddress')?.value || state.address,
    notes:       document.getElementById('clientNotes')?.value || state.notes,
    designNotes: document.getElementById('designNotes')?.value || state.designNotes,
    sizeComment: document.getElementById('sizeComment')?.value || state.sizeComment,
    savedAt: Date.now()
  };
  try { localStorage.setItem('pinhead_draft', JSON.stringify(draft)); setDraftStatus('saved'); } catch(e){}
}
function scheduleSave() {
  setDraftStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 800);
}
function setDraftStatus(status) {
  const dot = document.getElementById('draftDot');
  const txt = document.getElementById('draftText');
  if (!dot || !txt) return;
  if (status === 'saved') {
    dot.style.background = 'var(--accent)';
    txt.style.color = 'var(--accent)';
    txt.textContent = 'сохранено';
    setTimeout(() => {
      dot.style.background = '';
      txt.style.color = '';
      txt.textContent = 'черновик';
    }, 2500);
  } else {
    dot.style.background = '';
    txt.style.color = '';
    txt.textContent = 'сохранение...';
  }
}
const VALID_ZONES = ['chest','back','left-sleeve','right-sleeve','front','back-bag','front-panel','back-panel','side-panel','side-a','side-b','hood','pocket','sleeve-l','sleeve-r'];
function loadDraft() {
  try {
    const raw = localStorage.getItem('pinhead_draft');
    if (!raw) return false;
    const draft = JSON.parse(raw);
    Object.assign(state, draft);
    state.step = 0;
    state.maxStep = 0; // сбрасываем — пусть пройдёт заново
    // Восстанавливаем SKU по article если есть
    if (state.sku && state.sku.article) {
      const found = SKU_CATALOG.find(s => s.article === state.sku.article);
      if (found) state.sku = found;
      else state.sku = null;
    } else if (!state.sku && state.type) {
      // Миграция: старый черновик без SKU — пытаемся найти SKU по типу+fit
      const CAT_FROM_TYPE = {'tee':'tshirt','longsleeve':'longsleeve','tank':'tank','hoodie':'hoodie','sweat':'sweatshirt','zip-hoodie':'zip-hoodie','half-zip':'half-zip','pants':'pants','shorts':'shorts','shopper':'shopper','basecap':'basecap','dad-cap':'dad-cap','5panel':'5panel','socks':'socks'};
      const cat = CAT_FROM_TYPE[state.type];
      if (cat) {
        const fit = state.fit || 'regular';
        const found = SKU_CATALOG.find(s => s.category === cat && s.fit === fit) || SKU_CATALOG.find(s => s.category === cat);
        if (found) state.sku = found;
      }
    }
    // Перенести старые размеры в новые ключи
    if (state.sizes && state.sizes['XXL'] && !state.sizes['2XL']) state.sizes['2XL'] = state.sizes['XXL'];
    if (state.sizes) { delete state.sizes['XXL']; }
    if (!state.customSizes) state.customSizes = [];
    // Фильтруем устаревшие зоны (collar, hem из старых версий)
    state.zones = (state.zones || []).filter(z => VALID_ZONES.includes(z));
    if (state.zones.length === 0) { const zz = getZonesForType(state.type); state.zones = zz.length ? [zz[0].id] : []; }
    // Миграция labelConfig из старого формата
    if (!state.labelConfig) state.labelConfig = migrateLabelData(state);
    // Убираем старые поля (заменены per-zone логикой)
    delete state.screenColors;
    // Очищаем zonePrints от невалидных зон
    if (state.zonePrints) {
      Object.keys(state.zonePrints).forEach(z => {
        if (!VALID_ZONES.includes(z)) delete state.zonePrints[z];
      });
    }
    return true;
  } catch(e) { return false; }
}
function clearDraft() {
  try { localStorage.removeItem('pinhead_draft'); } catch(e){}
}
async function resetDraft() {
  const ok = await showConfirm('Сбросить черновик?', 'Все введённые данные будут потеряны. Это действие нельзя отменить.', 'Сбросить');
  if (!ok) return;

  // 1. Блокируем сохранение сразу и навсегда до конца операции
  saveDraft._blocked = true;
  clearTimeout(saveTimer);

  // 2. Удаляем из localStorage ПЕРВЫМ ДЕЛОМ
  clearDraft();

  // 3. Сбрасываем state полностью
  Object.assign(state, {
    step:0, maxStep:0, type:'', fabric:'', color:'', sku:null,
    fit:'regular', fitChosen:false, extras:[], labels:[], zones:[], zonePrints:{}, sizes:{S:0,M:0,L:0,XL:0}, customSizes:[],
    name:'', contact:'', email:'', phone:'', messenger:'',
    deadline:'', address:'', notes:'', designNotes:'', sizeComment:'',
    urgent:false, label:false, pack:false, comment:'',
    labelOption:false, packOption:false, urgentOption:false,
    labelConfig: getDefaultLabelConfig(),
    file:null, zoneFiles:{}, generalFile:null
  });

  // 4. Очищаем все поля формы
  ['clientName','clientContact','clientEmail','clientPhone','clientMessenger',
   'orderComment','clientDeadline','clientAddress','clientNotes','designNotes','sizeComment'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['togglePack','toggleUrgent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });

  // 5. Сбрасываем секции (всё заблокировано пока нет изделия)
  // 6. Снимаем все визуальные выделения (карточки типа, ткани, цвета, зоны)
  document.querySelectorAll('[data-type],[data-fabric],[data-tech],[data-zone],[data-color]')
    .forEach(el => el.classList.remove('selected','active'));
  // Сбрасываем лекала — визуал
  document.querySelectorAll('.fit-option').forEach(el => el.classList.remove('selected'));
  ['regular','free','oversize'].forEach(f => {
    const chk = document.getElementById('fitcheck-'+f);
    if (chk) chk.textContent = '';
  });
  // Сбрасываем garment-row
  document.querySelectorAll('.garment-row').forEach(r => r.classList.remove('selected'));
  // Сбрасываем colorSelectedInfo
  const cInfo = document.getElementById('colorSelectedInfo');
  if (cInfo) cInfo.textContent = '';
  // Сбрасываем uploads
  const gUpText = document.getElementById('generalUploadText');
  const gUpInfo = document.getElementById('generalFileInfo');
  if (gUpText) gUpText.textContent = 'Загрузить общий макет';
  if (gUpInfo) gUpInfo.innerHTML = '';

  // 6. Перестраиваем ткань, палитру, таблицу размеров и обновляем итог
  renderSkuList();
  renderFabricGrid(state.type);
  renderSwatches();
  buildSizeTable();
  updateStepSections();
  updateTotal();

  // 7. Переходим на шаг 0
  state.step = 0;
  state.maxStep = 0;
  renderStep();

  // 8. Снова чистим localStorage — на случай если updateTotal/renderStep записали
  clearDraft();
  clearTimeout(saveTimer);

  // 9. Держим блокировку ещё 2 сек
  setTimeout(() => { saveDraft._blocked = false; }, 2000);

  setDraftStatus('saved');
  showToast('Черновик сброшен — начни заново');
}




