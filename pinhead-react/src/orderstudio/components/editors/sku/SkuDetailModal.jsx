import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useFocusTrap } from '../../../../hooks/useFocusTrap';
import { uploadSkuPhoto, deleteSkuPhotoByUrl } from '../../../../lib/storage';
import { getGarmentSVG } from '../../../utils/mockup';
import { toast } from '../../../../store/useToastStore';
import { getEffectiveRules, getAvailableZonesForSku } from '../../../utils/skuRules';
import { TECH_TABS } from '../../../utils/pricing';
import { MEDASTEX_COLORS, COLOR_GROUPS, SIZES } from '../../../../data';

const MAX_PHOTOS = 4;

const DEFAULT_SIZE_CHART = {
  headers: ['Размер', 'Длина', 'Ширина'],
  rows: [['S','',''], ['M','',''], ['L','',''], ['XL','','']],
};

export default function SkuDetailModal({ sku, skuIndex, onUpdate, onClose, onPersist }) {
  const { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, categoryRules, zonesCatalog } = useStore(
    useShallow(s => ({ fabricsCatalog: s.fabricsCatalog, trimCatalog: s.trimCatalog, extrasCatalog: s.extrasCatalog, usdRate: s.usdRate, categoryRules: s.categoryRules, zonesCatalog: s.zonesCatalog }))
  );
  const panelRef = useFocusTrap(true, onClose);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null); // { file, objectUrl }

  const photos = useMemo(() => sku.photos || [], [sku.photos]);
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  const sizeChart = sku.sizeChart || DEFAULT_SIZE_CHART;

  // Photo preview & upload
  const handleFilePreview = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const current = photosRef.current;
    if (current.length >= MAX_PHOTOS) {
      toast.error(`Максимум ${MAX_PHOTOS} фото`);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview({ file, objectUrl });
  };

  const handleConfirmUpload = async () => {
    if (!preview) return;
    URL.revokeObjectURL(preview.objectUrl);
    const { file } = preview;
    setPreview(null);
    setUploading(true);
    const current = photosRef.current;
    const idx = current.length;
    const url = await uploadSkuPhoto(sku.code, file, idx);
    setUploading(false);
    if (url) {
      const latest = photosRef.current;
      const newPhotos = [...latest, url];
      photosRef.current = newPhotos;
      onUpdate(skuIndex, 'photos', newPhotos);
      // Auto-persist to Supabase so photos survive page refresh
      await onPersist?.();
      toast.success('Фото сохранено');
    } else {
      toast.error('Ошибка загрузки фото');
    }
  };

  const handleCancelPreview = () => {
    if (preview) {
      URL.revokeObjectURL(preview.objectUrl);
      setPreview(null);
    }
  };

  useEffect(() => {
    return () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    };
  }, [preview]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFilePreview(file);
  };

  const handleSetMain = async (idx) => {
    if (idx === 0) return;
    const photo = photos[idx];
    const newPhotos = [photo, ...photos.filter((_, i) => i !== idx)];
    photosRef.current = newPhotos;
    onUpdate(skuIndex, 'photos', newPhotos);
    await onPersist?.();
  };

  const handleDeletePhoto = async (idx) => {
    const url = photos[idx];
    const ok = await deleteSkuPhotoByUrl(url);
    if (!ok) toast.error('Не удалось удалить фото из хранилища');
    const newPhotos = photos.filter((_, i) => i !== idx);
    onUpdate(skuIndex, 'photos', newPhotos);
    await onPersist?.();
    if (ok) toast.success('Фото удалено');
  };

  // Size chart editing
  const updateCell = (rowIdx, colIdx, value) => {
    const newRows = sizeChart.rows.map((r, i) => i === rowIdx ? r.map((c, j) => j === colIdx ? value : c) : r);
    onUpdate(skuIndex, 'sizeChart', { ...sizeChart, rows: newRows });
  };

  const updateHeader = (colIdx, value) => {
    const newHeaders = sizeChart.headers.map((h, i) => i === colIdx ? value : h);
    onUpdate(skuIndex, 'sizeChart', { ...sizeChart, headers: newHeaders });
  };

  const addRow = () => {
    const newRow = sizeChart.headers.map(() => '');
    onUpdate(skuIndex, 'sizeChart', { ...sizeChart, rows: [...sizeChart.rows, newRow] });
  };

  const removeRow = (idx) => {
    onUpdate(skuIndex, 'sizeChart', { ...sizeChart, rows: sizeChart.rows.filter((_, i) => i !== idx) });
  };

  const addColumn = () => {
    onUpdate(skuIndex, 'sizeChart', {
      headers: [...sizeChart.headers, 'Новая'],
      rows: sizeChart.rows.map(r => [...r, '']),
    });
  };

  const removeColumn = (colIdx) => {
    if (sizeChart.headers.length <= 2) return;
    onUpdate(skuIndex, 'sizeChart', {
      headers: sizeChart.headers.filter((_, i) => i !== colIdx),
      rows: sizeChart.rows.map(r => r.filter((_, i) => i !== colIdx)),
    });
  };

  // Zone toggle
  const toggleZone = (zoneId) => {
    const zones = sku.zones || [];
    const newZones = zones.includes(zoneId) ? zones.filter(z => z !== zoneId) : [...zones, zoneId];
    onUpdate(skuIndex, 'zones', newZones);
  };

  const availableZones = getAvailableZonesForSku(zonesCatalog, sku.category);

  // Economics: cost breakdown for this SKU
  const economics = useMemo(() => {
    const fabric = fabricsCatalog.find(f => (f.forCategories || []).includes(sku.category));
    const fabricCost = fabric ? Math.round(sku.mainFabricUsage * fabric.priceUSD * usdRate) : 0;
    const trim = trimCatalog.find(t => t.code === sku.trimCode);
    const trimCost = trim ? Math.round((sku.trimUsage || 0) * trim.priceUSD * usdRate) : 0;
    const sewingCost = sku.sewingPrice || 0;
    return {
      sewingCost,
      fabricCost,
      fabricName: fabric?.name || '—',
      trimCost,
      trimName: trim?.name || '—',
      total: sewingCost + fabricCost + trimCost,
    };
  }, [sku.sewingPrice, sku.mainFabricUsage, sku.trimCode, sku.trimUsage, sku.category, fabricsCatalog, trimCatalog, usdRate]);

  // Resolved rules for this SKU (category rules + per-SKU overrides)
  const resolvedRules = useMemo(
    () => getEffectiveRules(sku, categoryRules || []),
    [sku, categoryRules]
  );
  const overrides = sku.overrides || {};

  const toggleOverrideTech = (techKey) => {
    const current = overrides.allowedTechs || resolvedRules.allowedTechs || TECH_TABS.map(t => t.key);
    const next = current.includes(techKey)
      ? current.filter(t => t !== techKey)
      : [...current, techKey];
    onUpdate(skuIndex, 'overrides', { ...overrides, allowedTechs: next });
  };

  const clearOverrideField = (field) => {
    const next = { ...overrides };
    delete next[field];
    onUpdate(skuIndex, 'overrides', Object.keys(next).length > 0 ? next : undefined);
  };

  const setOverrideMoq = (value) => {
    const num = Math.max(1, Number(value) || 1);
    onUpdate(skuIndex, 'overrides', { ...overrides, moq: num });
  };

  const setOverridePriceMultiplier = (value) => {
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
    onUpdate(skuIndex, 'priceMultiplier', num || undefined);
  };

  const mockupSvg = photos.length === 0 ? getGarmentSVG(sku.mockupType, '#d9d9d9') : '';

  return (
    <div className="sku-modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="sku-detail-modal" role="dialog" aria-modal="true" aria-label={`Редактирование ${sku.name}`} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sku-detail-header">
          <div>
            <h3 className="sku-detail-title">{sku.name}</h3>
            <span className="sku-detail-code">{sku.code}</span>
          </div>
          <button className="exp-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="sku-detail-body">
          {/* Section 1: Photos (up to 4) */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ФОТО МОДЕЛИ ({photos.length}/{MAX_PHOTOS})</div>
            <div className="sku-photos-grid">
              {photos.map((url, i) => (
                <div key={url} className={`sku-photo-card${i === 0 ? ' main' : ''}`}>
                  <img
                    src={url}
                    alt={`${sku.name} фото ${i + 1}`}
                    onClick={() => handleSetMain(i)}
                    title={i !== 0 ? 'Сделать главным' : undefined}
                  />
                  <button className="sku-photo-remove" onClick={() => handleDeletePhoto(i)} aria-label="Удалить фото">&#10005;</button>
                  {i === 0 && <span className="sku-photo-main-badge">Главное</span>}
                </div>
              ))}
              {preview && (
                <div className="sku-photo-card sku-photo-preview-card">
                  <img src={preview.objectUrl} alt="Предпросмотр" />
                  <div className="sku-photo-preview-actions">
                    <button className="sku-preview-confirm" onClick={handleConfirmUpload} aria-label="Загрузить">&#10003;</button>
                    <button className="sku-preview-cancel" onClick={handleCancelPreview} aria-label="Отменить">&#10005;</button>
                  </div>
                </div>
              )}
              {!preview && photos.length < MAX_PHOTOS && (
                <div
                  className={`sku-photo-upload-slot${dragOver ? ' drag-over' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <span className="sku-photo-uploading">Загрузка...</span>
                  ) : photos.length === 0 && mockupSvg ? (
                    <>
                      <div className="sku-photo-mockup" dangerouslySetInnerHTML={{ __html: mockupSvg }} />
                      <span>Добавить фото</span>
                    </>
                  ) : (
                    <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>Добавить</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { handleFilePreview(e.target.files[0]); e.target.value = ''; }} />
          </div>

          {/* Section 2: Descriptions */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">КОРОТКОЕ ОПИСАНИЕ</div>
            <input
              className="sku-description-short"
              value={sku.shortDesc || ''}
              onChange={e => onUpdate(skuIndex, 'shortDesc', e.target.value)}
              placeholder="Краткое описание для карточки в списке (1 строка)"
            />
          </div>
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ПОЛНОЕ ОПИСАНИЕ</div>
            <textarea
              className="sku-description-field"
              value={sku.description || ''}
              onChange={e => onUpdate(skuIndex, 'description', e.target.value)}
              placeholder="Подробное описание: крой, материал, особенности, уход..."
              rows={4}
            />
          </div>

          {/* Section 3: Size Chart */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">
              ТАБЕЛЬ МЕР (СМ)
              <button className="sku-detail-add-btn" onClick={addColumn} title="Добавить колонку">+ колонка</button>
              <button className="sku-detail-add-btn" onClick={addRow} title="Добавить размер">+ размер</button>
            </div>
            <div className="sku-size-chart-editor">
              <table>
                <thead>
                  <tr>
                    {sizeChart.headers.map((h, i) => (
                      <th key={i}>
                        <input value={h} onChange={e => updateHeader(i, e.target.value)} className="sku-sc-header-input" />
                        {i > 0 && <button className="sku-sc-remove-col" onClick={() => removeColumn(i)} title="Удалить колонку">✕</button>}
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sizeChart.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>
                          <input value={cell} onChange={e => updateCell(ri, ci, e.target.value)} className="sku-sc-cell-input" />
                        </td>
                      ))}
                      <td>
                        <button className="sku-del-btn" onClick={() => removeRow(ri)} aria-label="Удалить строку">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4: Zones */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ЗОНЫ НАНЕСЕНИЯ</div>
            <div className="sku-detail-zones">
              {availableZones.map(z => {
                const active = (sku.zones || []).includes(z.id);
                return (
                  <label key={z.id} className={`sku-zone-check${active ? ' active' : ''}`}>
                    <input type="checkbox" checked={active} onChange={() => toggleZone(z.id)} />
                    <span>{z.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section 5: Economics (read-only) */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ЭКОНОМИКА (СЕБЕСТОИМОСТЬ)</div>
            <div className="sku-economics">
              <div className="sku-economics-grid">
                <span className="econ-label">Пошив</span>
                <span className="econ-value">{economics.sewingCost} &#8381;</span>
                <span className="econ-label">Ткань ({economics.fabricName})</span>
                <span className="econ-value">{economics.fabricCost} &#8381;</span>
                <span className="econ-label">Отделка ({economics.trimName})</span>
                <span className="econ-value">{economics.trimCost} &#8381;</span>
                <span className="econ-label econ-total">Итого</span>
                <span className="econ-value econ-total">{economics.total} &#8381;</span>
              </div>
            </div>
          </div>

          {/* Section 6: Overrides */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ПЕРЕОПРЕДЕЛЕНИЯ</div>
            <p className="sku-overrides-hint">Серым показаны правила категории. Переопределите для этого артикула.</p>

            {/* Tech overrides */}
            <div className="sku-override-row">
              <span className="sku-override-label">Техники</span>
              <div className="cat-rule-chips">
                {TECH_TABS.map(t => {
                  const inherited = !resolvedRules.allowedTechs || resolvedRules.allowedTechs.includes(t.key);
                  const hasOverride = overrides.allowedTechs !== undefined;
                  const active = hasOverride
                    ? (overrides.allowedTechs || []).includes(t.key)
                    : inherited;
                  return (
                    <button
                      key={t.key}
                      className={`cat-rule-chip${active ? ' active' : ''}${!hasOverride ? ' inherited' : ''}`}
                      onClick={() => toggleOverrideTech(t.key)}
                    >
                      {t.label}
                    </button>
                  );
                })}
                {overrides.allowedTechs !== undefined && (
                  <button className="sku-override-clear" onClick={() => clearOverrideField('allowedTechs')}>сбросить</button>
                )}
              </div>
            </div>

            {/* MOQ override */}
            <div className="sku-override-row">
              <span className="sku-override-label">MOQ</span>
              <input
                type="number"
                className="cat-rule-moq-input"
                min="1"
                value={overrides.moq ?? resolvedRules.moq}
                onChange={e => setOverrideMoq(e.target.value)}
              />
              {overrides.moq !== undefined && (
                <button className="sku-override-clear" onClick={() => clearOverrideField('moq')}>сбросить</button>
              )}
              {overrides.moq === undefined && resolvedRules.moq > 1 && (
                <span className="sku-override-inherited">от категории</span>
              )}
            </div>

            {/* Price multiplier */}
            <div className="sku-override-row">
              <span className="sku-override-label">Множитель цены</span>
              <input
                type="number"
                className="cat-rule-moq-input"
                step="0.1"
                min="0"
                value={sku.priceMultiplier ?? 1}
                onChange={e => setOverridePriceMultiplier(e.target.value)}
                placeholder="1.0"
              />
              {sku.priceMultiplier && sku.priceMultiplier !== 1 && (
                <span className="sku-override-badge">{sku.priceMultiplier > 1 ? '+' : ''}{Math.round((sku.priceMultiplier - 1) * 100)}%</span>
              )}
            </div>

            {/* Per-SKU color palette override */}
            <SkuColorPicker
              allowedColors={overrides.allowedColors}
              onUpdate={(colors) => onUpdate(skuIndex, 'overrides', { ...overrides, allowedColors: colors })}
              onClear={() => clearOverrideField('allowedColors')}
            />

            {/* Per-SKU allowed fabrics */}
            <SkuAllowedList
              label="Допустимые ткани"
              items={fabricsCatalog.filter(f => (f.forCategories || []).includes(sku.category))}
              allowed={sku.allowedFabrics}
              onUpdate={(codes) => onUpdate(skuIndex, 'allowedFabrics', codes)}
              onClear={() => onUpdate(skuIndex, 'allowedFabrics', undefined)}
            />

            {/* Per-SKU allowed extras */}
            <SkuAllowedList
              label="Допустимые обработки"
              items={(extrasCatalog || []).filter(e => !e.forCategories?.length || e.forCategories.includes(sku.category))}
              allowed={sku.allowedExtras}
              onUpdate={(codes) => onUpdate(skuIndex, 'allowedExtras', codes)}
              onClear={() => onUpdate(skuIndex, 'allowedExtras', undefined)}
            />

            {/* Per-SKU available sizes */}
            <div className="sku-override-row">
              <span className="sku-override-label">Размеры</span>
              <div className="cat-rule-sizes">
                {SIZES.map(s => {
                  const active = !sku.availableSizes || sku.availableSizes.includes(s);
                  return (
                    <label key={s} className={`cat-rule-size${active ? ' active' : ''}${!sku.availableSizes ? ' inherited' : ''}`}>
                      <input type="checkbox" checked={active} onChange={() => {
                        const current = sku.availableSizes || [...SIZES];
                        const next = current.includes(s) ? current.filter(x => x !== s) : [...current, s];
                        onUpdate(skuIndex, 'availableSizes', next.length === SIZES.length ? undefined : next);
                      }} />
                      <span>{s}</span>
                    </label>
                  );
                })}
              </div>
              {sku.availableSizes && (
                <button className="sku-override-clear" onClick={() => onUpdate(skuIndex, 'availableSizes', undefined)}>сбросить</button>
              )}
            </div>
          </div>

          {/* Section 7: Basic fields */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ПАРАМЕТРЫ</div>
            <div className="sku-detail-fields">
              <label className="sku-detail-field">
                <span>Название</span>
                <input value={sku.name} onChange={e => onUpdate(skuIndex, 'name', e.target.value)} />
              </label>
              <label className="sku-detail-field">
                <span>Fit</span>
                <select value={sku.fit || ''} onChange={e => onUpdate(skuIndex, 'fit', e.target.value || null)}>
                  <option value="">—</option>
                  <option value="classic">Classic</option>
                  <option value="regular">Regular</option>
                  <option value="free">Free</option>
                  <option value="oversize">Oversize</option>
                </select>
              </label>
              <label className="sku-detail-field">
                <span>Пошив (&#8381;)</span>
                <input type="number" value={sku.sewingPrice} onChange={e => onUpdate(skuIndex, 'sewingPrice', Number(e.target.value) || 0)} />
              </label>
              <label className="sku-detail-field">
                <span>Расход ткани (м)</span>
                <input type="number" step="0.1" value={sku.mainFabricUsage} onChange={e => onUpdate(skuIndex, 'mainFabricUsage', Number(e.target.value) || 0)} />
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="sku-detail-footer">
            <span className="sku-autosave-status">Изменения применены — сохраните каталог</span>
            <button className="btn btn-ghost" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Collapsible per-SKU color swatch picker */
function SkuColorPicker({ allowedColors, onUpdate, onClear }) {
  const [open, setOpen] = useState(false);
  const hasOverride = allowedColors !== undefined && allowedColors !== null;
  const selectedSet = hasOverride ? new Set(allowedColors) : null;

  const toggleColor = (code) => {
    if (!hasOverride) {
      // First click: start with all colors selected, then toggle off
      const allCodes = MEDASTEX_COLORS.map(c => c.code);
      onUpdate(allCodes.filter(c => c !== code));
    } else {
      const next = selectedSet.has(code)
        ? allowedColors.filter(c => c !== code)
        : [...allowedColors, code];
      onUpdate(next);
    }
  };

  return (
    <div className="sku-override-colors">
      <div className="sku-override-row">
        <span className="sku-override-label">Цвета</span>
        <button className="cat-rule-chip" onClick={() => setOpen(v => !v)}>
          {hasOverride ? `${allowedColors.length} из ${MEDASTEX_COLORS.length}` : 'все цвета'} {open ? '▲' : '▼'}
        </button>
        {hasOverride && (
          <button className="sku-override-clear" onClick={() => { onClear(); setOpen(false); }}>сбросить</button>
        )}
      </div>
      {open && (
        <div className="sku-color-grid">
          {COLOR_GROUPS.map(g => {
            const groupColors = g.codes.map(code => MEDASTEX_COLORS.find(c => c.code === code)).filter(Boolean);
            if (!groupColors.length) return null;
            return (
              <div key={g.label} className="sku-color-group">
                <div className="sku-color-group-label">{g.label}</div>
                <div className="sku-color-swatches">
                  {groupColors.map(c => {
                    const active = !hasOverride || selectedSet.has(c.code);
                    return (
                      <button
                        key={c.code}
                        className={`sku-color-swatch${active ? ' active' : ''}`}
                        style={{ backgroundColor: c.hex }}
                        title={`${c.name} (${c.code})`}
                        onClick={() => toggleColor(c.code)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Reusable per-SKU allowed list (fabrics or extras) with toggle chips */
function SkuAllowedList({ label, items, allowed, onUpdate, onClear }) {
  const [open, setOpen] = useState(false);
  const hasOverride = allowed !== undefined && allowed !== null;

  const toggle = (code) => {
    if (!hasOverride) {
      onUpdate(items.map(i => i.code).filter(c => c !== code));
    } else {
      const isRemoving = allowed.includes(code);
      if (isRemoving && allowed.length <= 1) {
        toast.warning('Нельзя убрать последний элемент — сбросьте ограничение');
        return;
      }
      const next = isRemoving
        ? allowed.filter(c => c !== code)
        : [...allowed, code];
      onUpdate(next);
    }
  };

  if (!items.length) return null;

  return (
    <div className="sku-override-colors">
      <div className="sku-override-row">
        <span className="sku-override-label">{label}</span>
        <button className="cat-rule-chip" onClick={() => setOpen(v => !v)}>
          {hasOverride ? `${allowed.length} из ${items.length}` : `все (${items.length})`} {open ? '▲' : '▼'}
        </button>
        {hasOverride && (
          <button className="sku-override-clear" onClick={() => { onClear(); setOpen(false); }}>сбросить</button>
        )}
      </div>
      {open && (
        <div className="sku-allowed-list">
          {items.map(item => {
            const active = !hasOverride || allowed.includes(item.code);
            return (
              <button
                key={item.code}
                className={`cat-rule-chip${active ? ' active' : ''}`}
                onClick={() => toggle(item.code)}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
