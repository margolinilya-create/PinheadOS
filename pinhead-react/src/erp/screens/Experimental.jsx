import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { FilterBar } from '../components/FilterBar';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Drawer';
import { Pagination } from '../components/Pagination';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { SortableTh } from '../components/SortableTh';
import { sortRows, useTableSort } from '../utils/tableSort';
import { Icon } from '../components/Icon';
import { useErpStore } from '../store/useErpStore';
import { toast } from '../../store/useToastStore';
import { matchesOrderQuery } from '../utils/orderSearch';
import { formatDateShort, daysLeft } from '../utils/time';
import { EXPERIMENTAL_PHASE_LABELS } from '../types';
import styles from '../erp.module.css';
import { ExperimentalCard } from './experimental/ExperimentalCard';
import { Button } from '../components/Button';

/**
 * Экспериментальный цех: разработка образцов.
 *
 * Экран переписан по образцу склада и заказов (правки заказчика 10.08,
 * волна 3.6): плитки-фильтры → таблица с сортировкой и пагинацией → Drawer
 * с карточкой разработки. Раньше это был вертикальный список раскрытых
 * карточек: при десятке образцов страница превращалась в простыню, а найти
 * «что сейчас на примерке» можно было только прокруткой.
 *
 * Сама модель уже другая: передача образца в цех — НАСТОЯЩИЙ этап в очереди
 * этого цеха (`origin='experimental'`, свой `cycle`). Экран показывает
 * разработку; работу цеха цех видит у себя, а не здесь.
 */

/** Фазы разработки: плитки, порядок в таблице */
const PHASES = [
  { key: 'patterns', label: 'Лекала', icon: 'scissors' },
  { key: 'development', label: 'Проработка', icon: 'flask' },
  { key: 'final_fitting', label: 'Примерка', icon: 'shirt' },
  { key: 'returned_to_constructor', label: 'Возврат конструктору', icon: 'undo' },
  { key: 'done', label: 'Готов к серии', icon: 'checkCircle' },
];

const PHASE_ORDER = Object.fromEntries(PHASES.map((p, i) => [p.key, i]));

/** Терминальная фаза: разработка закончена и в работе больше не участвует */
const TERMINAL_PHASE = 'done';

function phaseVariant(phase) {
  if (phase === 'done') return 'ready';
  if (phase === 'returned_to_constructor') return 'blocked';
  if (phase === 'patterns') return 'waiting';
  return 'progress';
}

/** Значение колонки для сортировки — ровно то, что видно в ячейке */
function expSortValue({ exp, order }, key) {
  switch (key) {
    case 'order': return order?.bitrix_id || order?.title || exp.order?.bitrix_id || '';
    case 'phase': return EXPERIMENTAL_PHASE_LABELS[exp.phase] ?? exp.phase;
    case 'tech': return exp.tech_name || '';
    case 'people': return exp.technologist || exp.constructor || '';
    case 'due': return order?.due_date || '';
    default: return null;
  }
}

export default function Experimental() {
  const {
    orders, loaded, loadError, loadAll,
    experimental, experimentalLoaded, loadExperimental,
    createExperimental, updateExperimental, createExperimentalOp, completeExperimentalOp,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      experimental: s.experimental,
      experimentalLoaded: s.experimentalLoaded,
      loadExperimental: s.loadExperimental,
      createExperimental: s.createExperimental,
      updateExperimental: s.updateExperimental,
      createExperimentalOp: s.createExperimentalOp,
      completeExperimentalOp: s.completeExperimentalOp,
    })),
  );

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [problemOnly, setProblemOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openId, setOpenId] = useState(null);
  const [newOrderId, setNewOrderId] = useState('');
  const { sort, toggle: toggleSort } = useTableSort();

  // Смена сортировки возвращает на первую страницу
  const sortBy = (key) => { toggleSort(key); setPage(1); };

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!experimentalLoaded) loadExperimental(); }, [experimentalLoaded, loadExperimental]);

  /** Заказы-образцы без разработки — для создания */
  const availableOrders = useMemo(() => {
    const withExp = new Set(experimental.map((e) => e.order_id));
    return orders.filter((o) => o.status === 'active' && !withExp.has(o.id));
  }, [orders, experimental]);

  /** Строка таблицы: разработка + её заказ (заказ нужен для срока и поиска) */
  const allRows = useMemo(() => experimental
    .map((exp) => ({ exp, order: orders.find((o) => o.id === exp.order_id) ?? null }))
    .sort((a, b) => (PHASE_ORDER[a.exp.phase] ?? 9) - (PHASE_ORDER[b.exp.phase] ?? 9)
      || (a.exp.created_at || '').localeCompare(b.exp.created_at || '')),
  [experimental, orders]);

  const counts = useMemo(() => {
    const c = { all: 0 };
    for (const p of PHASES) c[p.key] = 0;
    for (const row of allRows) {
      if (onlyOpen && row.exp.phase === TERMINAL_PHASE) continue;
      c.all += 1;
      if (c[row.exp.phase] !== undefined) c[row.exp.phase] += 1;
    }
    return c;
  }, [allRows, onlyOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    /**
     * Проблема разработки — возврат конструктору: примерка показала, что лекала
     * надо менять, и работа уходит назад. Других способов «застрять» у образца
     * нет — блокировки и брак живут на этапах, которые видит цех.
     */
    const hasProblem = (exp) => exp.phase === 'returned_to_constructor';
    /**
     * Просрочка считается по сроку ЗАКАЗА: своего срока у разработки нет,
     * а придумывать его значило бы завести вторую дату, за которой никто
     * не следит.
     */
    const isLate = ({ exp, order }) => {
      if (exp.phase === TERMINAL_PHASE || !order?.due_date) return false;
      const d = daysLeft(order.due_date);
      return d !== null && d < 0;
    };

    return allRows.filter((row) => {
      const { exp, order } = row;
      if (tab !== 'all' && exp.phase !== tab) return false;
      if (onlyOpen && exp.phase === TERMINAL_PHASE) return false;
      if (problemOnly && !hasProblem(exp)) return false;
      if (overdueOnly && !isLate(row)) return false;
      if (q) {
        const searchable = order ?? { title: exp.order?.title, bitrix_id: exp.order?.bitrix_id };
        if (!matchesOrderQuery(searchable, q) && !(exp.tech_name || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [allRows, tab, onlyOpen, problemOnly, overdueOnly, query]);

  // Сортировка до пагинации: иначе переупорядочилась бы только текущая страница
  const sorted = useMemo(() => sortRows(filtered, sort, expSortValue), [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Открытая разработка берётся свежей из стора: после действий она меняется
  const open = openId ? allRows.find((r) => r.exp.id === openId) ?? null : null;

  const lateRow = (row) => {
    if (row.exp.phase === TERMINAL_PHASE || !row.order?.due_date) return false;
    const d = daysLeft(row.order.due_date);
    return d !== null && d < 0;
  };

  /**
   * Гейт «Проработки» (волна 4.3): материал принят складом? Нет заказа или
   * материалов — свободно; иначе ждём задачу приёмки в статусе «accepted».
   */
  const materialReadyFor = (orderId) => {
    const o = orders.find((x) => x.id === orderId);
    if (!o || (o.materials?.length ?? 0) === 0) return true;
    const task = (o.warehouse_tasks ?? []).find((t) => t.task_type === 'material_receipt');
    return task ? task.status === 'accepted' : false;
  };

  /**
   * Позиция, на которую заводится этап образца: разработка привязана к заказу,
   * а этап — к позиции. У образца позиция, как правило, одна, и брать первую
   * честнее, чем спрашивать в форме то, где нет выбора.
   */
  const itemIdFor = (orderId) => orders.find((o) => o.id === orderId)?.items?.[0]?.id ?? null;

  const addExperimental = async () => {
    if (!newOrderId) { toast.error('Выберите заказ'); return; }
    const row = await createExperimental(newOrderId);
    if (row) { setNewOrderId(''); setOpenId(row.id); }
  };

  return (
    <>
      <PageHead
        title="Экспериментальный цех"
        sub="Разработка образцов: лекала → проработка → примерка → готов к серии. Работа образца в цехе видна в очереди самого цеха."
      />

      {experimentalLoaded && allRows.length > 0 && (
        <div className={styles.dashKpis} style={{ marginBottom: 16 }}>
          {[
            { key: 'all', icon: 'orders', cls: '', label: 'Все разработки', val: counts.all },
            ...PHASES.map((p) => ({
              key: p.key,
              icon: p.icon,
              cls: p.key === 'returned_to_constructor'
                ? styles.kpiIconDanger
                : (p.key === 'done' ? styles.kpiIconOk : ''),
              label: p.label,
              val: counts[p.key],
            })),
          ].map((k) => (
            // Плитка кликабельна целиком и фильтрует список — как на складе
            // и в закупке (правило DESIGN.md)
            <button
              key={k.key}
              type="button"
              className={styles.kpiCard}
              aria-pressed={tab === k.key}
              onClick={() => { setTab(tab === k.key ? 'all' : k.key); setPage(1); }}
            >
              <span className={`${styles.kpiIcon} ${k.cls}`}><Icon name={k.icon} size={20} /></span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>{k.label}</span>
                <span className={styles.kpiCardValue}>{k.val}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <FilterBar
        search={query}
        onSearch={(v) => { setQuery(v); setPage(1); }}
        searchPlaceholder="Поиск: заказ, № сделки, тех. название"
        searchLabel="Поиск в эксперим. цехе"
        right={(
          <>
            <select
              className={styles.select}
              value={newOrderId}
              onChange={(e) => setNewOrderId(e.target.value)}
              aria-label="Заказ для разработки"
            >
              <option value="">Заказ…</option>
              {availableOrders.map((o) => (
                <option key={o.id} value={o.id}>№{o.bitrix_id || '—'} · {o.title}</option>
              ))}
            </select>
            <Button variant="primary" onClick={addExperimental}>+ Разработка</Button>
          </>
        )}
      >
        <button
          type="button"
          aria-pressed={onlyOpen}
          className={`${styles.chip} ${styles.chipBtn} ${onlyOpen ? styles.chipProgress : styles.chipNeutral}`}
          onClick={() => { setOnlyOpen(!onlyOpen); setPage(1); }}
        >
          В работе
        </button>
        <button
          type="button"
          aria-pressed={overdueOnly}
          className={`${styles.chip} ${styles.chipBtn} ${overdueOnly ? styles.chipProgress : styles.chipNeutral}`}
          title="Срок заказа прошёл, а разработка не закончена"
          onClick={() => { setOverdueOnly(!overdueOnly); setPage(1); }}
        >
          <Icon name="clock" size={13} /> Просрочено
        </button>
        <button
          type="button"
          aria-pressed={problemOnly}
          className={`${styles.chip} ${styles.chipBtn} ${problemOnly ? styles.chipProgress : styles.chipNeutral}`}
          title="Примерка вернула работу конструктору"
          onClick={() => { setProblemOnly(!problemOnly); setPage(1); }}
        >
          <Icon name="ban" size={13} /> С проблемой
        </button>
      </FilterBar>

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="эксперим. разработки" />}
      {!experimentalLoaded && !loadError && <TableSkeleton rows={5} label="Загрузка разработок" />}

      {experimentalLoaded && allRows.length === 0 && (
        <EmptyState
          icon="flask"
          title="Разработок пока нет"
          text="Выберите заказ-образец в панели выше и заведите разработку."
        />
      )}

      {experimentalLoaded && allRows.length > 0 && filtered.length === 0 && (
        <EmptyResult onReset={() => {
          setQuery(''); setTab('all'); setProblemOnly(false); setOverdueOnly(false); setOnlyOpen(true);
        }}
        >
          Под фильтры ничего не подошло. Всего разработок: {allRows.length}.
        </EmptyResult>
      )}

      {experimentalLoaded && filtered.length > 0 && (
        <>
          <ScrollHintBox className={styles.tableWrap} label="Разработки образцов">
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableTh sortKey="order" sort={sort} onSort={sortBy}>Заказ</SortableTh>
                  <SortableTh sortKey="tech" sort={sort} onSort={sortBy}>Тех. название</SortableTh>
                  <SortableTh sortKey="phase" sort={sort} onSort={sortBy}>Фаза</SortableTh>
                  <SortableTh sortKey="people" sort={sort} onSort={sortBy}>Кто ведёт</SortableTh>
                  <SortableTh sortKey="due" sort={sort} onSort={sortBy}>Срок заказа</SortableTh>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const { exp, order } = row;
                  return (
                    <tr
                      key={exp.id}
                      className={styles.rowClickable}
                      onClick={() => setOpenId(exp.id)}
                    >
                      <td>
                        №{order?.bitrix_id || exp.order?.bitrix_id || '—'}
                        <div className={styles.cellSub} title={order?.title || exp.order?.title || ''}>
                          {order?.title || exp.order?.title || '—'}
                        </div>
                      </td>
                      <td>{exp.tech_name || <span className={styles.subText}>не задано</span>}</td>
                      <td>
                        <Badge variant={phaseVariant(exp.phase)}>
                          {EXPERIMENTAL_PHASE_LABELS[exp.phase] ?? exp.phase}
                        </Badge>
                      </td>
                      <td>
                        {exp.technologist || exp.constructor
                          || <span className={styles.subText}>не назначен</span>}
                      </td>
                      <td className={lateRow(row) ? styles.overdue : undefined}>
                        {order?.due_date ? formatDateShort(order.due_date) : '—'}
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={(e) => { e.stopPropagation(); setOpenId(exp.id); }}
                        >
                          Открыть
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollHintBox>
          <Pagination
            page={safePage}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}

      {open && (
        <Drawer
          onClose={() => setOpenId(null)}
          title={open.exp.tech_name || 'Разработка образца'}
          subtitle={`№${open.order?.bitrix_id || open.exp.order?.bitrix_id || '—'} · ${open.order?.title || open.exp.order?.title || ''}`}
          badge={(
            <Badge variant={phaseVariant(open.exp.phase)}>
              {EXPERIMENTAL_PHASE_LABELS[open.exp.phase] ?? open.exp.phase}
            </Badge>
          )}
        >
          <ExperimentalCard
            exp={open.exp}
            materialReady={materialReadyFor(open.exp.order_id)}
            itemId={itemIdFor(open.exp.order_id)}
            onUpdate={updateExperimental}
            onCreateOp={createExperimentalOp}
            onCompleteOp={completeExperimentalOp}
          />
        </Drawer>
      )}
    </>
  );
}
