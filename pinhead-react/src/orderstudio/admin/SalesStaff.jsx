import { useEffect, useState } from 'react';
import { fetchSalesStaff, setSalesStaff } from '../api/salesStaff';
import { ROLE_LABELS } from '../../data/roles';
import base from '../screens/Sales.module.css';
import styles from './SalesStaff.module.css';

/** Признак → поле строки и подписи колонки и переключателя */
const KINDS = [
  { kind: 'sales', field: 'is_sales', column: 'Ведёт заказы', aria: 'Ведёт заказы' },
  { kind: 'ms', field: 'is_ms', column: 'Запускает в производство (МС)', aria: 'МС' },
];

/** Ключ сохранения: строка и признак — два переключателя строки не мешают друг другу */
const savingKey = (id, kind) => `${id}:${kind}`;

/**
 * Сотрудники продаж (веха 3, задача 0; веха 4, задача 0): руководство продаж
 * (admin, director, rop) отмечает, кто ведёт заказы (`is_sales`) и кто МС
 * (`is_ms`). Права — на сервере (`sales_set_staff`), экран только передаёт
 * намерение. Переключатель — optimistic с откатом своего признака при отказе.
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

  // Меняется ровно одно поле строки: откат одного признака не трогает второй
  const patch = (id, field, value) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const markSaving = (key, on) =>
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const onToggle = async (row, { kind, field }) => {
    const prevValue = row[field];
    const key = savingKey(row.id, kind);
    patch(row.id, field, !prevValue);
    markSaving(key, true);
    const ok = await setSalesStaff(row.id, kind, !prevValue);
    if (!ok) patch(row.id, field, prevValue);
    markSaving(key, false);
  };

  // Отключённый с признаком не работает — в счётчики не входит
  const countOf = (field) => (rows ? rows.filter((r) => r[field] && r.active).length : 0);

  return (
    <div className={base.page}>
      <div className={base.head}>
        <div>
          <h1 className={base.title}>Сотрудники продаж</h1>
          <div className={base.sub}>
            <p className={styles.subLine}>«Ведёт заказы» — заводит и ведёт свои заказы.</p>
            <p className={styles.subLine}>
              «МС» — видит заказы в работе и запускает их в производство. Должность в ERP и роль «Менеджер» доступа не дают.
            </p>
          </div>
        </div>
        {rows && (
          <div className={styles.count}>Продавцов: {countOf('is_sales')} · МС: {countOf('is_ms')}</div>
        )}
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
              {KINDS.map((k) => <th key={k.kind}>{k.column}</th>)}
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
                  {KINDS.map((k) => (
                    <td key={k.kind} data-label={k.column}>
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={r[k.field] === true}
                          disabled={saving.has(savingKey(r.id, k.kind))}
                          onChange={() => onToggle(r, k)}
                          aria-label={`${k.aria}: ${name}`}
                        />
                        <span aria-hidden="true">{r[k.field] ? 'Да' : 'Нет'}</span>
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
