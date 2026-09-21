import { useMemo, useState } from 'react';
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
import styles from '../styles';

/**
 * ОСТАТКИ ТКАНИ (правка заказчика 21.09, п. 5).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Если рулон использован частично или целый рулон
 * не использован, оставшийся вес сохраняется как остаток ткани этого заказа…
 * Если выбран „Остаток пригоден", система включает его в экономику заказа
 * и показывает общий остаток ткани в кг и в рублях».
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ЭКРАН, А НЕ ВКЛАДКА СКЛАДА. Вкладки на складе — это
 * ФИЛЬТРЫ ПО ТИПАМ ЗАДАЧ («Приёмка материалов», «Маркировка»), а остаток
 * не задача: его никто не выполняет, на него смотрят, когда спрашивают
 * «есть ли ещё эта ткань». Отдельный адрес ещё и делится ссылкой —
 * закупщику в ответ на «надо докупить?».
 *
 * ОСТАТОК — ЭТО САМ РУЛОН, а не новая складская сущность: у него уже есть
 * вес, цена партии и заказ, в котором его открыли (`utils/fabricLeftovers`).
 * Строка остатка рядом с рулоном была бы вторым писателем того же веса.
 *
 * ЗАПРОСА НЕТ: рулоны приезжают в списочной выборке заказов с 21.09, и экран
 * читает то, что раздел уже держит.
 */
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

  const money = (v) => (v === null || v === undefined
    ? '—' : `${v.toLocaleString('ru-RU')} ₽`);

  return (
    <>
      <PageHead
        title="Остатки ткани"
        sub="Пригодные остатки рулонов: что осталось после закроя и сколько это стоит"
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

          {/* ИТОГ — ПО ЕДИНИЦАМ: «10 кг и 4 м» одним числом не бывает,
              пересчёта единиц система не делает. Рубли общие и складываются */}
          <div className={styles.metricGrid}>
            {totals.map((t) => (
              <div key={t.unit ?? 'без единицы'} className={styles.metricCard}>
                <span className={styles.metricLabel}>
                  Остаток{t.unit ? `, ${t.unit}` : ''}
                </span>
                <span className={styles.metricValue}>
                  {t.qty}{t.cost === null ? '' : ` / ${money(t.cost)}`}
                </span>
                <span className={styles.subText}>
                  {t.rolls === 1 ? '1 рулон' : `${t.rolls} рулонов`}
                  {t.cost === null && ' · цена рулонов не указана'}
                </span>
              </div>
            ))}
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
                    <span className={styles.subText}>{l.label}</span>
                  </div>
                  <div className={styles.dataCardFields}>
                    <span className={styles.dataCardField}>
                      <span className={styles.dataCardFieldLabel}>Остаток</span>
                      <span>{l.qty} {l.unit || ''}</span>
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
                    <th scope="col">Остаток</th>
                    <th scope="col">Цена за ед., ₽</th>
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
                      <td>{l.qty} {l.unit || ''}</td>
                      <td>{l.price === null ? '—' : l.price.toLocaleString('ru-RU')}</td>
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
