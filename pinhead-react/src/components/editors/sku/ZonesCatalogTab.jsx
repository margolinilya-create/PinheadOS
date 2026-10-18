import { Link } from 'react-router-dom';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { TZ_ROW_LABELS, tzRowOfZone } from '../../../orderstudio/catalog/tzRows';
import { sortedZones } from '../../../orderstudio/admin/flats/zonesEdit';
import ScrollTable from './ScrollTable';
import r from './CategoryRules.module.css';

/** Адрес правки справочника зон (веха 5б, К8): «Справочники заказа» → «Флэты и зоны» → «Зоны нанесения» */
export const ZONES_EDIT_HREF = '/order-settings?tab=flats&part=zones';

function categoriesText(zone) {
  if (!zone.forCategories) return 'все';
  return zone.forCategories
    .map((id) => SKU_CATEGORIES.find((c) => c.id === id)?.name ?? id)
    .join(', ');
}

/**
 * Вкладка `/sku` «Зоны нанесения» — только просмотр (веха 5б, задача 4).
 *
 * Справочник зон `app_config.zonesCatalog` правится в одном месте —
 * «Справочники заказа» → «Флэты и зоны» → «Зоны нанесения»
 * (`orderstudio/admin/flats/ZonesCatalogEditor.jsx`): там зоны снимаются,
 * а не удаляются, название сохранённой зоны неизменно (оно — ключ
 * нанесения в заказах), есть строка матрицы ТЗ. Прежний редактор здесь
 * жёстко удалял зоны — запись из `/sku` убрана (сторож `zonesWrites.test.ts`).
 */
export default function ZonesCatalogTab({ zonesCatalog }) {
  const zones = sortedZones(zonesCatalog || []);
  return (
    <div className={r.root}>
      <p className={r.hint}>
        Справочник зон нанесения — только просмотр. Зоны нанесения правятся в{' '}
        <Link to={ZONES_EDIT_HREF}>«Справочниках заказа» → «Флэты и зоны»</Link>.
      </p>

      {zones.length === 0 ? (
        <p className={r.hint}>Зон нанесения пока нет</p>
      ) : (
        <ScrollTable className={r.scroll} label="Справочник зон нанесения">
        <table className={r.table} aria-label="Справочник зон нанесения">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Название</th>
              <th scope="col">Категории</th>
              <th scope="col">Строка ТЗ</th>
              <th scope="col">Подбор</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td className={r.id}>{z.id}</td>
                <td>{z.name}</td>
                <td>{categoriesText(z)}</td>
                <td>{TZ_ROW_LABELS[tzRowOfZone(z)]}</td>
                <td className={z.active === false ? r.off : undefined}>{z.active === false ? 'снята' : 'предлагается'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </ScrollTable>
      )}
    </div>
  );
}
