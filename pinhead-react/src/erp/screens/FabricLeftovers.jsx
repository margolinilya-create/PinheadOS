import { useMemo, useState } from 'react';
import { money } from '../utils/itemEconomics';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { PageHead } from '../components/PageHead';
import { FilterBar } from '../components/FilterBar';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { OrderLink } from '../components/OrderLink';
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
 * ЗАПРОСА НЕТ: рулоны приезжают в списочной выборке заказов с 21.09, и экран
 * читает то, что раздел уже держит.
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

export default function FabricLeftovers() {
  const { orders, loaded, loadError, loadAll } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    loaded: s.loaded,
    loadError: s.loadError,
    loadAll: s.loadAll,
  })));
  const compact = useCompactLayout();
  const [query, setQuery] = useState('');

  const all = useMemo(() => fabricLeftovers(orders), [orders]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) => [l.material, l.color, l.label, l.orderTitle]
      .filter(Boolean).some((v) => v.toLowerCase().includes(q)));
  }, [all, query]);
  const totals = useMemo(() => leftoverTotals(rows), [rows]);

  return (
    <>
      <PageHead
        title="Остатки ткани"
        sub="Пригодные остатки рулонов: сколько метров осталось после закроя и сколько это стоит"
      />

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="остатки ткани" />}
      {!loaded && !loadError && <TableSkeleton rows={5} label="Загрузка остатков" />}

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
            searchPlaceholder="Поиск: ткань, цвет, рулон, заказ"
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
                    <span className={styles.dataCardTitle}>
                      {l.material}{l.color ? ` · ${l.color}` : ''}
                    </span>
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
                    Остался от заказа <OrderLink orderId={l.orderId}>{l.orderTitle}</OrderLink>
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
                    <th scope="col">Заказ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.rollId}>
                      <th scope="row">
                        {l.material}
                        {l.color && <span className={styles.subText}> · {l.color}</span>}
                      </th>
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
                      <td><OrderLink orderId={l.orderId}>{l.orderTitle}</OrderLink></td>
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
