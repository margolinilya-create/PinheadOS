/**
 * Режим «Зоны нанесения» вкладки «Флэты и зоны» (веха 5б, задача 4; К8) —
 * единственный редактор справочника зон `app_config.zonesCatalog`
 * (сторож `zonesWrites.test.ts`; `/sku` → «Зоны нанесения» — только просмотр).
 *
 * `useCatalogEditor('app_config', 'zonesCatalog')`: свежее чтение, запись
 * `catalog_put` со сверкой базы, конфликт и запасной путь — `CatalogNotice`,
 * записанное — в стор (визард и холст сразу видят новые зоны).
 *
 * Правила (зеркало сервера, миграция I): зона не удаляется, а снимается
 * («Предлагать для новых позиций»); название сохранённой зоны неизменно —
 * оно ключ нанесения в заказах; id — `ZONE_ID_RE`. Пишут admin и director;
 * rop и телефон — только просмотр (на телефоне — карточки).
 */
import { useState } from 'react';
import { useAuthStore } from '../../../store/useAuthStore';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';
import { TZ_ROW_CODES, TZ_ROW_LABELS, tzRowOfZone } from '../../catalog/tzRows';
import { useCatalogEditor } from '../useCatalogEditor';
import CatalogNotice from '../CatalogNotice';
import SaveBar from '../tabs/SaveBar';
import { FLAT_WRITER_ROLES } from '../tabs/flatsView';
import {
  addZone, addZoneError, defaultTzRowLabel, moveZone, setZoneCategories, setZoneField,
  sortedZones, toggleZoneActive, zoneErrors,
} from './zonesEdit';
import base from '../../screens/Sales.module.css';
import styles from './ZonesCatalogEditor.module.css';

const NAME = 'Зоны нанесения';
const COMPACT = '(max-width: 760px)';
const CATEGORY_IDS = SKU_CATEGORIES.map((c) => c.id);

function Categories({ zone, edit }) {
  const all = !zone.forCategories;
  return (
    <div className={styles.chips} role="group" aria-label={`Категории зоны «${zone.name}»`}>
      <button type="button" className={styles.chip} aria-pressed={all} onClick={() => edit((l) => setZoneField(l, zone.id, { forCategories: null }))}>
        Все
      </button>
      {SKU_CATEGORIES.map((c) => (
        <button
          key={c.id}
          type="button"
          className={styles.chip}
          aria-pressed={all || zone.forCategories.includes(c.id)}
          onClick={() => edit((l) => setZoneCategories(l, zone.id, c.id, CATEGORY_IDS))}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function Flag({ zone, field, label, edit }) {
  return (
    <label className={styles.flag}>
      <input
        type="checkbox"
        checked={zone[field] === true}
        onChange={(e) => edit((l) => setZoneField(l, zone.id, { [field]: e.target.checked }))}
        aria-label={`${label}: зона «${zone.name}»`}
      />
      <span aria-hidden="true">{label}</span>
    </label>
  );
}

function ZoneRow({ zone, index, count, saved, edit, onDrop }) {
  const off = zone.active === false;
  return (
    <tr className={off ? styles.off : undefined}>
      <td className={styles.order}>
        <button type="button" className={styles.icon} disabled={index === 0} onClick={() => edit((l) => moveZone(l, zone.id, -1))} aria-label={`Поднять зону «${zone.name}»`}>↑</button>
        <button type="button" className={styles.icon} disabled={index === count - 1} onClick={() => edit((l) => moveZone(l, zone.id, 1))} aria-label={`Опустить зону «${zone.name}»`}>↓</button>
      </td>
      <td>
        <input
          className={base.input}
          value={zone.name}
          readOnly={saved}
          onChange={(e) => edit((l) => setZoneField(l, zone.id, { name: e.target.value }))}
          aria-label={`Название зоны «${zone.name}»`}
          aria-describedby={saved ? 'zones-name-hint' : undefined}
        />
        <span className={styles.id}>{zone.id}</span>
        {!saved && <button type="button" className={base.link} onClick={() => onDrop(zone.id)}>Убрать новую зону</button>}
      </td>
      <td><Categories zone={zone} edit={edit} /></td>
      <td className={styles.flags}>
        <Flag zone={zone} field="requiresHood" label="Только с капюшоном" edit={edit} />
        <Flag zone={zone} field="requiresPocket" label="Только с карманом" edit={edit} />
      </td>
      <td>
        <select
          className={base.select}
          value={zone.tz_row ?? ''}
          onChange={(e) => edit((l) => setZoneField(l, zone.id, { tz_row: e.target.value }))}
          aria-label={`Строка ТЗ: зона «${zone.name}»`}
        >
          <option value="">{defaultTzRowLabel(zone.id)}</option>
          {TZ_ROW_CODES.map((c) => <option key={c} value={c}>{TZ_ROW_LABELS[c]}</option>)}
        </select>
      </td>
      <td>
        <label className={styles.flag}>
          <input
            type="checkbox"
            checked={!off}
            onChange={() => edit((l) => toggleZoneActive(l, zone.id))}
            aria-label={`Предлагать для новых позиций: зона «${zone.name}»`}
          />
          <span aria-hidden="true">{off ? 'снята' : 'предлагается'}</span>
        </label>
      </td>
    </tr>
  );
}

function AddZone({ zones, edit }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const why = addZoneError(zones, id, name);
    setError(why ?? '');
    if (why) return;
    edit((l) => addZone(l, { id, name }));
    setId('');
    setName('');
  };
  return (
    <div className={styles.add}>
      <label className={base.field}>id новой зоны
        <input className={base.input} value={id} onChange={(e) => setId(e.target.value)} placeholder="pocket-l" aria-describedby="zones-add-error" />
      </label>
      <label className={base.field}>Название новой зоны
        <input className={base.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Левый карман" aria-describedby="zones-add-error" />
      </label>
      <button type="button" className="btn" onClick={add}>Добавить зону</button>
      <p id="zones-add-error" className={styles.error} aria-live="polite">{error}</p>
    </div>
  );
}

function ZoneCards({ zones }) {
  return (
    <ul className={styles.cards}>
      {zones.map((z) => (
        <li key={z.id} className={`${styles.card}${z.active === false ? ` ${styles.off}` : ''}`}>
          <h3 className={styles.cardTitle}>{z.name}</h3>
          <p className={base.muted}>
            Строка ТЗ: {TZ_ROW_LABELS[tzRowOfZone(z)]}{z.active === false && ' · снята'}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function ZonesCatalogEditor({ readOnly = false }) {
  const editor = useCatalogEditor('app_config', 'zonesCatalog');
  const compact = useMediaQuery(COMPACT);
  const role = useAuthStore((s) => s.user?.role);
  const isWriter = FLAT_WRITER_ROLES.includes(role);
  const locked = readOnly || compact || !isWriter;
  const list = Array.isArray(editor.value) ? editor.value : null;

  // Сохранённое — значение без правок (база): его названия неизменны
  const [saved, setSaved] = useState(null);
  if (list && !editor.dirty && saved !== list) setSaved(list);
  const savedList = saved ?? [];
  const savedIds = new Set(savedList.map((z) => z.id));

  const zones = list ? sortedZones(list) : [];
  const errors = list ? zoneErrors(list, savedList) : [];
  const edit = editor.setValue;
  const drop = (id) => edit((l) => l.filter((z) => z.id !== id));

  return (
    <section className={styles.root} aria-label={NAME} data-readonly={locked ? 'true' : undefined}>
      <p className={styles.intro}>
        Справочник зон нанесения: где на изделии можно разместить нанесение и в какую строку ТЗ оно попадёт.
        Зона не удаляется, а снимается — в старых заказах она остаётся.
      </p>
      {!isWriter && <p className={styles.intro} role="note">Зоны меняет администратор или директор</p>}
      <CatalogNotice editor={editor} name={NAME} />
      {list && zones.length === 0 && (
        <p className={base.muted}>{locked ? 'Зон нанесения пока нет' : 'Зон нанесения пока нет — добавьте первую'}</p>
      )}
      {list && zones.length > 0 && compact && <ZoneCards zones={zones} />}
      {list && zones.length > 0 && !compact && (
        <fieldset className={styles.fieldset} disabled={locked || editor.state === 'saving'}>
          <legend className={styles.legend}>{NAME}</legend>
          <p id="zones-name-hint" className={styles.hint}>
            Название сохранённой зоны не меняется — оно стоит в заказах. Опечатку исправляют так: снимите зону и добавьте новую.
            Снятая зона остаётся в старых заказах. Техники по зонам — в «Правилах категорий».
          </p>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- axe scrollable-region-focusable */}
          <div className={styles.scroll} role="region" aria-label={`Зон в справочнике: ${zones.length}`} tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Порядок</th>
                  <th scope="col">Название и id</th>
                  <th scope="col">Категории</th>
                  <th scope="col">Условия</th>
                  <th scope="col">Строка ТЗ</th>
                  <th scope="col">Предлагать для новых позиций</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z, i) => (
                  <ZoneRow key={z.id} zone={z} index={i} count={zones.length} saved={savedIds.has(z.id)} edit={edit} onDrop={drop} />
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      )}
      {list && !locked && (
        <>
          <AddZone zones={list} edit={edit} />
          {errors.length > 0 && (
            <ul className={styles.problems} role="status">
              {errors.map((e) => <li key={`${e.id}:${e.message}`}>{e.message}</li>)}
            </ul>
          )}
          <SaveBar editor={editor} label="Сохранить зоны" done="Зоны нанесения сохранены" invalid={errors.length > 0} />
        </>
      )}
    </section>
  );
}
