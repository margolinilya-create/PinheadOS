import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { EmptyState } from '../../components/ErpStates';
import { Skeleton } from '../../components/ErpSkeletons';
import {
  economicsGaps, GAP_LABELS, coverageNote, assemblySourceNote, PRICE_SOURCE_NOTE, money, qty,
} from '../../utils/itemEconomics';
import styles from '../../styles';

/**
 * ЭКОНОМИКА ПОЗИЦИИ (правка заказчика 20.09, п. 9).
 *
 * «Система автоматически собирает данные из закупки, закройки и швейного цеха
 * и выводит расчёт во вкладке „Экономика позиции". На текущем этапе считаем
 * только основное полотно и пошив».
 *
 * СЧИТАЕТ СЕРВЕР (`erp_item_economics`), здесь — только показ. Вторая
 * реализация тех же формул на клиенте разошлась бы с первой молча, и
 * заметили бы это по расхождению с разделом «Аналитика», который берёт
 * те же числа.
 *
 * ПУСТОЕ СОСТОЯНИЕ ЧЕСТНОЕ, А НЕ НУЛЕВОЕ. На бою размерных строк закроя нет
 * ни одной, а стоимость сборки не вводили ни разу — то есть первым, что
 * увидит заказчик, будет именно оно. «0 ₽» на этом месте читается как
 * «производство бесплатное», а не как «данных пока нет».
 */
export function EconomicsSection({ order }) {
  const { orderEconomics, economicsLoading, loadOrderEconomics } = useErpStore(useShallow((s) => ({
    orderEconomics: s.orderEconomics,
    economicsLoading: s.economicsLoading,
    loadOrderEconomics: s.loadOrderEconomics,
  })));
  const rows = orderEconomics?.[order.id] ?? null;

  useEffect(() => {
    if (!rows) loadOrderEconomics(order.id);
  }, [rows, order.id, loadOrderEconomics]);

  const [itemId, setItemId] = useState(null);
  const current = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    return rows.find((r) => r.item_id === itemId) ?? rows[0];
  }, [rows, itemId]);

  if (!rows && economicsLoading) return <Skeleton lines={4} />;
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon="box"
        title="Считать пока нечего"
        text="В заказе нет позиций, по которым можно посчитать себестоимость."
      />
    );
  }

  const e = current.economics;
  const gaps = economicsGaps(e);
  const fabric = e?.fabric ?? [];

  return (
    <div className={styles.economics}>
      {/* Переключатель позиций: расчёт принадлежит ПОЗИЦИИ, а в заказе
          их бывает с десяток — сводить их в одну цифру документ не просит */}
      {rows.length > 1 && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Позиция</span>
          <select
            className={styles.select}
            value={current.item_id}
            onChange={(ev) => setItemId(ev.target.value)}
            aria-label="Позиция заказа"
          >
            {rows.map((r) => (
              <option key={r.item_id} value={r.item_id}>
                {[r.product_type, r.variant].filter(Boolean).join(' ') || 'Без названия'}
                {` — ${r.qty} шт`}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Выкроено</span>
          <span className={styles.metricValue}>{qty(e.qty_cut, 'шт')}</span>
          <span className={styles.subText}>из закроя</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Годных произведено</span>
          <span className={styles.metricValue}>{qty(e.qty_good, 'шт')}</span>
          <span className={styles.subText}>из швейного цеха</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Рулонов использовано</span>
          <span className={styles.metricValue}>{qty(e.rolls_used, 'шт')}</span>
          <span className={styles.subText}>из закроя</span>
        </div>
      </div>

      {/* РАСХОД — СТРОКОЙ НА ЕДИНИЦУ ИЗМЕРЕНИЯ. Сложить «61 кг и 120 м»
          нельзя: пересчёта единиц система не делает, и одно число здесь
          было бы выдумкой. Стоимость при этом складывается — рубли общие */}
      {fabric.length > 0 ? (
        <div className={styles.metricGrid}>
          {fabric.map((f) => (
            <div key={f.unit ?? 'без единицы'} className={styles.metricCard}>
              <span className={styles.metricLabel}>
                Расход полотна{f.unit ? `, ${f.unit}` : ''}
              </span>
              <span className={styles.metricValue}>{qty(f.qty_used, f.unit)}</span>
              <span className={styles.subText}>
                на выкроенную единицу: {qty(f.avg_per_cut, f.unit)}
              </span>
              {coverageNote(f.priced_qty, f.qty_used, f.unit) && (
                <span className={styles.subText}>
                  {coverageNote(f.priced_qty, f.qty_used, f.unit)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.queueReason} role="status">
          Расход полотна не зафиксирован: закрой ещё не сдавал результат по рулонам.
        </p>
      )}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Стоимость полотна</span>
          <span className={styles.metricValue}>{money(e.fabric_cost_total)}</span>
          <span className={styles.subText}>{PRICE_SOURCE_NOTE}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Полотно на годную единицу</span>
          <span className={styles.metricValue}>{money(e.fabric_cost_per_good)}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Пошив за единицу</span>
          <span className={styles.metricValue}>{money(e.assembly?.avg)}</span>
          {assemblySourceNote(e) && (
            <span className={styles.subText}>{assemblySourceNote(e)}</span>
          )}
        </div>
        {/* ГЛАВНОЕ ЧИСЛО ДОКУМЕНТА — отдельной, выделенной плиткой */}
        <div className={`${styles.metricCard} ${styles.metricCardAccent}`}>
          <span className={styles.metricLabel}>Прямая себестоимость единицы</span>
          <span className={styles.metricValue}>{money(e.direct_unit_cost)}</span>
          <span className={styles.subText}>полотно на годную + пошив</span>
        </div>
      </div>

      {gaps.length > 0 && (
        <p className={styles.queueReason} role="status">
          Расчёт неполный: {gaps.map((g) => GAP_LABELS[g]).join('; ')}.
        </p>
      )}

      <p className={styles.subText}>
        Считаются только основное полотно и пошив. Отделочные материалы,
        фурнитура, нанесения и упаковка в расчёт пока не входят.
      </p>
    </div>
  );
}
