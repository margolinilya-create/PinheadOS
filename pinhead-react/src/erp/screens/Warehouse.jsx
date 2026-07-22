import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Badge } from '../components/Badge';
import { FilterBar } from '../components/FilterBar';
import { Pagination } from '../components/Pagination';
import { Drawer } from '../components/Drawer';
import { useErpStore } from '../store/useErpStore';
import { matchesOrderQuery } from '../utils/orderSearch';
import { formatDateShort } from '../utils/time';
import {
  WAREHOUSE_TASK_TYPE_LABELS, MARKING_STATUS_LABELS, PACK_SHIP_STATUS_LABELS,
  SUBCONTRACT_RECEIPT_STATUS_LABELS,
} from '../types';
import styles from '../erp.module.css';
import { MaterialReceiptCard } from './warehouse/MaterialReceiptCard';
import { MarkingCard } from './warehouse/MarkingCard';
import { PackShipCard } from './warehouse/PackShipCard';
import { SubcontractReceiptCard } from './warehouse/SubcontractReceiptCard';

/**
 * Склад (редизайн): таблица задач (KPI + вкладки по типу + пагинация); детали и действия
 * задачи открываются в правом Drawer (переиспользуются карточки приёмки/маркировки/упаковки).
 * Бизнес-логика (acceptMaterial/advanceWarehouseTask, гейты, отгрузка) не менялась.
 */

const TYPE_ICON = { material_receipt: '📥', subcontract_receipt: '🚚', marking: '🏷️', pack_ship: '📦' };
const TERMINAL = { material_receipt: 'accepted', subcontract_receipt: 'accepted', marking: 'issued', pack_ship: 'shipped' };
const TYPE_ORDER = { material_receipt: 0, subcontract_receipt: 1, marking: 2, pack_ship: 3 };
const RECEIPT_LABELS = { awaiting: 'Ожидает приёмки', accepted: 'Принято', awaiting_receipt: 'Ожидает приёмки' };

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'material_receipt', label: 'Приёмка материалов' },
  { key: 'subcontract_receipt', label: 'Приёмка подряда' },
  { key: 'marking', label: 'Маркировка' },
  { key: 'pack_ship', label: 'Упаковка/отгрузка' },
];

function taskStatusLabel(task) {
  switch (task.task_type) {
    case 'marking': return MARKING_STATUS_LABELS[task.status] ?? task.status;
    case 'pack_ship': return PACK_SHIP_STATUS_LABELS[task.status] ?? task.status;
    case 'subcontract_receipt': return SUBCONTRACT_RECEIPT_STATUS_LABELS[task.status] ?? task.status;
    default: return RECEIPT_LABELS[task.status] ?? task.status;
  }
}
function taskVariant(task) {
  if (task.status === TERMINAL[task.task_type]) return 'ready';
  if (task.status === 'awaiting' || task.status === 'awaiting_receipt' || task.status === 'new') return 'waiting';
  return 'progress';
}
/** Краткое «содержимое» задачи для колонки таблицы */
function taskSummary(order, task) {
  if (task.task_type === 'material_receipt' || task.task_type === 'subcontract_receipt') {
    const n = order.materials.length;
    return task.task_type === 'subcontract_receipt' ? 'Готовое изделие' : `${n} ${n === 1 ? 'материал' : 'материалов'}`;
  }
  if (task.task_type === 'marking') return task.marking_type || 'Маркировка';
  return 'Упаковка и отгрузка';
}

export default function Warehouse() {
  const { orders, loaded, loadError, loadAll, acceptMaterial, advanceWarehouseTask } = useErpStore(
    useShallow((s) => ({
      orders: s.orders, loaded: s.loaded, loadError: s.loadError, loadAll: s.loadAll,
      acceptMaterial: s.acceptMaterial, advanceWarehouseTask: s.advanceWarehouseTask,
    })),
  );
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openId, setOpenId] = useState(null);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const allRows = useMemo(() => {
    const list = [];
    for (const o of orders) {
      if (o.status !== 'active') continue;
      for (const t of (o.warehouse_tasks ?? [])) list.push({ order: o, task: t });
    }
    return list.sort((a, b) => {
      const byType = (TYPE_ORDER[a.task.task_type] ?? 9) - (TYPE_ORDER[b.task.task_type] ?? 9);
      return byType || (a.task.created_at || '').localeCompare(b.task.created_at || '');
    });
  }, [orders]);

  const counts = useMemo(() => {
    const c = { all: allRows.length, material_receipt: 0, subcontract_receipt: 0, marking: 0, pack_ship: 0 };
    for (const { task } of allRows) c[task.task_type] += 1;
    return c;
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(({ order, task }) => {
      if (tab !== 'all' && task.task_type !== tab) return false;
      if (onlyOpen && task.status === TERMINAL[task.task_type]) return false;
      if (q && !matchesOrderQuery(order, q)) return false;
      return true;
    });
  }, [allRows, tab, onlyOpen, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Открытая в Drawer задача — берём свежую из стора (после действий обновляется).
  // Дешёвый поиск, без useMemo (ранние return в memo не сохраняются React-компилятором).
  let open = null;
  if (openId) {
    for (const o of orders) {
      const t = (o.warehouse_tasks ?? []).find((x) => x.id === openId);
      if (t) { open = { order: o, task: t }; break; }
    }
  }

  return (
    <>
      <PageHead title="Склад" sub="Приёмка материалов, приёмка подряда, маркировка, упаковка и отгрузка." />

      {loaded && (
        <div className={styles.dashKpis} style={{ marginBottom: 16 }}>
          {[
            { icon: '🗂️', cls: '', label: 'Все задачи', val: counts.all },
            { icon: '📥', cls: styles.kpiIconWarn, label: 'Приёмка материалов', val: counts.material_receipt },
            { icon: '🚚', cls: styles.kpiIconViolet, label: 'Приёмка подряда', val: counts.subcontract_receipt },
            { icon: '🏷️', cls: '', label: 'Маркировка', val: counts.marking },
            { icon: '📦', cls: styles.kpiIconOk, label: 'Упаковка/отгрузка', val: counts.pack_ship },
          ].map((k) => (
            <div key={k.label} className={styles.kpiCard}>
              <span className={`${styles.kpiIcon} ${k.cls}`}>{k.icon}</span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>{k.label}</span>
                <span className={styles.kpiCardValue}>{k.val}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <FilterBar
        search={query} onSearch={(v) => { setQuery(v); setPage(1); }}
        searchPlaceholder="Поиск: заказ, № сделки, изделие, материал" searchLabel="Поиск задач склада"
        right={(
          <label className={styles.checkRow}>
            <input type="checkbox" checked={onlyOpen} onChange={(e) => { setOnlyOpen(e.target.checked); setPage(1); }} />
            <span className={styles.subText}>Только открытые</span>
          </label>
        )}
      >
        {TABS.map((f) => (
          <button
            key={f.key} type="button" aria-pressed={tab === f.key}
            className={`${styles.chip} ${tab === f.key ? styles.chipProgress : styles.chipNeutral}`}
            style={{ cursor: 'pointer', font: 'inherit' }}
            onClick={() => { setTab(f.key); setPage(1); }}
          >
            {f.label} {counts[f.key] > 0 && <b>{counts[f.key]}</b>}
          </button>
        ))}
      </FilterBar>

      {loadError && !loaded && (
        <div className={styles.emptyState}>
          Не удалось загрузить данные.{' '}
          <button type="button" className="btn btn-secondary" onClick={() => loadAll()}>Повторить</button>
        </div>
      )}
      {loaded && filtered.length === 0 && (
        <div className={styles.emptyState}>{onlyOpen ? 'Открытых задач склада нет.' : 'Задач склада нет.'}</div>
      )}

      {loaded && filtered.length > 0 && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Тип задачи</th><th>Заказ</th><th>Содержимое</th><th>Статус</th><th>Срок</th><th>Действие</th></tr>
              </thead>
              <tbody>
                {pageRows.map(({ order, task }) => (
                  <tr key={task.id} className={styles.rowClickable} onClick={() => setOpenId(task.id)}>
                    <td>{TYPE_ICON[task.task_type]} {WAREHOUSE_TASK_TYPE_LABELS[task.task_type]}</td>
                    <td>№{order.bitrix_id || '—'}<div className={styles.subText}>{order.title}</div></td>
                    <td>{taskSummary(order, task)}</td>
                    <td><Badge variant={taskVariant(task)}>{taskStatusLabel(task)}</Badge></td>
                    <td>{formatDateShort(task.deadline) || '—'}</td>
                    <td>
                      <button type="button" className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setOpenId(task.id); }}>
                        Открыть
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={safePage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
            onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}

      {open && (
        <Drawer
          onClose={() => setOpenId(null)}
          title={`${WAREHOUSE_TASK_TYPE_LABELS[open.task.task_type]}`}
          subtitle={`№${open.order.bitrix_id || '—'} · ${open.order.title}`}
          badge={<Badge variant={taskVariant(open.task)}>{taskStatusLabel(open.task)}</Badge>}
        >
          {open.task.task_type === 'material_receipt' && (
            <MaterialReceiptCard order={open.order} task={open.task} onAccept={acceptMaterial} />
          )}
          {open.task.task_type === 'subcontract_receipt' && (
            <SubcontractReceiptCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
          )}
          {open.task.task_type === 'marking' && (
            <MarkingCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
          )}
          {open.task.task_type === 'pack_ship' && (
            <PackShipCard order={open.order} task={open.task} onAdvance={advanceWarehouseTask} />
          )}
        </Drawer>
      )}
    </>
  );
}
