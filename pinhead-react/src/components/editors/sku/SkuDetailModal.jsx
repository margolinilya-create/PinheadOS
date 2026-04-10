import { useState, useRef, useEffect } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { uploadSkuPhoto, deleteSkuPhotoByUrl } from '../../../lib/storage';
import { getGarmentSVG } from '../../../utils/mockup';
import { toast } from '../../../store/useToastStore';

const MAX_PHOTOS = 4;

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

export default function SkuDetailModal({ sku, skuIndex, onUpdate, onClose, onPersist }) {
  const panelRef = useFocusTrap(true, onClose);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null); // { file, objectUrl }

  const photos = sku.photos || (sku.photoUrl ? [sku.photoUrl] : []);
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
      onUpdate(skuIndex, 'photoUrl', newPhotos[0]);
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
    onUpdate(skuIndex, 'photoUrl', photo);
    await onPersist?.();
  };

  const handleDeletePhoto = async (idx) => {
    const url = photos[idx];
    await deleteSkuPhotoByUrl(url);
    const newPhotos = photos.filter((_, i) => i !== idx);
    onUpdate(skuIndex, 'photos', newPhotos);
    onUpdate(skuIndex, 'photoUrl', newPhotos[0] || null);
    await onPersist?.();
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

  const availableZones = ALL_ZONES.filter(z => {
    if (sku.category === 'accessories') return ['side-a', 'side-b'].includes(z.id);
    return !['side-a', 'side-b'].includes(z.id);
  });

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

          {/* Footer */}
          <div className="sku-detail-footer">
            <span className="sku-autosave-status">&#10003; Изменения сохранены</span>
            <button className="btn btn-ghost" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  );
}
