import { useState } from 'react';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { ZONE_LABELS } from '../../../data/constants';
import { SearchInput } from '../../../erp/components/SearchInput';
import ScrollTable from './ScrollTable';
import { Button } from '../../../erp/components/Button';
import { Icon } from '../../../erp/components/Icon';
/*
 * БЮДЖЕТ ОБОЛОЧКИ ERP (как в `OrderSettings.jsx`): чанк `ErpStates` делят модули
 * оболочки ERP и ленивые экраны Order. Если этот чанк берёт `useMediaQuery`,
 * `erp.module.css` и примитивы без `ErpStates`, Rollup режет общий чанк надвое,
 * и оболочка ERP растёт (+234 Б JS, +197 Б CSS gzip при замере 18.10) без правки
 * ERP. `EmptyResult` здесь — настоящее состояние «под поиск ничего не попало»
 * и он же держит набор импортёров чанка прежним. Убирая, сверять `bundle:budget`.
 */
import { EmptyResult } from '../../../erp/components/ErpStates';
import SkuDetailModal from './SkuDetailModal';
import a11y from '../../../orderstudio/ui/a11y.module.css';
import t from './skuTable.module.css';

const FITS = ['regular', 'free', 'oversize'];

/** Вкладка «Изделия» каталога (`/sku`): модели по категориям, правка в строке */
export default function SkuItemsTab({
  search, setSearch, catFilter, setCatFilter,
  filteredSku, groupedSku, skuCatalog, trimCatalog,
  updateSku, deleteSku, estimatePrice, setShowAddModal, setShowZonesModal, onPersist, readOnly = false,
}) {
  const [detailIdx, setDetailIdx] = useState(null);
  const getCatName = (id) => SKU_CATEGORIES.find(c => c.id === id)?.name || id;

  return (
    <div className={t.body}>
      <div className={t.toolbar}>
        <SearchInput value={search} onChange={setSearch} placeholder="Название или артикул" ariaLabel="Поиск модели" />
        <select className={t.select} value={catFilter} onChange={e => setCatFilter(e.target.value)} aria-label="Категория">
          <option value="all">Все категории</option>
          {SKU_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className={t.count}>Моделей: {filteredSku.length}</span>
        <span className={t.spacer} />
        {!readOnly && (
          <Button icon="plus" onClick={() => setShowAddModal(true)}>Добавить модель</Button>
        )}
      </div>

        {Object.entries(groupedSku).map(([cat, items]) => (
          <section key={cat} className={t.group} aria-labelledby={`sku-group-${cat}`}>
            <h2 id={`sku-group-${cat}`} className={t.groupHead}>
              {getCatName(cat)}
              <span className={t.groupCount}>{items.length}</span>
            </h2>
            <ScrollTable label={`Модели: ${getCatName(cat)}`} readOnly={readOnly}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th scope="col">№</th>
                    <th scope="col">Фото</th>
                    <th scope="col">Артикул</th>
                    <th scope="col">Название</th>
                    <th scope="col">Fit</th>
                    <th scope="col">Пошив, ₽</th>
                    <th scope="col">Осн., м</th>
                    <th scope="col">Отд., м</th>
                    <th scope="col">Отделка</th>
                    <th scope="col">Зоны</th>
                    <th scope="col">Цена</th>
                    <th scope="col"><span className={a11y.srOnly}>Удалить</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    const realIdx = skuCatalog.indexOf(s);
                    const zones = (s.zones || []).map(z => ZONE_LABELS[z] || z).join(', ');
                    return (
                      <tr key={s.code}>
                        <td className={`${t.num} ${t.dim}`}>{realIdx + 1}</td>
                        <td>
                          <button type="button" className={t.thumb} onClick={() => setDetailIdx(realIdx)}
                            aria-label={`Карточка модели: ${s.name}`}>
                            {s.photos?.[0] ? <img src={s.photos[0]} alt="" /> : <Icon name="image" size={18} />}
                          </button>
                        </td>
                        <td className={t.code}>{s.code}</td>
                        <td>
                          <input className={`${t.input} ${t.name}`} value={s.name} aria-label={`Название: ${s.code}`}
                            onChange={e => updateSku(realIdx, 'name', e.target.value)} />
                        </td>
                        <td>
                          {s.fit !== null ? (
                            <select className={t.select} value={s.fit || 'regular'} aria-label={`Fit: ${s.name}`}
                              onChange={e => updateSku(realIdx, 'fit', e.target.value)}>
                              {FITS.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                          ) : <span className={t.dim}>—</span>}
                        </td>
                        <td>
                          <input className={`${t.input} ${t.numInput}`} type="number" value={s.sewingPrice}
                            aria-label={`Пошив, ₽: ${s.name}`}
                            onChange={e => updateSku(realIdx, 'sewingPrice', Number(e.target.value) || 0)} />
                        </td>
                        <td>
                          <input className={`${t.input} ${t.numInput}`} type="number" step="0.1" value={s.mainFabricUsage}
                            aria-label={`Расход основной ткани, м: ${s.name}`}
                            onChange={e => updateSku(realIdx, 'mainFabricUsage', Number(e.target.value) || 0)} />
                        </td>
                        <td>
                          <input className={`${t.input} ${t.numInput}`} type="number" step="0.01" value={s.trimUsage || 0}
                            aria-label={`Расход отделки, м: ${s.name}`}
                            onChange={e => updateSku(realIdx, 'trimUsage', Number(e.target.value) || 0)} />
                        </td>
                        <td>
                          <select className={t.select} value={s.trimCode || ''} aria-label={`Отделка: ${s.name}`}
                            onChange={e => updateSku(realIdx, 'trimCode', e.target.value || null)}>
                            <option value="">—</option>
                            {trimCatalog.map(tr => <option key={tr.code} value={tr.code}>{tr.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <button type="button" className={t.cellBtn} onClick={() => setShowZonesModal(realIdx)}
                            aria-label={`Зоны нанесения: ${s.name} — ${zones || 'не выбраны'}`}>
                            {zones || '—'}
                          </button>
                        </td>
                        <td className={`${t.num} ${t.right}`}>от {estimatePrice(s)} ₽</td>
                        <td>
                          <Button variant="ghost" icon="trash" iconOnly aria-label={`Удалить модель: ${s.name}`}
                            onClick={() => deleteSku(realIdx)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          </section>
        ))}
      {filteredSku.length === 0 && skuCatalog.length > 0 && (
        <EmptyResult query={search.trim()} resetLabel="Показать все модели"
          onReset={() => { setSearch(''); setCatFilter('all'); }} />
      )}

      {detailIdx !== null && skuCatalog[detailIdx] && (
        <SkuDetailModal
          sku={skuCatalog[detailIdx]}
          skuIndex={detailIdx}
          onUpdate={updateSku}
          onClose={() => setDetailIdx(null)}
          onPersist={onPersist}
        />
      )}
    </div>
  );
}
