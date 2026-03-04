// ════════════════════════════════════════════════════════════
//   ORDER HISTORY
// ════════════════════════════════════════════════════════════
// Local + cloud history, render, delete, status

// ─── ORDER HISTORY ───
function getOrders() { try { return JSON.parse(localStorage.getItem('ph_orders')||'[]'); } catch(e){ return []; } }
function saveOrders(orders) { try { localStorage.setItem('ph_orders',JSON.stringify(orders)); } catch(e){} }

async function saveAndFinish() {
  showSpinner('Сохранение заказа...');
  const fields = {name:'clientName',contact:'clientContact',email:'clientEmail',deadline:'clientDeadline',address:'clientAddress',notes:'clientNotes'};
  Object.entries(fields).forEach(([k,id]) => { const el=document.getElementById(id); if(el) state[k]=el.value||''; });
  const dn = document.getElementById('designNotes'); if(dn) state.designNotes=dn.value||'';
  state.packOption   = !!document.getElementById('togglePack')?.checked;
  state.urgentOption = !!document.getElementById('toggleUrgent')?.checked;

  const totalQty = getActiveTotalQty();
  const bitrixEl = document.getElementById('bitrixDeal');
  const artworkEl = document.getElementById('artworkLink');

  const orderData = {
    type:state.type, fabric:state.fabric, fit:state.fit, color:state.color,
    sizes:{...state.sizes}, customSizes:[...(state.customSizes||[])],
    totalQty, zones:[...state.zones], tech:state.tech,
    zoneTechs:state.zoneTechs ? {...state.zoneTechs} : {},
    zonePrints:state.zonePrints ? JSON.parse(JSON.stringify(state.zonePrints)) : {},
    flexZones:state.flexZones ? JSON.parse(JSON.stringify(state.flexZones)) : {},
    dtgZones:state.dtgZones ? JSON.parse(JSON.stringify(state.dtgZones)) : {},
    embZones:state.embZones ? JSON.parse(JSON.stringify(state.embZones)) : {},
    dtfZones:state.dtfZones ? JSON.parse(JSON.stringify(state.dtfZones)) : {},
    zoneArtworks:state.zoneArtworks ? {...state.zoneArtworks} : {},
    textileColor:state.textileColor, dtgTextile:state.dtgTextile,
    designNotes:state.designNotes, role:state.role,
    name:state.name, contact:state.contact, email:state.email,
    deadline:state.deadline, address:state.address, notes:state.notes,
    packOption:state.packOption, urgentOption:state.urgentOption,
    labelConfig: state.labelConfig ? JSON.parse(JSON.stringify(state.labelConfig)) : getDefaultLabelConfig(),
    total:calcTotal(),
    bitrix_deal: bitrixEl?.value?.trim() || null,
    artwork_link: artworkEl?.value?.trim() || null
  };

  let saved;
  const isEditing = !!state._editingOrderId;

  if (isEditing) {
    // UPDATE существующего заказа
    saved = await updateOrderCloud(state._editingOrderId, orderData);
  } else {
    // INSERT нового заказа
    saved = await saveOrderCloud(orderData);
  }

  const orderNum = saved?.order_number || state._editingOrderNumber || ('PH-' + Date.now().toString(36).toUpperCase());
  const displayNum = saved?.bitrix_deal || orderNum;
  state._lastSavedOrderNum = displayNum;

  // Сбросить кеш и обновить локал
  _cloudOrders = null;
  const localOrder = { ...orderData, id: saved?.id || orderNum, order_number: orderNum, status: saved?.status || 'draft', createdAt:Date.now() };
  const orders = getOrders();
  if (isEditing) {
    const idx = orders.findIndex(o => o.id === state._editingOrderId);
    if (idx >= 0) orders[idx] = localOrder; else orders.unshift(localOrder);
  } else {
    orders.unshift(localOrder);
  }
  saveOrders(orders);

  document.getElementById('orderId').textContent = displayNum;
  clearDraft();
  state._editingOrderId = null;
  state._editingOrderNumber = null;
  state.step = 5;
  renderStep();
  updateHistoryBadge();
  showToast(isEditing ? 'Заказ ' + displayNum + ' обновлён ✓' : 'Заказ ' + displayNum + ' создан ✓');
  hideSpinner();
}

let historyFilterActive = 'all';
let historySortActive = 'date';
let historySortDir = 'desc';
let statusTargetId = null;

function toggleHistory() {
  const panel = document.getElementById('ordersPage');
  if (panel.classList.contains('open')) closeHistory(); else openHistory();
}
async function openHistory() {
  document.getElementById('ordersPage').classList.add('open');
  document.getElementById('historyBtn').classList.add('active');
  _cloudOrders = null;
  await renderKanban();
}
function closeHistory() {
  document.getElementById('ordersPage').classList.remove('open');
  document.getElementById('historyBtn').classList.remove('active');
  closeStatusDropdown();
}

async function updateHistoryBadge() {
  const badge = document.getElementById('historyBadge');
  if (!badge) return;
  const orders = await loadCloudOrders();
  if (orders.length > 0) { badge.style.display=''; badge.textContent=orders.length; }
  else {
    const local = getOrders();
    if (local.length > 0) { badge.style.display=''; badge.textContent=local.length; }
    else { badge.style.display='none'; }
  }
}

function setHistoryFilter(filter, btn) {
  historyFilterActive = filter;
  document.querySelectorAll('.history-filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderHistory();
}

function setHistorySort(sort, btn) {
  if (historySortActive === sort) {
    historySortDir = historySortDir === 'desc' ? 'asc' : 'desc';
  } else {
    historySortActive = sort;
    historySortDir = 'desc';
  }
  document.querySelectorAll('.history-sort-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  btn.textContent = (historySortDir === 'desc' ? '↓ ' : '↑ ') + btn.textContent.replace(/^[↓↑] /, '');
  renderHistory();
}

let _cloudOrders = null;
let _cloudLoading = false;

async function loadCloudOrders(force) {
  if (_cloudLoading) return _cloudOrders || [];
  if (_cloudOrders && !force) return _cloudOrders;
  _cloudLoading = true;
  // v1.6: таймаут 10 сек — если запрос зависнет, кеш разблокируется
  const timeout = setTimeout(() => { _cloudLoading = false; }, 10000);
  try {
    const { data, error } = await supa.from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (!error && data) _cloudOrders = data;
  } catch(e) { console.log('Supabase offline'); }
  clearTimeout(timeout);
  _cloudLoading = false;
  return _cloudOrders || [];
}

var _kanbanStatusFilter = 'all';

function setKanbanFilter(status) {
  _kanbanStatusFilter = status;
  document.querySelectorAll('.kanban-filter-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.status === status); });
  renderKanban();
}

function exportKanbanExcel() {
  if (typeof XLSX === 'undefined') { showToast('XLSX не загружен'); return; }
  loadCloudOrders(true).then(function(orders){
    if (!orders.length) { showToast('Нет заказов'); return; }
    var rows = orders.map(function(o){
      var d = o.data || {};
      return {
        'ID': o.order_number || o.id,
        'Bitrix': o.bitrix_deal || '',
        'Статус': {draft:'Черновик',review:'Согласование',approved:'Одобрен',production:'В работе',done:'Готов'}[o.status] || o.status,
        'Клиент': d.name || '—',
        'Изделие': d.sku ? d.sku.name : (TYPE_NAMES[o.item_type]||''),
        'Тираж': o.total_qty || 0,
        'Сумма': o.total_sum || 0,
        'Дата': new Date(o.created_at).toLocaleDateString('ru-RU')
      };
    });
    var ws = XLSX.utils.json_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Заказы');
    XLSX.writeFile(wb, 'pinhead-orders-' + new Date().toISOString().slice(0,10) + '.xlsx');
    showToast('Excel выгружен');
  });
}

async function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  const statsBar = document.getElementById('kanbanStats');
  if (!board) return;

  board.innerHTML = '<div style="padding:40px;text-align:center;color:#888">Загрузка...</div>';

  let orders = await loadCloudOrders();
  if (!orders.length) {
    const local = getOrders();
    if (local.length) orders = local.map(o => ({
      id: o.id, order_number: o.order_number || o.id,
      bitrix_deal: o.bitrix_deal, status: o.status || 'draft',
      data: o, total_sum: o.total || 0, total_qty: o.totalQty || 0,
      item_type: o.type, created_at: new Date(o.createdAt).toISOString()
    }));
  }

  const q = (document.getElementById('kanbanSearch')?.value||'').toLowerCase().trim();
  if (q) orders = orders.filter(o =>
    (o.order_number||'').toLowerCase().includes(q) ||
    (o.bitrix_deal||'').toLowerCase().includes(q) ||
    (o.data?.name||'').toLowerCase().includes(q) ||
    (o.data?.sku?.name||'').toLowerCase().includes(q) ||
    (o.data?.sku?.article||'').toLowerCase().includes(q) ||
    (TYPE_NAMES[o.item_type]||'').toLowerCase().includes(q)
  );

  const statuses = ['draft','review','approved','production','done'];
  const statusLabels = {draft:'Черновик',review:'Согласование',approved:'Одобрен',production:'В работе',done:'Готов'};
  const statusColors = {draft:'#888',review:'#b89000',approved:'#1D19EA',production:'#c04500',done:'#007840'};

  const grouped = {};
  statuses.forEach(s => grouped[s] = []);
  orders.forEach(o => {
    const s = statuses.includes(o.status) ? o.status : 'draft';
    grouped[s].push(o);
  });

  statuses.forEach(s => {
    grouped[s].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  });

  // Stats bar — black with accent total
  const totalRev = orders.reduce((a,o) => a + (o.total_sum||0), 0);
  const totalQty = orders.reduce((a,o) => a + (o.total_qty||0), 0);
  statsBar.innerHTML =
    '<div class="ks-item"><span class="ks-count">' + orders.length + '</span> заказов</div>' +
    '<div class="ks-separator"></div>' +
    '<div class="ks-item"><span class="ks-count">' + totalQty.toLocaleString('ru') + '</span> шт</div>' +
    '<div class="ks-separator"></div>' +
    '<div class="ks-item"><span class="ks-total">' + totalRev.toLocaleString('ru') + ' \u20bd</span></div>' +
    '<div style="flex:1"></div>' +
    statuses.map(s => '<div class="ks-item"><span class="ks-dot" style="background:' + statusColors[s] + '"></span><span class="ks-count" style="color:' + statusColors[s] + '">' + grouped[s].length + '</span></div>').join('');

  // Filter bar
  var filterBar = document.getElementById('kanbanFilterBar');
  if (!filterBar) {
    filterBar = document.createElement('div');
    filterBar.id = 'kanbanFilterBar';
    filterBar.className = 'kanban-filter-bar';
    statsBar.parentNode.insertBefore(filterBar, board);
  }
  filterBar.innerHTML =
    '<div class="kanban-filter-btn' + (_kanbanStatusFilter==='all'?' active':'') + '" data-status="all" onclick="setKanbanFilter(\'all\')">Все</div>' +
    statuses.map(s => '<div class="kanban-filter-btn' + (_kanbanStatusFilter===s?' active':'') + '" data-status="' + s + '" onclick="setKanbanFilter(\'' + s + '\')"><span class="kf-dot" style="background:' + statusColors[s] + '"></span>' + statusLabels[s] + '</div>').join('') +
    '<button class="kanban-export-btn" onclick="exportKanbanExcel()">Excel</button>';

  // Filter columns if filter active
  var visibleStatuses = _kanbanStatusFilter === 'all' ? statuses : [_kanbanStatusFilter];

  // Build columns
  board.innerHTML = visibleStatuses.map(s => {
    const col = statusColors[s];
    const colSum = grouped[s].reduce((a,o) => a + (o.total_sum||0), 0);
    const cards = grouped[s].map(o => {
      const d = o.data || {};
      const dt = new Date(o.created_at);
      const dateStr = dt.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'});
      const num = o.order_number || '—';
      const bx = o.bitrix_deal || '';
      const mainNum = bx || num;
      const skuName = d.sku ? d.sku.name : (TYPE_NAMES[o.item_type]||o.item_type||'—');
      const fabricEntry = typeof FABRICS_CATALOG !== 'undefined' ? FABRICS_CATALOG.find(function(f){return f.code === d.fabric}) : null;
      const fabricName = fabricEntry ? fabricEntry.name : (typeof FABRIC_NAMES !== 'undefined' ? (FABRIC_NAMES[d.fabric]||'') : '');
      const techName = typeof TECH_NAMES !== 'undefined' ? (TECH_NAMES[d.tech]||d.tech||'') : '';
      return '<div class="kb-card" draggable="true" data-order-id="' + o.id + '" ondragstart="kbDragStart(event)" ondragend="kbDragEnd(event)">' +
        '<div class="kb-card-bar" style="background:' + col + '"></div>' +
        '<div class="kb-card-content">' +
        '<div class="kb-card-top">' +
          '<div class="kb-card-id">' + mainNum + (bx ? '<span class="bx-tag">BX</span>' : '') + '</div>' +
          '<div class="kb-card-date">' + dateStr + '</div>' +
        '</div>' +
        '<div class="kb-card-client">' + (d.name||'—') + '</div>' +
        '<div class="kb-card-meta">' +
          '<div class="kb-card-sku">' + skuName + (fabricName ? ' · ' + fabricName : '') + '</div>' +
          (techName ? '<div class="kb-card-row"><span>' + techName + '</span><strong>' + (o.total_qty||0) + ' шт</strong></div>' : '') +
        '</div>' +
        '<div class="kb-card-bottom">' +
          '<div class="kb-card-sum">' + (o.total_sum||0).toLocaleString('ru') + ' \u20bd</div>' +
          '<div class="kb-card-actions">' +
            '<button class="kb-open" onclick="loadOrder(\'' + o.id + '\')">Открыть</button>' +
            '<button onclick="duplicateOrder(\'' + o.id + '\')" title="Дублировать">\u2398</button>' +
            '<button onclick="deleteOrder(\'' + o.id + '\')" title="Удалить">\u2715</button>' +
          '</div>' +
        '</div>' +
        '</div></div>';
    }).join('');

    return '<div class="kanban-col" data-status="' + s + '" ondragover="kbDragOver(event)" ondrop="kbDrop(event,\'' + s + '\')">' +
      '<div class="kanban-col-header" style="border-color:' + col + '">' +
      '<span class="kanban-col-title" style="color:' + col + '">' + statusLabels[s] + '</span>' +
      (colSum > 0 ? '<span class="kanban-col-sum">' + colSum.toLocaleString('ru') + ' \u20bd</span>' : '') +
      '<span class="kanban-col-count" style="background:' + col + '">' + grouped[s].length + '</span>' +
      '</div>' +
      '<div class="kanban-col-body">' + (cards || '<div style="padding:30px;text-align:center;color:#ccc;font-size:11px;font-weight:600">Пусто</div>') + '</div>' +
      '</div>';
  }).join('');
}

// Drag & drop
var _kbDragId = null;
function kbDragStart(e) {
  _kbDragId = e.target.dataset.orderId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function kbDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.kanban-col-body').forEach(b => b.classList.remove('drag-over'));
}
function kbDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const body = e.currentTarget.querySelector('.kanban-col-body');
  if (body) body.classList.add('drag-over');
}
async function kbDrop(e, newStatus) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col-body').forEach(b => b.classList.remove('drag-over'));
  if (!_kbDragId) return;
  await updateOrderStatusCloud(_kbDragId, newStatus);
  _cloudOrders = null;
  await renderKanban();
  showToast('Статус → ' + (STATUS_LABELS[newStatus]||newStatus));
}

// Keep old name as alias
async function renderHistory() { return renderKanban(); }

function openStatusDropdown(orderId, badgeEl) {
  statusTargetId = orderId;
  const dd = document.getElementById('statusDropdown');
  const rect = badgeEl.getBoundingClientRect();
  dd.style.display='block';
  dd.style.position='fixed';
  dd.style.top=(rect.bottom+4)+'px';
  dd.style.left=Math.min(rect.left, window.innerWidth-170)+'px';
}
function closeStatusDropdown() {
  document.getElementById('statusDropdown').style.display='none';
  statusTargetId = null;
}
async function applyStatus(status) {
  if (!statusTargetId) return;
  const { error } = await supa.from('orders').update({ status }).eq('id', statusTargetId);
  if (error) { showToast('Ошибка смены статуса'); console.error(error); }
  _cloudOrders = null; // сброс кеша
  closeStatusDropdown();
  await renderHistory();
}

// Загрузить заказ из Supabase в конструктор
async function loadOrder(supaId) {
  const orders = _cloudOrders || [];
  const o = orders.find(x => x.id === supaId);
  if (!o || !o.data) { showToast('Заказ не найден'); return; }
  const d = o.data;
  Object.assign(state, {
    step:0, type:d.type||'', fabric:d.fabric||'', color:d.color||'',
    sku: null,
    fit:d.fit||'regular', fitChosen:!!d.fit,
    sizes:d.sizes ? {...d.sizes} : {'2XS':0,'XS':0,'S':0,'M':0,'L':0,'XL':0,'2XL':0,'3XL':0},
    customSizes:d.customSizes ? [...d.customSizes] : [],
    zones:d.zones ? [...d.zones] : ['chest'],
    tech:d.tech||'screen', textileColor:d.textileColor||'white', dtgTextile:d.dtgTextile||'white',
    zoneTechs:d.zoneTechs ? {...d.zoneTechs} : {},
    zonePrints:d.zonePrints ? JSON.parse(JSON.stringify(d.zonePrints)) : {},
    flexZones:d.flexZones ? JSON.parse(JSON.stringify(d.flexZones)) : {},
    dtgZones:d.dtgZones ? JSON.parse(JSON.stringify(d.dtgZones)) : {},
    embZones:d.embZones ? JSON.parse(JSON.stringify(d.embZones)) : {},
    dtfZones:d.dtfZones ? JSON.parse(JSON.stringify(d.dtfZones)) : {},
    zoneArtworks:d.zoneArtworks ? {...d.zoneArtworks} : {},
    designNotes:d.designNotes||'', role:d.role||'manager',
    extras: d.extras ? [...d.extras] : [],
    labels: d.labels ? [...d.labels] : [],
    name:d.name||'', contact:d.contact||'', email:d.email||'',
    deadline:d.deadline||'', address:d.address||'', notes:d.notes||'',
    labelOption:d.labelOption||false, packOption:d.packOption||false, urgentOption:d.urgentOption||false,
    labelConfig: migrateLabelData(d)
  });
  // Запоминаем что редактируем существующий заказ
  state._editingOrderId = supaId;
  state._editingOrderNumber = o.order_number;
  state._editingBitrixDeal = o.bitrix_deal || '';
  state._editingArtworkLink = o.artwork_link || '';
  // Восстанавливаем SKU
  if (d.sku && d.sku.article) {
    state.sku = SKU_CATALOG.find(s => s.article === d.sku.article) || null;
  } else if (state.type) {
    const CAT_FROM_TYPE = {'tee':'tshirt','longsleeve':'longsleeve','tank':'tank','hoodie':'hoodie','sweat':'sweatshirt','zip-hoodie':'zip-hoodie','half-zip':'half-zip','pants':'pants','shorts':'shorts','shopper':'shopper','basecap':'basecap','dad-cap':'dad-cap','5panel':'5panel','socks':'socks'};
    const cat = CAT_FROM_TYPE[state.type];
    if (cat) state.sku = SKU_CATALOG.find(s => s.category === cat && s.fit === state.fit) || SKU_CATALOG.find(s => s.category === cat) || null;
  }
  if (state.sku) state.fitChosen = true;
  closeHistory();
  renderSkuList();
  buildSizeTable();
  restoreDraftToUI();
  renderFabricGrid(state.type);
  updateStepSections();
  renderZoneTechBlocks();
  updateTotal();
  updateMockup();
  // Заполнить поля Bitrix и макетов
  const bxEl = document.getElementById('bitrixDeal');
  const awEl = document.getElementById('artworkLink');
  if (bxEl) bxEl.value = o.bitrix_deal || '';
  if (awEl) awEl.value = o.artwork_link || '';
  state.maxStep = 4;
  state.step = 4;
  buildSummary();
  renderStep();
  window.scrollTo({top:0, behavior:'smooth'});
  showToast('Заказ ' + o.order_number + ' загружен');
}

function duplicateOrder(supaId) {
  const orders = _cloudOrders || [];
  const o = orders.find(x => x.id === supaId);
  if (!o || !o.data) return;
  const d = o.data;
  Object.assign(state, {
    step:0, type:d.type||'', fabric:d.fabric||'', color:d.color||'',
    fit:d.fit||'regular',
    sizes:d.sizes ? {...d.sizes} : {}, customSizes:d.customSizes ? [...d.customSizes] : [],
    zones:d.zones ? [...d.zones] : ['chest'], tech:d.tech||'screen',
    zoneTechs:d.zoneTechs ? {...d.zoneTechs} : {},
    zonePrints:d.zonePrints ? JSON.parse(JSON.stringify(d.zonePrints)) : {},
    flexZones:d.flexZones ? JSON.parse(JSON.stringify(d.flexZones)) : {},
    dtgZones:d.dtgZones ? JSON.parse(JSON.stringify(d.dtgZones)) : {},
    embZones:d.embZones ? JSON.parse(JSON.stringify(d.embZones)) : {},
    dtfZones:d.dtfZones ? JSON.parse(JSON.stringify(d.dtfZones)) : {},
    zoneArtworks:d.zoneArtworks ? {...d.zoneArtworks} : {},
    designNotes:d.designNotes||'', file:null, role:d.role||'manager',
    extras: d.extras ? [...d.extras] : [],
    labels: d.labels ? [...d.labels] : [],
    name:d.name||'', contact:d.contact||'', email:d.email||'',
    deadline:'', address:d.address||'', notes:'',
    labelOption:d.labelOption||false, packOption:d.packOption||false, urgentOption:false,
    labelConfig: migrateLabelData(d)
  });
  state._editingOrderId = null; // это новый заказ
  state._editingOrderNumber = null;
  // Восстанавливаем SKU
  if (d.sku && d.sku.article) {
    state.sku = SKU_CATALOG.find(s => s.article === d.sku.article) || null;
  } else { state.sku = null; }
  closeHistory();
  renderSkuList();
  buildSizeTable();
  restoreDraftToUI();
  renderFabricGrid(state.type);
  updateStepSections();
  renderZoneTechBlocks();
  updateTotal();
  updateMockup();
  state.step = 0;
  renderStep();
  window.scrollTo({top:0, behavior:'smooth'});
  showToast('Заказ скопирован — сохрани как новый');
}

async function deleteOrder(supaId) {
  const orders = _cloudOrders || [];
  const o = orders.find(x => x.id === supaId);
  const num = o?.order_number || supaId.slice(0,8);
  const ok = await showConfirm('Удалить заказ?', 'Заказ ' + num + ' будет удалён без возможности восстановления.', 'Удалить');
  if (!ok) return;
  showSpinner('Удаление...');
  const { error } = await supa.from('orders').delete().eq('id', supaId);
  hideSpinner();
  if (error) { showToast('Ошибка удаления'); console.error(error); return; }
  _cloudOrders = null;
  await renderHistory();
  updateHistoryBadge();
  showToast('Заказ ' + num + ' удалён');
}

function copyOrderTZ(supaId) {
  const orders = _cloudOrders || [];
  const o = orders.find(x => x.id === supaId);
  if (!o) return;
  const d = o.data || {};
  const colorEntry = findColorEntry(d.color);
  const colorLabel = colorEntry?`${d.color} — ${colorEntry.name}`:d.color||'—';
  const sizes = Object.entries(d.sizes||{}).filter(([,v])=>v>0).map(([k,v])=>`${k} — ${v} шт`).join('\n');
  const text = `✳ ЗАКАЗ ${o.order_number}${o.bitrix_deal ? ' · '+o.bitrix_deal : ''}
ИЗДЕЛИЕ: ${TYPE_NAMES[o.item_type]||o.item_type||'—'}
ЦВЕТ: ${colorLabel}
ТИРАЖ: ${o.total_qty||0} шт

РАЗМЕРЫ:
${sizes||'—'}

КЛИЕНТ: ${d.name||'—'}
КОНТАКТ: ${d.contact||'—'}
ДЕДЛАЙН: ${d.deadline||'—'}
${o.artwork_link ? 'МАКЕТЫ: '+o.artwork_link : ''}

СУММА: ${(o.total_sum||0).toLocaleString('ru')} ₽
СТАТУС: ${STATUS_LABELS[o.status]||o.status}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(()=>{});
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
  }
  showToast('ТЗ скопировано');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.status-badge') && !e.target.closest('.status-dropdown')) closeStatusDropdown();
});




// ════════════════════════════════════════════════════════════
//   RESTORE & INIT
// ════════════════════════════════════════════════════════════
// restoreDraftToUI, DOMContentLoaded

// ─── RESTORE DRAFT TO UI ───
function restoreDraftToUI() {
  document.querySelectorAll('[data-type]').forEach(el  => el.classList.toggle('selected', el.dataset.type===state.type));
  document.querySelectorAll('[data-fabric]').forEach(el => el.classList.toggle('selected', el.dataset.fabric===state.fabric));
  document.querySelectorAll('[data-tech]').forEach(el   => el.classList.toggle('selected', el.dataset.tech===state.tech));
  // Restore fit
  selectFit(state.fit || 'regular');
  // Restore zone card selected states (only valid zones)
  document.querySelectorAll('[data-zone]').forEach(el => {
    const z = el.dataset.zone;
    el.classList.toggle('selected', state.zones.includes(z));
  });
  // Restore UI блока техники
  showTechOptions(state.tech);
  renderSwatches();
  const info = document.getElementById('colorSelectedInfo');
  const c = findColorEntry(state.color);
  if (info && c) info.textContent = `Выбран: ${c.code} — ${c.name}`;
  updateMockup();
  // Restore uploads
  if (state.generalFile || state.file) {
    const gUpText = document.getElementById('generalUploadText');
    const gUpInfo = document.getElementById('generalFileInfo');
    const fname = state.generalFile || state.file;
    if (gUpText) gUpText.textContent = '✓ Файл загружен';
    if (gUpInfo) gUpInfo.innerHTML = `<div class="general-upload-file"><span class="general-upload-filename">${fname}</span><button class="zone-upload-remove" title="Удалить" onclick="event.stopPropagation();removeGeneralFile()" style="margin-left:4px">✕</button></div>`;
  }
  const txt = document.getElementById('draftText');
  if (txt) { txt.textContent='черновик восстановлен'; setTimeout(()=>{ txt.textContent='черновик'; },3000); }
}




