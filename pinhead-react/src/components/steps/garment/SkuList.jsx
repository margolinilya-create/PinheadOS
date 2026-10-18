import { useState, useDeferredValue } from 'react';
import { skuDescription } from '../../../utils/skuDescription';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { SKU_CATEGORIES } from '../../../data';
import { ZONE_LABELS } from '../../../data/constants';
import { getSkuFromPrice } from '../../../utils/pricing';
import { overlayClick } from '../../../utils/overlayClick';
import { Icon } from '../../../erp/components/Icon';
import { mockupSrc } from './garmentMockup';
import panel from './panel.module.css';
import styles from './SkuList.module.css';

const FIT_OPTIONS = [
  { key: 'all', label: 'Все фиты' },
  { key: 'classic', label: 'Classic' },
  { key: 'regular', label: 'Regular' },
  { key: 'free', label: 'Free' },
  { key: 'oversize', label: 'Oversize' },
];

/** Фото модели, иначе силуэт картинкой, иначе значок «нет фото» */
function SkuPhoto({ s }) {
  const photo = s.photos?.[0];
  if (photo) return <img src={photo} alt={s.name} className={styles.cover} />;
  const src = mockupSrc(s.mockupType, '#d9d9d9');
  if (src) return <img src={src} alt="" className={styles.mockup} />;
  return <span className={styles.placeholder}><Icon name="image" size={20} /></span>;
}

function PhotoLightbox({ photos, startIdx, onClose }) {
  const [idx, setIdx] = useState(startIdx);
  const next = () => setIdx(i => (i + 1) % photos.length);
  const prev = () => setIdx(i => (i - 1 + photos.length) % photos.length);
  const handleKey = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  };
  return (
    <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label="Фото изделия" onClick={overlayClick(onClose)} onKeyDown={handleKey} tabIndex={-1} ref={el => el?.focus()}>
      <div className={styles.lightboxContent}>
        <img src={photos[idx]} alt={`Фото ${idx + 1}`} />
        {photos.length > 1 && (
          <>
            <button type="button" className={`${styles.lbBtn} ${styles.lbPrev}`} onClick={prev} aria-label="Предыдущее фото"><Icon name="chevronLeft" /></button>
            <button type="button" className={`${styles.lbBtn} ${styles.lbNext}`} onClick={next} aria-label="Следующее фото"><Icon name="chevronRight" /></button>
            <span className={styles.lbCounter}>{idx + 1} / {photos.length}</span>
          </>
        )}
        <button type="button" className={`${styles.lbBtn} ${styles.lbClose}`} onClick={onClose} aria-label="Закрыть фото"><Icon name="x" /></button>
      </div>
    </div>
  );
}

/** Галерея раскрытой карточки: фото кнопками (открывают просмотр), иначе силуэт */
function ExpandPhotos({ s, photos, onOpen }) {
  if (photos.length === 0) {
    const src = mockupSrc(s.mockupType, '#d9d9d9');
    return (
      <div className={styles.photos}>
        <div className={`${styles.photoBtn} ${styles.photoMain}`}>
          {src ? <img src={src} alt="" className={styles.mockup} /> : <span className={styles.placeholder}><Icon name="image" size={40} /></span>}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.photos}>
      {photos.map((url, i) => (
        <button
          key={url}
          type="button"
          className={`${styles.photoBtn}${i === 0 ? ` ${styles.photoMain}` : ''}`}
          onClick={() => onOpen(i)}
          aria-label={`Открыть фото ${i + 1}`}
        >
          <img src={url} alt="" className={styles.cover} />
        </button>
      ))}
    </div>
  );
}

function ExpandPanel({ s, fabricsCatalog, trimCatalog, usdRate, onSelect, fabricCode, readOnly }) {
  // Состав, плотность и поставщик — из ткани, а не зашитым текстом (правка 13.10)
  const desc = skuDescription(s, fabricCode, fabricsCatalog);
  const photos = s.photos || [];
  const [lightbox, setLightbox] = useState(null);
  const est = getSkuFromPrice(s, null, fabricsCatalog, trimCatalog, usdRate);

  return (
    <div className={styles.expandInner}>
      <ExpandPhotos s={s} photos={photos} onOpen={setLightbox} />
      <div>
        <div className={styles.title}>{s.name}</div>
        <div className={styles.subtitle}>{s.code} · {s.fit ? s.fit + ' fit' : ''}</div>
        {desc && <div className={styles.desc}>{desc}</div>}
        {s.sizeChart && (
          <>
            <div className={styles.label}>Табель мер (см)</div>
            <table className={styles.sizeChart}>
              <thead>
                <tr>{s.sizeChart.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {s.sizeChart.rows.map((row, ri) => (
                  <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {s.zones?.length > 0 && (
          <>
            <div className={styles.label}>Зоны нанесения</div>
            <div className={styles.zones}>
              {s.zones.map(z => <span key={z} className={styles.zone}>{ZONE_LABELS[z] || z}</span>)}
            </div>
          </>
        )}
        <div className={styles.buy}>
          <span className={styles.bigPrice}>от {est.toLocaleString('ru-RU')} ₽</span>
          {!readOnly && (
            <button type="button" className={styles.select} onClick={e => { e.stopPropagation(); onSelect(s); }}>
              Выбрать модель
            </button>
          )}
        </div>
      </div>
      {lightbox !== null && photos.length > 0 && (
        <PhotoLightbox photos={photos} startIdx={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

/** Строка модели: клик раскрывает, Enter и двойной клик выбирают */
function SkuRow({ s, est, isSelected, isExpanded, readOnly, onToggle, onSelect }) {
  const meta = s.shortDesc ? ' · ' + s.shortDesc : s.description ? ' · ' + s.description.slice(0, 40) : '';
  const cls = [styles.row, isSelected && styles.selected, isExpanded && styles.expanded].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-expanded={isExpanded}
      aria-disabled={readOnly || undefined}
      onClick={() => onToggle(s)}
      onDoubleClick={() => onSelect(s)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onSelect(s); }
        if (e.key === ' ') { e.preventDefault(); onToggle(s); }
      }}
    >
      <div className={styles.photo}><SkuPhoto s={s} /></div>
      <div className={styles.info}>
        <div className={styles.name}>{s.name}</div>
        <div className={styles.meta}>{s.fit || '—'} · {(s.zones || []).length} зон{meta}</div>
      </div>
      <span className={styles.price}>от {est.toLocaleString('ru-RU')} ₽</span>
      <Icon name="chevronDown" size={16} className={styles.chevron} />
    </div>
  );
}

/** Фильтры каталога: категория, фит, поиск */
function Filters({ cats, skuFilter, setSkuFilter, fitFilter, setFitFilter, skuSearch, setSkuSearch }) {
  return (
    <>
      <div className={styles.pills} role="group" aria-label="Категория">
        <button type="button" className={styles.pill} aria-pressed={skuFilter === 'all'} onClick={() => setSkuFilter('all')}>Все</button>
        {cats.map(c => (
          <button key={c.id} type="button" className={styles.pill} aria-pressed={skuFilter === c.id} onClick={() => setSkuFilter(c.id)}>{c.name}</button>
        ))}
      </div>
      <div className={styles.fits} role="group" aria-label="Фит">
        {FIT_OPTIONS.map(f => (
          <button key={f.key} type="button" className={styles.fit} aria-pressed={fitFilter === f.key} onClick={() => setFitFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className={styles.searchWrap}>
        <input
          type="text"
          className={panel.search}
          placeholder="Поиск: футболка, худи, артикул..."
          aria-label="Поиск модели"
          value={skuSearch}
          onChange={e => setSkuSearch(e.target.value)}
        />
        {skuSearch && (
          <button type="button" className={styles.clear} onClick={() => setSkuSearch('')} aria-label="Очистить поиск">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Список моделей. `readOnly` — выбор закрыт (заказ не черновик): строки
 * раскрываются для просмотра, но модель не меняется. Порядок каталога
 * правит админка, а не менеджер: перетаскивание строк с записью каталога
 * в `app_config` целиком (мимо `catalog_put`, без сверки с базой) убрано
 * в вехе 4 — оно было выключено в единственном месте использования.
 */
export default function SkuList({ readOnly = false }) {
  const { skuCatalog, skuFilter, setSkuFilter, selectSku, sku, fabric, fabricsCatalog, trimCatalog, usdRate } = useStore(
    useShallow(s => ({ skuCatalog: s.skuCatalog, skuFilter: s.skuFilter, setSkuFilter: s.setSkuFilter,
      selectSku: s.selectSku, sku: s.sku, fabric: s.fabric, fabricsCatalog: s.fabricsCatalog,
      trimCatalog: s.trimCatalog, usdRate: s.usdRate }))
  );
  const [fitFilter, setFitFilter] = useState('all');
  const [skuSearch, setSkuSearch] = useState('');
  const [expandedCode, setExpandedCode] = useState(null);
  const deferredSearch = useDeferredValue(skuSearch);
  const usedCats = [...new Set(skuCatalog.map(s => s.category))];
  const cats = SKU_CATEGORIES.filter(c => usedCats.includes(c.id));

  let filtered = skuFilter === 'all' ? skuCatalog : skuCatalog.filter(s => s.category === skuFilter);
  if (fitFilter !== 'all') {
    filtered = filtered.filter(s => s.fit === fitFilter);
  }
  const totalBeforeSearch = filtered.length;
  if (deferredSearch.trim()) {
    const q = deferredSearch.toLowerCase();
    filtered = filtered.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.code?.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q)
    );
  }

  const groups = {};
  filtered.forEach(s => { if (!groups[s.category]) groups[s.category] = []; groups[s.category].push(s); });
  const catOrder = SKU_CATEGORIES.map(c => c.id);

  const handleRowClick = (s) => {
    setExpandedCode(prev => prev === s.code ? null : s.code);
  };

  const handleSelect = (s) => {
    if (readOnly) return;
    selectSku(s);
    setExpandedCode(null);
  };

  return (
    <section className={panel.section} aria-labelledby="garment-sku-title">
      <div className={panel.sectionLabel} id="garment-sku-title">Изделие</div>
      <Filters
        cats={cats} skuFilter={skuFilter} setSkuFilter={setSkuFilter}
        fitFilter={fitFilter} setFitFilter={setFitFilter} skuSearch={skuSearch} setSkuSearch={setSkuSearch}
      />
      {skuSearch.trim() && (
        <div className={styles.count}>Найдено: {filtered.length} из {totalBeforeSearch}</div>
      )}
      <div className={styles.list}>
        {Object.keys(groups).sort((a, b) => catOrder.indexOf(a) - catOrder.indexOf(b)).map(catId => {
          const cat = SKU_CATEGORIES.find(c => c.id === catId);
          return (
            <div key={catId}>
              <div className={styles.sep}><span className={styles.sepText}>{cat?.name || catId}</span><div className={styles.sepLine} /></div>
              {groups[catId].map(s => {
                const isExpanded = expandedCode === s.code;
                return (
                  <div key={s.code}>
                    <SkuRow
                      s={s}
                      est={getSkuFromPrice(s, null, fabricsCatalog, trimCatalog, usdRate)}
                      isSelected={sku?.code === s.code}
                      isExpanded={isExpanded}
                      readOnly={readOnly}
                      onToggle={handleRowClick}
                      onSelect={handleSelect}
                    />
                    {isExpanded && (
                      <div className={styles.expand}>
                        <ExpandPanel
                          s={s}
                          fabricsCatalog={fabricsCatalog}
                          fabricCode={sku?.code === s.code ? fabric : null}
                          trimCatalog={trimCatalog}
                          usdRate={usdRate}
                          onSelect={handleSelect}
                          readOnly={readOnly}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
