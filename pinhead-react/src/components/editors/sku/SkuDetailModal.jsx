import { useState, useRef } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { uploadSkuPhoto, deleteSkuPhoto } from '../../../lib/storage';
import { getGarmentSVG } from '../../../utils/mockup';
import { toast } from '../../../store/useToastStore';

const ALL_ZONES = [
  {id:'front', name:'Грудь (перед)'},
  {id:'back', name:'Спина'},
  {id:'sleeve-l', name:'Левый рукав'},
  {id:'sleeve-r', name:'Правый рукав'},
  {id:'hood', name:'Капюшон'},
  {id:'pocket', name:'Карман'},
  {id:'side-a', name:'Сторона A'},
  {id:'side-b', name:'Сторона B'},
];

const DEFAULT_SIZE_CHART = {
  headers: ['Размер', 'Длина', 'Ширина'],
  rows: [['S','',''], ['M','',''], ['L','',''], ['XL','','']],
};

export default function SkuDetailModal({ sku, skuIndex, onUpdate, onClose }) {
  const panelRef = useFocusTrap(true, onClose);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const sizeChart = sku.sizeChart || DEFAULT_SIZE_CHART;

  // Photo upload
  const handleFileSelect = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    const url = await uploadSkuPhoto(sku.code, file);
    setUploading(false);
    if (url) {
      onUpdate(skuIndex, 'photoUrl', url);
      toast.success('Фото загружено');
    } else {
      toast.error('Ошибка загрузки фото');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleDeletePhoto = async () => {
    await deleteSkuPhoto(sku.code);
    onUpdate(skuIndex, 'photoUrl', null);
    toast.success('Фото удалено');
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

  // Available zones based on category
  const availableZones = ALL_ZONES.filter(z => {
    if (sku.category === 'accessories') return ['side-a', 'side-b'].includes(z.id);
    return !['side-a', 'side-b'].includes(z.id);
  });

  // Fallback mockup SVG
  const mockupSvg = !sku.photoUrl ? getGarmentSVG(sku.mockupType, '#d9d9d9') : '';

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
          {/* Section 1: Photo */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ФОТО МОДЕЛИ</div>
            {sku.photoUrl ? (
              <div className="sku-photo-preview">
                <img src={sku.photoUrl} alt={sku.name} />
                <div className="sku-photo-actions">
                  <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Заменить</button>
                  <button className="btn btn-danger" onClick={handleDeletePhoto}>Удалить</button>
                </div>
              </div>
            ) : (
              <div
                className={`sku-photo-upload${dragOver ? ' drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <span>Загрузка...</span>
                ) : mockupSvg ? (
                  <>
                    <div className="sku-photo-mockup" dangerouslySetInnerHTML={{ __html: mockupSvg }} />
                    <span>Перетащите фото или нажмите для загрузки</span>
                  </>
                ) : (
                  <>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M12 8v8M8 12h8" />
                    </svg>
                    <span>Перетащите фото или нажмите для загрузки</span>
                  </>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => handleFileSelect(e.target.files[0])} />
          </div>

          {/* Section 2: Description */}
          <div className="sku-detail-section">
            <div className="sku-detail-section-label">ОПИСАНИЕ</div>
            <textarea
              className="sku-description-field"
              value={sku.description || ''}
              onChange={e => onUpdate(skuIndex, 'description', e.target.value)}
              placeholder="Описание модели: крой, материал, особенности..."
              rows={3}
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

          {/* Section 5: Basic fields */}
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
        </div>
      </div>
    </div>
  );
}
