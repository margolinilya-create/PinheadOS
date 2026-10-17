import { useEffect, useState } from 'react';
import { fetchSalesStaff, setSalesStaff } from '../api/salesStaff';
import { ROLE_LABELS } from '../../data/roles';
import base from '../screens/Sales.module.css';
import styles from './SalesStaff.module.css';

/**
 * Менеджеры продаж (веха 3, задача 0): admin/director отмечают, кто продавец.
 * Продавец заводит и ведёт заказы v4; начальник цеха с профилем manager —
 * нет, пока его не отметили. Права — на сервере (`sales_set_staff`), экран
 * только передаёт намерение. Переключатель — optimistic с откатом при отказе.
 */
export default function SalesStaff() {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(() => new Set());
  // Повтор загрузки — сменой ключа: состояние ставится только в ответе запроса
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchSalesStaff().then((data) => {
      if (!alive) return;
      if (data) setRows(data);
      else setFailed(true);
    });
    return () => { alive = false; };
  }, [attempt]);

  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  const patch = (id, isSales) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_sales: isSales } : r)));

  const markSaving = (id, on) =>
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const onToggle = async (row) => {
    const next = !row.is_sales;
    patch(row.id, next);
    markSaving(row.id, true);
    const ok = await setSalesStaff(row.id, next);
    if (!ok) patch(row.id, row.is_sales);
    markSaving(row.id, false);
  };

  const count = rows ? rows.filter((r) => r.is_sales).length : 0;

  return (
    <div className={base.page}>
      <div className={base.head}>
        <div>
          <h1 className={base.title}>Менеджеры продаж</h1>
          <div className={base.sub}>
            Отмеченные заводят и ведут заказы. Остальным заказы продаж закрыты, даже с ролью «Менеджер».
          </div>
        </div>
        {rows && <div className={styles.count}>Отмечено: {count}</div>}
      </div>

      {failed ? (
        <div className={base.empty}>
          <p>Список не загрузился.</p>
          <button type="button" className="btn" onClick={retry}>Загрузить снова</button>
        </div>
      ) : !rows ? (
        <div className={base.empty}>Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className={base.empty}>Учётных записей нет.</div>
      ) : (
        <table className={`${base.table} ${base.listTable}`}>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Почта</th>
              <th>Роль</th>
              <th>Продажи</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = r.name || r.email || 'без имени';
              const state = !r.active ? 'отключён' : !r.approved ? 'не одобрен' : null;
              return (
                <tr key={r.id} className={state ? styles.off : undefined}>
                  <td data-label="Имя">
                    {name}
                    {state && <span className={base.muted}> · {state}</span>}
                  </td>
                  <td className={styles.email} data-label="Почта">{r.email || '—'}</td>
                  <td data-label="Роль">{ROLE_LABELS[r.role] ?? r.role}</td>
                  <td data-label="Продажи">
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={r.is_sales}
                        disabled={saving.has(r.id)}
                        onChange={() => onToggle(r)}
                        aria-label={`Менеджер продаж: ${name}`}
                      />
                      <span aria-hidden="true">{r.is_sales ? 'Продавец' : 'Нет'}</span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
