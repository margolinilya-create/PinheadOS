import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from '../utils/itemEconomics';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { PageHead } from '../components/PageHead';
import { FilterBar } from '../components/FilterBar';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { OrderLink } from '../components/OrderLink';
import { Button } from '../components/Button';
import { useErpAccess } from '../store/useErpAccess';
import { useCompactLayout } from '../layout/useCompactLayout';
import { fabricLeftovers, leftoverTotals } from '../utils/fabricLeftovers';
import { fmtM, fmtKg, sourceLabel } from '../utils/fabricMetres';
import styles from '../styles';

/**
 * ОСТАТКИ ТКАНИ (правка заказчика 21.09, п. 5; в метрах — 27.09, п. 4).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «В разделе „Остатки ткани" показывать метры, источник
 * метража, ширину, плотность и исходный рулон. Килограммы показывать
 * дополнительно с отметкой „Расчёт", если остаток не взвешивали. Изменение
 * метража не должно стирать исходный вес закупки».
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ЭКРАН, А НЕ ВКЛАДКА СКЛАДА. Вкладки на складе — это
 * ФИЛЬТРЫ ПО ТИПАМ ЗАДАЧ («Приёмка материалов», «Маркировка»), а остаток
 * не задача: его никто не выполняет, на него смотрят, когда спрашивают
 * «есть ли ещё эта ткань». Отдельный адрес ещё и делится ссылкой —
 * закупщику в ответ на «надо докупить?».
 *
 * ОСТАТОК — ЭТО САМ РУЛОН, а не новая складская сущность: у него уже есть
 * метраж, вес, цена партии и заказ, в котором его открыли (`utils/fabricLeftovers`).
 * Строка остатка рядом с рулоном была бы вторым писателем того же числа.
 *
 * СВОЙ ЗАПРОС (правка 28.09). До неё экран читал рулоны из заказов в сторе —
 * а там без загруженного архива только активные, и пригодный остаток сданного
 * заказа пропадал со склада. Теперь список отдаёт `erp_fabric_leftovers()`
 * по ВСЕМ заказам; экран перечитывает его при открытии и когда стор сбросил
 * кэш (`fabricLeftovers = null` после решения по остатку или правки рулона).
 *
 * МЕСТО ХРАНЕНИЯ правят те, кто держит склад (`material.receive`,
 * `warehouse.manage`): остаток ищут на стеллаже, и без места он «есть
 * в системе», но не на полке.
 */

/** Килограммы остатка с подписью: расчётные — «(расчёт)», как велит документ */
function kgText(l) {
  if (l.kg === null) return '—';
  return `${fmtKg(l.kg)}${l.kgSource === 'calc' ? ' (расчёт)' : ''}`;
}

/** Ширина и плотность одной строкой: «180 см · 240 г/м²» */
function paramsText(l) {
  const parts = [];
  if (l.widthCm !== null) parts.push(`${l.widthCm} см`);
  if (l.densityGsm !== null) parts.push(`${l.densityGsm} г/м²`);
  return parts.length ? parts.join(' · ') : '—';
}

/**
 * Место хранения рулона: текст, а у кладовщика — правка по кнопке.
 *
 * Своя маленькая форма, а не `InlineEdit`: у того поле без видимой подписи
 * и сохранение по уходу фокуса, а на планшете склада фокус теряется от
 * любого касания рядом — и недописанное место записывалось бы молча.
 * Здесь запись — только кнопкой «Сохранить» (или Enter), Escape — отмена.
 */
function LocationCell({ leftover, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const editRef = useRef(null);
  const returnFocus = useRef(false);
  const inputId = `leftover-location-${leftover.rollId}`;

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); return; }
    if (returnFocus.current) {
      returnFocus.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  const close = () => { returnFocus.current = true; setEditing(false); };

  if (!editing) {
    return (
      <span className={styles.checkRow}>
        <span>{leftover.location || <span className={styles.subText}>не указано</span>}</span>
        {canEdit && (
          <Button
            ref={editRef}
            variant="ghost"
            icon="pencil"
            aria-label={`Изменить место хранения: ${leftover.material}, ${leftover.label}`}
            onClick={() => { setDraft(leftover.location ?? ''); setEditing(true); }}
          >
            Изменить
          </Button>
        )}
      </span>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const next = draft.trim();
    if (next === (leftover.location ?? '')) { close(); return; }
    setSaving(true);
    const ok = await onSave(leftover.rollId, next || null);
    setSaving(false);
    if (ok) close();
  };

  return (
    <form
      className={styles.checkRow}
      onSubmit={submit}
    >
      <label htmlFor={inputId} className={styles.visuallyHidden}>
        Место хранения: {leftover.material}, {leftover.label}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        className={`${styles.input} ${styles.inputXs}`}
        value={draft}
        maxLength={200}
        placeholder="Стеллаж, полка"
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); close(); }
        }}
      />
      <Button type="submit" variant="primary" loading={saving}>Сохранить</Button>
      <Button variant="ghost" disabled={saving} onClick={close}>Отмена</Button>
    </form>
  );
}

/** Заказ-источник: ссылка на карточку и статус, если он уже закрыт */
function OrderCell({ l }) {
  if (!l.orderId) return <span>{l.orderTitle}</span>;
  return (
    <>
      <OrderLink orderId={l.orderId}>{l.orderTitle}</OrderLink>
      {l.orderClosed && <span className={styles.subText}> · {l.orderStatusLabel}</span>}
    </>
  );
}

export default function FabricLeftovers() {
  const { leftovers, loadFabricLeftovers, setRollLocation } = useErpStore(useShallow((s) => ({
    leftovers: s.fabricLeftovers,
    loadFabricLeftovers: s.loadFabricLeftovers,
    setRollLocation: s.setRollLocation,
  })));
  const access = useErpAccess();
  const canEditLocation = access.can('material.receive') || access.can('warehouse.manage');
  const compact = useCompactLayout();
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /**
   * Загрузка: при открытии ВСЕГДА (кэш мог устареть, пока экран был закрыт)
   * и затем всякий раз, когда стор сбросил кэш в `null`. Флаг `requested`
   * не даёт перечитать второй раз сразу после первой удачной загрузки —
   * `missing` меняется и от неё самой.
   */
  const missing = leftovers == null;
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current && !missing) return undefined;
    requested.current = true;
    let alive = true;
    loadFabricLeftovers().then((r) => { if (alive) setFailed(r === null); });
    return () => { alive = false; };
  }, [missing, attempt, loadFabricLeftovers]);

  const retry = () => { setFailed(false); requested.current = false; setAttempt((n) => n + 1); };
  const loaded = !missing;

  const all = useMemo(() => fabricLeftovers(leftovers), [leftovers]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) => [l.material, l.color, l.label, l.orderTitle, l.location]
      .filter(Boolean).some((v) => v.toLowerCase().includes(q)));
  }, [all, query]);
  const totals = useMemo(() => leftoverTotals(rows), [rows]);

  return (
    <>
      <PageHead
        title="Остатки ткани"
        sub="Пригодные остатки рулонов: сколько метров осталось после закроя и сколько это стоит"
      />

      {failed && !loaded && <LoadFailed onRetry={retry} what="остатки ткани" />}
      {!loaded && !failed && <TableSkeleton rows={5} label="Загрузка остатков" />}

      {loaded && all.length === 0 && (
        <EmptyState
          icon="box"
          title="Остатков нет"
          text={'Остаток появляется, когда закрой заканчивает работу по рулону '
            + 'и отмечает «Остаток пригоден». Малые остатки сюда не попадают.'}
        />
      )}

      {loaded && all.length > 0 && (
        <>
          <FilterBar
            search={query}
            onSearch={setQuery}
            searchPlaceholder="Поиск: ткань, рулон, место, заказ"
            searchLabel="Поиск остатков ткани"
          />

          {/*
            ИТОГ — В МЕТРАХ, килограммы дополнительно и с отметкой «расчёт».
            Рулоны без метража (приняты до учёта в метрах) названы числом
            отдельно: иначе «12 м» читалось бы как весь остаток, когда половина
            рулонов ведётся в килограммах. Рубли общие и складываются.
          */}
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Остаток, м</span>
              <span className={styles.metricValue}>
                {fmtM(totals.lengthM)}{totals.cost === null ? '' : ` / ${money(totals.cost)}`}
              </span>
              <span className={styles.subText}>
                {totals.rolls === 1 ? '1 рулон' : `${totals.rolls} рулонов`}
                {totals.rollsWithoutMetres > 0
                  && ` · без метража: ${totals.rollsWithoutMetres} (остаток только в кг)`}
                {totals.cost === null && ' · цена рулонов не указана'}
              </span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Остаток, кг</span>
              <span className={styles.metricValue}>{fmtKg(totals.kg)}</span>
              <span className={styles.subText}>
                {totals.rollsWithMetres > 0
                  ? 'расчёт по коэффициенту рулонов, а не взвешивание'
                  : 'по учёту в килограммах'}
              </span>
            </div>
          </div>

          {rows.length === 0 && (
            <EmptyResult query={query} onReset={() => setQuery('')} />
          )}

          {rows.length > 0 && compact && (
            <div className={styles.dataCardList} role="list" aria-label="Остатки ткани">
              {rows.map((l) => (
                <div key={l.rollId} className={styles.dataCard} role="listitem">
                  <div className={styles.dataCardHead}>
                    <span className={styles.dataCardTitle}>{l.material}{l.color ? ` · ${l.color}` : ''}</span>
                    <span className={styles.subText}>{l.label} · {paramsText(l)}</span>
                  </div>
                  <div className={styles.dataCardFields}>
                    <span className={styles.dataCardField}>
                      <span className={styles.dataCardFieldLabel}>Остаток, м</span>
                      <span>
                        {fmtM(l.lengthM)}
                        {l.lengthSource ? ` (${sourceLabel(l.lengthSource)})` : ''}
                      </span>
                    </span>
                    <span className={styles.dataCardField}>
                      <span className={styles.dataCardFieldLabel}>Остаток, кг</span>
                      <span>{kgText(l)}</span>
                    </span>
                    <span className={styles.dataCardField}>
                      <span className={styles.dataCardFieldLabel}>Стоимость</span>
                      <span>{money(l.cost)}</span>
                    </span>
                  </div>
                  <div className={styles.subText}>
                    Место хранения:{' '}
                    <LocationCell leftover={l} canEdit={canEditLocation} onSave={setRollLocation} />
                  </div>
                  <div className={styles.subText}>
                    Остался от заказа <OrderCell l={l} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {rows.length > 0 && !compact && (
            <ScrollHintBox className={styles.tableWrap} label="Остатки ткани">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Материал</th>
                    <th scope="col">Рулон</th>
                    <th scope="col">Остаток, м</th>
                    <th scope="col">Источник метража</th>
                    <th scope="col">Ширина · плотность</th>
                    <th scope="col">Остаток, кг</th>
                    <th scope="col">Цена за м, ₽</th>
                    <th scope="col">Стоимость</th>
                    <th scope="col">Место хранения</th>
                    <th scope="col">Заказ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.rollId}>
                      <th scope="row">{l.material}{l.color ? ` · ${l.color}` : ''}</th>
                      <td>{l.label}</td>
                      <td>{fmtM(l.lengthM)}</td>
                      <td>{l.lengthSource ? sourceLabel(l.lengthSource) : '—'}</td>
                      <td>{paramsText(l)}</td>
                      <td>{kgText(l)}</td>
                      <td>
                        {l.pricePerM === null
                          ? '—'
                          : l.pricePerM.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                      </td>
                      <td>{money(l.cost)}</td>
                      <td>
                        <LocationCell leftover={l} canEdit={canEditLocation} onSave={setRollLocation} />
                      </td>
                      <td><OrderCell l={l} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollHintBox>
          )}
        </>
      )}
    </>
  );
}
