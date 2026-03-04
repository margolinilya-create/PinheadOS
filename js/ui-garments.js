// ════════════════════════════════════════════════════════════
//   UI — GARMENT SELECT
// ════════════════════════════════════════════════════════════
// selectGarmentRow, selectCard

// ─── CARD SELECT ───
// ── SKU List Render (Этап 2 v1.7b) ──
var _skuListFilter = 'all';

function renderSkuList() {
  // Фильтр категорий
  const filterEl = document.getElementById('skuCatFilter');
  const listEl = document.getElementById('garmentList');
  if (!filterEl || !listEl) return;

  // Собираем уникальные категории из SKU_CATALOG
  const usedCats = [...new Set(SKU_CATALOG.map(s => s.category))];
  const cats = SKU_CATEGORIES.filter(c => usedCats.includes(c.id));

  let filterHtml = `<button class="sku-cat-pill ${_skuListFilter==='all'?'active':''}" onclick="_skuListFilter='all';renderSkuList()">Все</button>`;
  cats.forEach(c => {
    filterHtml += `<button class="sku-cat-pill ${_skuListFilter===c.id?'active':''}" onclick="_skuListFilter='${c.id}';renderSkuList()">${c.name}</button>`;
  });
  filterEl.innerHTML = filterHtml;

  // Рендерим список SKU
  const filtered = _skuListFilter === 'all' ? SKU_CATALOG : SKU_CATALOG.filter(s => s.category === _skuListFilter);

  // Группируем по категории
  let html = '';
  const groups = {};
  filtered.forEach(s => {
    if (!groups[s.category]) groups[s.category] = [];
    groups[s.category].push(s);
  });

  const catOrder = SKU_CATEGORIES.map(c => c.id);
  Object.keys(groups).sort((a,b) => catOrder.indexOf(a) - catOrder.indexOf(b)).forEach(catId => {
    const cat = SKU_CATEGORIES.find(c => c.id === catId);
    const catName = cat ? cat.name : catId;
    html += `<div class="garment-sep"><span class="garment-sep-text">${catName}</span><div class="garment-sep-line"></div></div>`;
    groups[catId].forEach(s => {
      const idx = SKU_CATALOG.indexOf(s);
      const est = getSkuEstPrice(s);
      const isSelected = state.sku && state.sku.article === s.article;
      const fitLabel = (s.fit && !s.name.toLowerCase().includes(s.fit)) ? ({regular:'Regular',free:'Free',oversize:'Oversize'}[s.fit]||s.fit) : '';
      html += `<div class="garment-row ${isSelected?'selected':''}" data-sku-idx="${idx}" onclick="selectSkuItem(${idx})">
        <div class="garment-row-bar"></div>
        <span class="garment-row-name">${s.name}${fitLabel ? '<span class=garment-row-fit>'+fitLabel+'</span>' : ''}</span>
        <span class="garment-row-price">от ${est.toLocaleString('ru')} ₽</span>
      </div>`;
    });
  });

  if (filtered.length === 0) {
    html = '<div style="padding:20px;text-align:center;color:#999">Нет изделий в каталоге</div>';
  }
  listEl.innerHTML = html;
}

function getSkuEstPrice(s) {
  const fabric = FABRICS_CATALOG.find(f => (f.forCategories||[]).includes(s.category));
  const fabricCost = fabric ? Math.round(s.mainFabricUsage * fabric.priceUSD * USD_RATE) : 0;
  const trim = getTrimByCode(s.trimCode);
  const trimCost = trim ? Math.round((s.trimUsage||0) * trim.priceUSD * USD_RATE) : 0;
  return (s.sewingPrice||0) + fabricCost + trimCost;
}

function selectSkuItem(idx) {
  const s = SKU_CATALOG[idx];
  if (!s) return;

  const prevType = state.type;
  const prevSku = state.sku;

  // Маппинг category → старый type для совместимости с мокапами и прочим
  const CAT_TO_TYPE = {
    'tshirt':'tee','longsleeve':'longsleeve','tank':'tank',
    'hoodie':'hoodie','sweatshirt':'sweat','zip-hoodie':'zip-hoodie',
    'half-zip':'half-zip','pants':'pants','shorts':'shorts',
    'shopper':'shopper','basecap':'basecap','dad-cap':'dad-cap',
    '5panel':'5panel','socks':'socks'
  };

  state.sku = s;
  state.type = CAT_TO_TYPE[s.category] || s.category;
  state.fit = s.fit || 'regular';
  state.fitChosen = true; // fit всегда выбран через SKU

  // Если тип изменился — сбросы
  if (prevType !== state.type || !prevSku || prevSku.article !== s.article) {
    state.fabric = '';
    state.color = '';
    state.extras = []; // сбрасываем обработки при смене SKU
    state.labels = []; // сбрасываем лейблы при смене SKU
    const info = document.getElementById('colorSelectedInfo');
    if (info) info.textContent = '';

    // Зоны из SKU
    const prevIsAcc = isAccessory(prevType);
    const newIsAcc = isAccessory(state.type);
    if (prevType !== state.type) {
      state.zones = s.zones && s.zones.length ? [s.zones[0]] : [];
      state.zoneTechs = {};
      state.zonePrints = {};
      state.dtgZones = {};
      state.embZones = {};
      state.dtfZones = {};
    }

    if (prevIsAcc && !newIsAcc) delete state.sizes['ONE SIZE'];
    if (!prevIsAcc && newIsAcc) state.sizes = {'ONE SIZE': state.sizes['ONE SIZE'] || 1};
  }

  // Визуальное выделение
  document.querySelectorAll('.garment-row').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector(`[data-sku-idx="${idx}"]`);
  if (row) row.classList.add('selected');

  renderFabricGrid(state.type);
  updateFitVisibility();
  updateAccessoryUI();
  updateStepSections();
  syncOneSizeInput();
  if (state.step === 2) renderZonesGrid();
  updateTotal();
  updateNextBtns();
  scheduleSave();
}

// selectGarmentRow — удалена в v1.7b, заменена на selectSkuItem

async function clearAllOrders() {
  const ok = await showConfirm('Очистить всю историю?', 'Все заказы будут удалены из облака. Это действие нельзя отменить.', 'Удалить всё');
  if (!ok) return;
  if (!supa) { showToast('Нет подключения к облаку'); return; }
  try {
    const { error } = await supa.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    _cloudOrders = [];
    renderOrdersList();
    showToast('История очищена');
  } catch(e) { showToast('Ошибка: ' + e.message); }
}

function selectCard(el, group) {
  const grid = el.closest('.cards-grid,.technique-grid,.garment-grid');
  if (grid) grid.querySelectorAll('.card,.garment-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const val = el.dataset[group] || el.dataset.tech || el.dataset.type || el.dataset.fabric;
  state[group] = val;
  if (group === 'type') {
    updateMockup();
    renderFabricGrid(state.type);
  }
  updateTotal();
  scheduleSave();
}




