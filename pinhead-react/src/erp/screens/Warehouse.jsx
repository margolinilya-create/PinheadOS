import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { SearchInput } from '../components/SearchInput';
import { useErpStore } from '../store/useErpStore';
import { matchesOrderQuery } from '../utils/orderSearch';
import { WAREHOUSE_TASK_TYPE_LABELS } from '../types';
import styles from '../erp.module.css';
import { MaterialReceiptCard } from './warehouse/MaterialReceiptCard';
import { MarkingCard } from './warehouse/MarkingCard';
import { PackShipCard } from './warehouse/PackShipCard';
import { SubcontractReceiptCard } from './warehouse/SubcontractReceiptCard';

/**
 * Склад (волна 4): заказ проходит склад несколькими задачами с жизненным циклом —
 * приёмка материалов → выпуск маркировки → упаковка и отгрузка. Задачи авто-создаются
 * по переходам маршрута (триггер БД); отгрузка отсюда переводит заказ в архив.
 */

const TYPE_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'material_receipt', label: WAREHOUSE_TASK_TYPE_LABELS.material_receipt },
  { key: 'subcontract_receipt', label: WAREHOUSE_TASK_TYPE_LABELS.subcontract_receipt },
  { key: 'marking', label: WAREHOUSE_TASK_TYPE_LABELS.marking },
  { key: 'pack_ship', label: WAREHOUSE_TASK_TYPE_LABELS.pack_ship },
];

/** Терминальный статус каждого типа задачи (для фильтра «только открытые») */
const TERMINAL = {
  material_receipt: 'accepted', subcontract_receipt: 'accepted', marking: 'issued', pack_ship: 'shipped',
};
/** Порядок сортировки по типу задачи */
const TYPE_ORDER = { material_receipt: 0, subcontract_receipt: 1, marking: 2, pack_ship: 3 };

export default function Warehouse() {
  const {
    orders, loaded, loadError, loadAll, acceptMaterial, advanceWarehouseTask,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      acceptMaterial: s.acceptMaterial,
      advanceWarehouseTask: s.advanceWarehouseTask,
    })),
  );
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(true);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [];
    for (const o of orders) {
      if (o.status !== 'active') continue;
      if (q && !matchesOrderQuery(o, q)) continue;
      for (const t of (o.warehouse_tasks ?? [])) {
        if (typeFilter !== 'all' && t.task_type !== typeFilter) continue;
        if (onlyOpen && t.status === TERMINAL[t.task_type]) continue;
        list.push({ order: o, task: t });
      }
    }
    return list.sort((a, b) => {
      const byType = (TYPE_ORDER[a.task.task_type] ?? 9) - (TYPE_ORDER[b.task.task_type] ?? 9);
      if (byType) return byType;
      return (a.task.created_at || '').localeCompare(b.task.created_at || '');
    });
  }, [orders, query, typeFilter, onlyOpen]);

  return (
    <>
      <PageHead
        title="Склад"
        sub="Задачи склада: приёмка материалов, выпуск маркировки, упаковка и отгрузка."
      />

      <div className={styles.toolbar}>
        <SearchInput
          value={query} onChange={setQuery}
          placeholder="Поиск: заказ, № сделки, изделие, материал"
          ariaLabel="Поиск задач склада"
        />
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={typeFilter === f.key}
            className={`${styles.chip} ${typeFilter === f.key ? styles.chipReady : styles.chipNeutral}`}
            onClick={() => setTypeFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <label className={styles.checkRow}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          <span className={styles.subText}>Только открытые</span>
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} задач</span>
      </div>

      {loadError && !loaded && (
        <div className={styles.emptyState}>
          Не удалось загрузить данные.{' '}
          <button type="button" className="btn btn-secondary" onClick={() => loadAll()}>Повторить</button>
        </div>
      )}
      {loaded && rows.length === 0 && (
        <div className={styles.emptyState}>
          {onlyOpen ? 'Открытых задач склада нет.' : 'Задач склада нет.'}
        </div>
      )}

      {rows.map(({ order, task }) => {
        if (task.task_type === 'material_receipt') {
          return (
            <MaterialReceiptCard key={task.id} order={order} task={task} onAccept={acceptMaterial} />
          );
        }
        if (task.task_type === 'subcontract_receipt') {
          return (
            <SubcontractReceiptCard
              key={task.id} order={order} task={task} onAdvance={advanceWarehouseTask}
            />
          );
        }
        if (task.task_type === 'marking') {
          return <MarkingCard key={task.id} order={order} task={task} onAdvance={advanceWarehouseTask} />;
        }
        return <PackShipCard key={task.id} order={order} task={task} onAdvance={advanceWarehouseTask} />;
      })}
    </>
  );
}
