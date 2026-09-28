import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { EmptyState } from '../../components/ErpStates';
/* Примитив-полоска живёт в общих компонентах; `ErpSkeletons` — это ГОТОВЫЕ
   скелеты экранов (таблица, очередь, канбан), и одиночной полоски там нет */
import { Skeleton } from '../../../components/shared/Skeleton';
import {
  economicsGaps, GAP_LABELS, COST_MISSING_LABELS, coverageNote, fabricNote, assemblySourceNote,
  PRICE_SOURCE_NOTE, PLAN_COST_NOTE, COST_SCOPE_NOTE, NO_DATA_TEXT, money, qty,
} from '../../utils/itemEconomics';
import { fmtM } from '../../utils/fabricMetres';
import { LossesSection } from './LossesSection';
import styles from '../../styles';

/**
 * ЭКОНОМИКА ПОЗИЦИИ (правка заказчика 20.09, п. 9; метры и «Остатки
 * и потери» — 27.09, пп. 4, 7, 8).
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
 * ПУСТОЕ СОСТОЯНИЕ ЧЕСТНОЕ, А НЕ НУЛЕВОЕ. «0 ₽» на этом месте читается как
 * «производство бесплатное», а не как «данных пока нет». То же с двумя
 * показателями на единицу: при нулевом знаменателе — «Нет данных для
 * расчёта», а не ноль (прямое требование документа).
 *
 * «ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ» — пока есть изделия в работе, переделке или
 * неразобранные расхождения (правки 27.09, пп. 7 и 8): 368 сданных
 * из 472 принятых не выпуск, и вкладка обязана это сказать.
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

  /* Полоски, а не «Загрузка…»: вкладка — сетка плиток, и место под них
     занимается заранее, чтобы содержимое не прыгало при появлении */
  if (!rows && economicsLoading) {
    return (
      <div className={styles.metricGrid}>
        <Skeleton width="100%" height={48} />
        <Skeleton width="100%" height={48} />
        <Skeleton width="100%" height={48} />
      </div>
    );
  }
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
  const fabric = e?.fabric ?? null;
  const missing = e?.costs?.missing ?? [];
  const noteFabric = fabricNote(e);
  const coverage = coverageNote(fabric?.priced_metres, fabric?.metres);

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

      {/*
        СТАТУС РАСЧЁТА (правка 27.09, п. 8): два признака порознь —
        «производство завершено» и «затраты заполнены». Пока хоть один
        не выполнен, расчёт назван предварительным.
      */}
      <p className={styles.queueReason} role="status">
        {e?.preliminary
          ? <b>Предварительный расчёт</b>
          : <b>Расчёт по завершённому производству</b>}
        {' · '}
        производство {e?.production_done ? 'завершено' : 'не завершено'}
        {' · '}
        затраты {e?.costs_filled
          ? 'заполнены'
          : `заполнены не полностью (не учтены: ${missing.map((m) => COST_MISSING_LABELS[m] ?? m).join('; ')})`}
      </p>

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Выкроено</span>
          <span className={styles.metricValue}>{qty(e?.qty_cut, 'шт')}</span>
          <span className={styles.subText}>из закроя, включая плюсы</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Годных сшито</span>
          <span className={styles.metricValue}>{qty(e?.qty_good, 'шт')}</span>
          <span className={styles.subText}>из швейного цеха</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Готовый выпуск</span>
          <span className={styles.metricValue}>{qty(e?.final_good, 'шт')}</span>
          <span className={styles.subText}>после всех операций · клиентский тираж {e?.client_qty ?? current.qty} шт</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Рулонов использовано</span>
          <span className={styles.metricValue}>{qty(e?.rolls_used, 'шт')}</span>
          <span className={styles.subText}>из закроя</span>
        </div>
        {e?.qty_extra > 0 && (
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Плюс закроя</span>
            <span className={styles.metricValue}>{qty(e.qty_extra, 'шт')}</span>
            <span className={styles.subText}>скроено сверх заказа</span>
          </div>
        )}
      </div>

      {/*
        РАСХОД — В МЕТРАХ (правка 27.09, п. 4). Средний — на годную скроенную
        единицу, включая плюсы: делитель — выход закроя, а не тираж. Часть
        строк, пересчитанная из кг, названа «расчёт», непересчитанная —
        килограммами: одно число без оговорки было бы выдумкой.
      */}
      {fabric && (fabric.metres > 0 || fabric.incomplete_kg > 0) ? (
        <div className={styles.metricGrid}>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Расход полотна, м</span>
            <span className={styles.metricValue}>{fmtM(fabric.metres)}</span>
            <span className={styles.subText}>
              на годную скроенную единицу: {fabric.avg_m_per_cut === null ? NO_DATA_TEXT : fmtM(fabric.avg_m_per_cut)}
            </span>
            {noteFabric && <span className={styles.subText}>{noteFabric}</span>}
            {coverage && <span className={styles.subText}>{coverage}</span>}
          </div>
        </div>
      ) : (
        <p className={styles.queueReason} role="status">
          Расход полотна не зафиксирован: закрой ещё не сдавал результат по рулонам.
        </p>
      )}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Стоимость полотна</span>
          <span className={styles.metricValue}>{money(e?.fabric_cost_total)}</span>
          <span className={styles.subText}>{PRICE_SOURCE_NOTE}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Полотно на годную единицу</span>
          <span className={styles.metricValue}>{money(e?.fabric_cost_per_good)}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Пошив за единицу</span>
          <span className={styles.metricValue}>{money(e?.assembly?.avg)}</span>
          {assemblySourceNote(e) && (
            <span className={styles.subText}>{assemblySourceNote(e)}</span>
          )}
        </div>
        <div className={`${styles.metricCard} ${styles.metricCardAccent}`}>
          <span className={styles.metricLabel}>{COST_SCOPE_NOTE}</span>
          <span className={styles.metricValue}>{money(e?.direct_unit_cost)}</span>
          <span className={styles.subText}>полотно на годную + пошив</span>
        </div>
      </div>

      {/*
        ДВА ПОКАЗАТЕЛЯ НА ЕДИНИЦУ (правка 27.09, п. 8): себестоимость годной
        произведённой единицы (затраты / готовый выпуск с плюсами) и затраты
        на единицу клиентского тиража — управленческий показатель покрытия,
        подписанный слово в слово с документом. Клиентский тираж рядом:
        его нельзя подменять сданным или отгруженным.
      */}
      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Себестоимость годной единицы</span>
          <span className={styles.metricValue}>
            {e?.unit_cost_good === null || e?.unit_cost_good === undefined ? NO_DATA_TEXT : money(e.unit_cost_good)}
          </span>
          <span className={styles.subText}>
            затраты позиции {money(e?.costs?.total)} / готовый выпуск {e?.final_good ?? 0} шт, включая годные плюсы
          </span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Затраты на единицу клиентского тиража</span>
          <span className={styles.metricValue}>
            {e?.unit_cost_plan === null || e?.unit_cost_plan === undefined ? NO_DATA_TEXT : money(e.unit_cost_plan)}
          </span>
          <span className={styles.subText}>{PLAN_COST_NOTE} · тираж {e?.client_qty ?? current.qty} шт</span>
          {(e?.final_good ?? 0) < (e?.client_qty ?? 0) && (
            <span className={styles.subText}>
              недовыпуск: {(e?.client_qty ?? 0) - (e?.final_good ?? 0)} шт — показатель не равен себестоимости отгруженной единицы
            </span>
          )}
        </div>
      </div>

      {/* Состав затрат — явно, статья за статьёй; незаполненная не считается нулём */}
      <p className={styles.subText}>
        Состав затрат: полотно {money(e?.costs?.fabric)} · списанные малые остатки {money(e?.costs?.scrap)}
        {' '}· пошив {money(e?.costs?.assembly)} · итого {money(e?.costs?.total)}.
        {missing.length > 0 && ` Не учтены: ${missing.map((m) => COST_MISSING_LABELS[m] ?? m).join('; ')}.`}
      </p>

      {gaps.length > 0 && (
        <p className={styles.queueReason} role="status">
          Расчёт неполный: {gaps.map((g) => GAP_LABELS[g]).join('; ')}.
        </p>
      )}

      <LossesSection losses={e?.losses} clientQty={e?.client_qty ?? current.qty} />

      <p className={styles.subText}>
        Считаются только основное полотно и пошив. Отделочные материалы,
        фурнитура, нанесения и упаковка в расчёт пока не входят.
      </p>
    </div>
  );
}
