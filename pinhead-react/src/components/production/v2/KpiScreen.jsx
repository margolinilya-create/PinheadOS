// redesign/v2 — KPI screen (director session 13 answer to Q17)
//
// Three KPIs were asked for: on-time delivery, average order margin,
// section load (план/факт). Only section load is computable today from
// v2 data (order_tech_operations snapshots). The other two are blocked
// on external inputs (Bitrix baseline for on-time, cost model for
// margin) — shown here as placeholder cards so director can see what's
// pending and why.
//
// Pure read-only: uses useWorkshopStore.loadBoard() which already fetches
// the approved+locked operations this screen needs. No new queries.

import { useEffect, useMemo, useState } from 'react';
import { useWorkshopStore } from '../../../store/useWorkshopStore';
import { useOrdersStore } from '../../../store/useOrdersStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { Skeleton } from '../../shared/Skeleton';
import s from './v2.module.css';

const PERIODS = [
  { key: 7, label: '7 дней' },
  { key: 30, label: '30 дней' },
  { key: 90, label: '90 дней' },
  { key: 0, label: 'Всё' },
];

function formatHours(minutes) {
  if (!minutes) return '0 ч';
  const hours = minutes / 60;
  if (hours < 10) return hours.toFixed(1) + ' ч';
  return Math.round(hours).toLocaleString('ru-RU') + ' ч';
}

function formatMoney(rubles) {
  if (!rubles) return '0 ₽';
  return Math.round(rubles).toLocaleString('ru-RU') + ' ₽';
}

export default function KpiScreen() {
  useDocumentTitle('KPI');

  const sections = useWorkshopStore((st) => st.sections);
  const operationsBySection = useWorkshopStore((st) => st.operationsBySection);
  const loading = useWorkshopStore((st) => st.loading);
  const loadBoard = useWorkshopStore((st) => st.loadBoard);

  const orders = useOrdersStore((st) => st.orders);
  const fetchOrders = useOrdersStore((st) => st.fetchOrders);

  const [period, setPeriod] = useState(30);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    if (orders.length === 0) fetchOrders();
  }, [orders.length, fetchOrders]);

  const cutoffIso = useMemo(() => {
    if (!period) return null;
    const d = new Date();
    d.setDate(d.getDate() - period);
    return d.toISOString();
  }, [period]);

  // Per-section aggregates — filter ops by created_at >= cutoff.
  // minutes_snapshot and rate_snapshot are frozen at approve time
  // (ADR-0002), so we don't have to re-join catalogs here.
  const sectionRows = useMemo(() => {
    return sections.map((sec) => {
      const ops = (operationsBySection[sec.id] ?? []).filter((op) => {
        if (!cutoffIso) return true;
        return op.created_at >= cutoffIso;
      });
      const totalMinutes = ops.reduce(
        (acc, op) => acc + Number(op.minutes_snapshot || 0) * Number(op.qty || 0),
        0,
      );
      const totalMoney = ops.reduce(
        (acc, op) => acc + Number(op.rate_snapshot || 0) * Number(op.qty || 0),
        0,
      );
      return {
        id: sec.id,
        name: sec.name,
        code: sec.code,
        ops: ops.length,
        minutes: totalMinutes,
        money: totalMoney,
      };
    });
  }, [sections, operationsBySection, cutoffIso]);

  const grandMinutes = sectionRows.reduce((a, r) => a + r.minutes, 0);
  const grandMoney = sectionRows.reduce((a, r) => a + r.money, 0);
  const maxMinutes = Math.max(...sectionRows.map((r) => r.minutes), 1);

  // Orders cut for the same period — used by the margin placeholder
  // to at least show "how many orders would be in scope".
  const ordersInPeriod = useMemo(() => {
    if (!cutoffIso) return orders;
    return orders.filter((o) => o.created_at >= cutoffIso);
  }, [orders, cutoffIso]);

  return (
    <div className={s.page}>
      <h1>KPI</h1>
      <p className={s.subtitle}>
        Производственные метрики. Обновляются при каждом открытии экрана.
      </p>

      <div className={s.formRow}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${s.navChip} ${period === p.key ? s.navChipActive : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ─── Section load — the fully-computable KPI ─── */}
      <h2 style={{ marginTop: 24 }}>Загрузка участков</h2>
      <p className={s.subtitle}>
        Сумма времени операций (minutes × qty) по каждому участку за выбранный период. Данные из snapshot полей —
        не зависят от изменений в каталоге операций.
      </p>

      {loading && sectionRows.length === 0 && <Skeleton height={120} />}

      {!loading && sectionRows.length > 0 && (
        <>
          <div className={s.kpiGrid}>
            <div className={s.kpiTile}>
              <div className={s.kpiLabel}>Участков с операциями</div>
              <div className={s.kpiValue}>{sectionRows.filter((r) => r.ops > 0).length}</div>
              <div className={s.kpiSub}>из {sectionRows.length}</div>
            </div>
            <div className={s.kpiTile}>
              <div className={s.kpiLabel}>Итого часов</div>
              <div className={s.kpiValue}>{formatHours(grandMinutes)}</div>
            </div>
            <div className={s.kpiTile}>
              <div className={s.kpiLabel}>Сдельная ₽ (план)</div>
              <div className={s.kpiValue}>{formatMoney(grandMoney)}</div>
              <div className={s.kpiSub}>rate × qty по snapshot</div>
            </div>
          </div>

          <table className={s.table} style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Участок</th>
                <th className={s.numCol}>Операций</th>
                <th className={s.numCol}>Часы</th>
                <th className={s.numCol}>Сдельная ₽</th>
                <th>Загрузка</th>
              </tr>
            </thead>
            <tbody>
              {sectionRows.map((row) => {
                const pct = maxMinutes > 0 ? (row.minutes / maxMinutes) * 100 : 0;
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className={s.numCol}>{row.ops}</td>
                    <td className={s.numCol}>{formatHours(row.minutes)}</td>
                    <td className={s.numCol}>{formatMoney(row.money)}</td>
                    <td style={{ minWidth: 140 }}>
                      <div
                        style={{
                          height: 8,
                          borderRadius: 4,
                          background: 'var(--bg1)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: 'var(--accent)',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {/* ─── Margin — blocked, placeholder ─── */}
      <h2 style={{ marginTop: 40 }}>Средняя маржа заказа</h2>
      <div className={`${s.card} ${s.blockedCard}`}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⏳</div>
        <strong>Ждём модель себестоимости</strong>
        <p style={{ marginTop: 8 }}>
          Для расчёта маржи нужен cost-model: закупка ткани + фурнитуры + трудозатраты + накладные.
          В текущей схеме есть только цены продажи и сдельная часть. Обсуждается с директором / бухгалтером.
        </p>
        <p className={s.subtitle}>
          В периоде: <strong>{ordersInPeriod.length}</strong> заказов —
          как только cost-model утвердим, посчитаю за этот же период.
        </p>
      </div>

      {/* ─── On-time delivery — blocked, placeholder ─── */}
      <h2 style={{ marginTop: 24 }}>On-time delivery</h2>
      <div className={`${s.card} ${s.blockedCard}`}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔌</div>
        <strong>Ждём Bitrix baseline</strong>
        <p style={{ marginTop: 8 }}>
          Целевой KPI: <strong>baseline + 10 п.п.</strong> Нужна история плановых и фактических дат готовности
          из Bitrix для расчёта базы. Разблокируется как только админ Bitrix даст webhook.
        </p>
      </div>
    </div>
  );
}
