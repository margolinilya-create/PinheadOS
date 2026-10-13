import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSalesStore } from '../store/useSalesStore';
import { parseDateLocal } from '../../utils/date';
import { STATUS_LABELS, rub } from './labels';
import styles from './Sales.module.css';

const fmtDate = (d) => {
  if (!d) return '—';
  const date = parseDateLocal(d);
  return date ? date.toLocaleDateString('ru-RU') : '—';
};

/** Order v4 — список заказов продаж (срез 1) */
export default function SalesList() {
  const navigate = useNavigate();
  const { list, listLoading, loadList, createNew } = useSalesStore(useShallow((s) => ({
    list: s.list,
    listLoading: s.listLoading,
    loadList: s.loadList,
    createNew: s.createNew,
  })));
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadList(); }, [loadList]);

  const onCreate = async () => {
    setCreating(true);
    const id = await createNew();
    setCreating(false);
    if (id) navigate(`/sales/${id}`);
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Заказы v4</h1>
          <div className={styles.sub}>Расчёт и КП — пилот нового Order</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={onCreate} disabled={creating}>
          {creating ? 'Создаём…' : 'Новый заказ'}
        </button>
      </div>

      {listLoading && list.length === 0 ? (
        <div className={styles.empty}>Загрузка…</div>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          <p>Заказов пока нет.</p>
          <button type="button" className="btn" onClick={onCreate} disabled={creating}>Создать первый</button>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Название</th>
              <th>Клиент</th>
              <th>Статус</th>
              <th className={styles.right}>Сумма</th>
              <th>Срок</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td className={styles.num}>
                  <button type="button" className={styles.link} onClick={() => navigate(`/sales/${o.id}`)}>
                    {o.order_number || 'без номера'}
                  </button>
                </td>
                <td>{o.title || <span className={styles.muted}>без названия</span>}</td>
                <td>{o.customer || '—'}</td>
                <td><span className={styles.badge}>{STATUS_LABELS[o.status] ?? o.status}</span></td>
                <td className={`${styles.num} ${styles.right}`}>{rub(o.price_total)}</td>
                <td className={styles.num}>{fmtDate(o.due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
