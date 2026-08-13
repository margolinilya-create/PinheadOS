import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { FilterBar } from '../components/FilterBar';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Drawer';
import { Pagination, DEFAULT_PAGE_SIZE } from '../components/Pagination';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { DateField } from '../components/DateField';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { useFormGate } from '../components/useFormGate';
import { FieldError } from '../components/FormGate';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { useDictionary } from '../store/useDictionary';
import {
  DEV_STATE_LABELS,
  EMPTY_DEV_FILTERS,
  DEV_SORT_LABELS,
  applyDevFilters,
  buildDevRows,
  devFiltersFromParams,
  devFiltersToParams,
  hasActiveDevFilters,
} from '../utils/filterExperimental';
import {
  currentBlocker, devReadiness, nextAction, taskLabel,
} from '../utils/experimentalTasks';
import { DEV_OUTCOME_LABELS } from '../types';
import { formatDateShort } from '../utils/time';
import { factoryToday } from '../../utils/date';
import { DevCard } from './experimental/DevCard';
import styles from '../erp.module.css';

/**
 * Экспериментальный цех — разработка изделий (ТЗ заказчика 12.08).
 *
 * Экран отвечает на вопрос «что сейчас происходит с каждой разработкой и что
 * конкретно нужно сделать дальше», а не «на какой фазе заказ». Поэтому в строке
 * стоят ГОТОВНОСТЬ и ТЕКУЩИЙ БЛОКЕР — руководитель видит, почему изделие стоит,
 * не открывая карточку (ТЗ п.12, п.16).
 *
 * Верхние вкладки — ВЫЧИСЛЯЕМЫЕ состояния (`devState`), а не хранимые статусы:
 * прежние пять фаз были линейной цепочкой, от которой заказчик отказался.
 * Хранится только ИСХОД закрытой разработки.
 */

/** Плитки-состояния в порядке срочности: сначала то, где нужно вмешаться */
const STATE_TILES = [
  { key: '', icon: 'orders', label: 'Все разработки', cls: '' },
  { key: 'new', icon: 'plus', label: DEV_STATE_LABELS.new, cls: '' },
  { key: 'in_progress', icon: 'flask', label: DEV_STATE_LABELS.in_progress, cls: '' },
  { key: 'attention', icon: 'alert', label: DEV_STATE_LABELS.attention, cls: 'kpiIconDanger' },
  { key: 'fitting', icon: 'shirt', label: DEV_STATE_LABELS.fitting, cls: '' },
  { key: 'ready', icon: 'checkCircle', label: DEV_STATE_LABELS.ready, cls: 'kpiIconOk' },
];

const STATE_VARIANT = {
  new: 'neutral', in_progress: 'progress', attention: 'blocked',
  fitting: 'waiting', ready: 'ready',
};

export default function Experimental() {
  const {
    orders, departments, loaded, loadError, loadAll,
    experimental, experimentalLoaded, loadExperimental,
    createExperimental, updateExperimental,
    addDevTasks, updateDevTask, sendDevTaskToDept, closeExperimental,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      experimental: s.experimental,
      experimentalLoaded: s.experimentalLoaded,
      loadExperimental: s.loadExperimental,
      createExperimental: s.createExperimental,
      updateExperimental: s.updateExperimental,
      addDevTasks: s.addDevTasks,
      updateDevTask: s.updateDevTask,
      sendDevTaskToDept: s.sendDevTaskToDept,
      closeExperimental: s.closeExperimental,
    })),
  );

  /**
   * Разработку ведёт технолог — под правом `experimental.manage`. Гейт стоит
   * и на сервере; без права экран остаётся на ЧТЕНИЕ: видеть, что делается
   * с образцом, полезно и цеху, и менеджеру заказа.
   */
  const canManage = useErpAccess().can('experimental.manage');
  const typeDict = useDictionary('experimental_task_type');
  const typeNames = useMemo(
    () => new Map((typeDict ?? []).map((d) => [d.code, d.name])), [typeDict]);

  // Контекст списка живёт в адресе: возврат из карточки восстанавливает подбор,
  // а ссылкой на отфильтрованный список можно поделиться
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => devFiltersFromParams(params), [params]);
  const openId = params.get('dev');

  const setFilters = useCallback((next) => {
    setParams((prev) => {
      const out = new URLSearchParams(devFiltersToParams(next));
      const dev = prev.get('dev');
      if (dev) out.set('dev', dev);
      return out;
    });
  }, [setParams]);

  const openDev = useCallback((id) => {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (id) out.set('dev', id); else out.delete('dev');
      return out;
    });
  }, [setParams]);

  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [newOrderId, setNewOrderId] = useState('');

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => {
    if (!experimentalLoaded) loadExperimental();
  }, [experimentalLoaded, loadExperimental]);

  const today = factoryToday();
  const rows = useMemo(() => buildDevRows(experimental, today), [experimental, today]);

  const counts = useMemo(() => {
    const c = { '': rows.length, new: 0, in_progress: 0, attention: 0, fitting: 0, ready: 0 };
    for (const r of rows) c[r.state] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => applyDevFilters(rows, filters), [rows, filters]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Открытая разработка берётся свежей из стора: после действий она меняется
  const open = openId ? rows.find((r) => r.dev.id === openId) ?? null : null;
  const openOrder = open ? orders.find((o) => o.id === open.dev.order_id) ?? null : null;

  /**
   * Позиции-образцы без разработки. Показываем СПИСОК, а не заводим их пачкой:
   * массовое создание дало бы полсотни пустых разработок, то есть мусор.
   */
  const availableItems = useMemo(() => {
    const taken = new Set(experimental.map((e) => e.item_id).filter(Boolean));
    const out = [];
    for (const o of orders) {
      if (o.status !== 'active') continue;
      for (const it of o.items ?? []) {
        if (it.production_type !== 'samples' || taken.has(it.id)) continue;
        out.push({ order: o, item: it });
      }
    }
    return out;
  }, [orders, experimental]);

  /**
   * Ошибка показывается НА ПОЛЕ, а не тостом в углу экрана (H-16 отчёта QA
   * 13.08.2026): тост уезжает от того самого селекта, о котором говорит.
   */
  const devGate = useFormGate([
    { key: 'newOrderId', label: 'Позиция-образец', ok: Boolean(newOrderId), message: 'Выберите позицию-образец' },
  ]);

  const addDev = async () => {
    const found = availableItems.find(({ item }) => item.id === newOrderId);
    if (!found) return;
    const row = await createExperimental(found.order.id, {
      item_id: found.item.id,
      tech_name: found.item.variant
        ? `${found.item.product_type} · ${found.item.variant}`
        : found.item.product_type,
    });
    if (row) { setNewOrderId(''); devGate.reset(); openDev(row.id); }
  };

  const set = (patch) => { setFilters({ ...filters, ...patch }); setPage(1); };

  return (
    <>
      <PageHead
        title="Экспериментальный цех"
        sub="Разработка изделия: набор нужных задач, параллельная работа, циклы доработки и финальное решение. Работа образца в цехе видна в очереди самого цеха."
      />

      {experimentalLoaded && rows.length > 0 && (
        <div className={styles.dashKpis} style={{ marginBottom: 16 }}>
          {STATE_TILES.map((t) => (
            <button
              key={t.key || 'all'}
              type="button"
              className={styles.kpiCard}
              aria-pressed={filters.state === t.key}
              onClick={() => set({ state: filters.state === t.key ? '' : t.key })}
            >
              <span className={`${styles.kpiIcon} ${t.cls ? styles[t.cls] : ''}`}>
                <Icon name={t.icon} size={20} />
              </span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiCardLabel}>{t.label}</span>
                <span className={styles.kpiCardValue}>{counts[t.key]}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <FilterBar
        search={filters.q}
        onSearch={(v) => set({ q: v })}
        searchPlaceholder="Поиск: изделие, заказ, № сделки"
        searchLabel="Поиск по разработкам"
        right={canManage && (
          <div className={styles.field}>
            <div className={styles.formActions}>
              <select
                className={devGate.cls(styles.select, 'newOrderId')}
                value={newOrderId}
                onChange={(e) => setNewOrderId(e.target.value)}
                aria-label="Позиция-образец для разработки"
                {...devGate.field('newOrderId')}
              >
                <option value="">Позиция-образец…</option>
                {availableItems.map(({ order, item }) => (
                  <option key={item.id} value={item.id}>
                    №{order.bitrix_id || '—'} · {item.product_type}
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={devGate.guard(addDev)}>+ Разработка</Button>
            </div>
            <FieldError id={devGate.errId('newOrderId')} text={devGate.error('newOrderId')} />
          </div>
        )}
      >
        <button
          type="button"
          aria-pressed={filters.problem}
          title="Есть заблокированная задача"
          className={`${styles.chip} ${styles.chipBtn} ${filters.problem ? styles.chipProgress : styles.chipNeutral}`}
          onClick={() => set({ problem: !filters.problem })}
        >
          <Icon name="ban" size={13} /> С проблемой
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          className={`${styles.chip} ${styles.chipBtn} ${expanded ? styles.chipProgress : styles.chipNeutral}`}
          onClick={() => setExpanded((v) => !v)}
        >
          Фильтры <Icon name="chevronDown" size={13} className={expanded ? styles.chevronUp : undefined} />
        </button>
        {hasActiveDevFilters(filters) && (
          <Button variant="ghost" onClick={() => setFilters({ ...EMPTY_DEV_FILTERS })}>
            Сбросить
          </Button>
        )}
      </FilterBar>

      {expanded && (
        <div className={styles.filterPanel}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Конструктор</span>
            <input
              className={styles.input}
              value={filters.constructorName}
              onChange={(e) => set({ constructorName: e.target.value })}
              aria-label="Фильтр по конструктору"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Проработчик</span>
            <input
              className={styles.input}
              value={filters.developer}
              onChange={(e) => set({ developer: e.target.value })}
              aria-label="Фильтр по проработчику"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип разработки</span>
            <input
              className={styles.input}
              value={filters.devType}
              onChange={(e) => set({ devType: e.target.value })}
              aria-label="Фильтр по типу разработки"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок с</span>
            <DateField
              value={filters.dueFrom}
              onChange={(v) => set({ dueFrom: v })}
              aria-label="Срок разработки с"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок по</span>
            <DateField
              value={filters.dueTo}
              onChange={(v) => set({ dueTo: v })}
              aria-label="Срок разработки по"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Сортировка</span>
            <select
              className={styles.select}
              value={filters.sort}
              onChange={(e) => set({ sort: e.target.value })}
              aria-label="Сортировка разработок"
            >
              {Object.entries(DEV_SORT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/*
        Позиции-образцы без разработки. Раньше о них было не узнать: авто-создание
        при заведении заказа падало 42501 молча (у менеджера нет `experimental.manage`),
        и заказ-образец оставался без разработки — 15 из 21 на боевой базе.
        Право расширено, но старые позиции сами не появятся; массово заводить их
        нельзя — вышли бы пустые карточки, то есть мусор.
      */}
      {experimentalLoaded && canManage && availableItems.length > 0 && (
        <div className={styles.toolbar} style={{ marginTop: -8 }}>
          <span className={`${styles.chip} ${styles.chipWaiting}`}>
            <Icon name="alert" size={13} />
            {' '}
            Позиций-образцов без разработки: {availableItems.length}
          </span>
          <span className={styles.subText}>
            Выберите в списке справа те, которые ещё актуальны.
          </span>
        </div>
      )}

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="разработки" />}
      {!experimentalLoaded && !loadError && <TableSkeleton rows={5} label="Загрузка разработок" />}

      {experimentalLoaded && rows.length === 0 && (
        <EmptyState
          icon="flask"
          title="Разработок пока нет"
          text="Выберите позицию-образец в панели выше и заведите разработку. Набор задач выбирается под изделие — одинаковых пяти этапов больше нет."
        />
      )}

      {experimentalLoaded && rows.length > 0 && visible.length === 0 && (
        <EmptyResult onReset={() => setFilters({ ...EMPTY_DEV_FILTERS })}>
          Под фильтры ничего не подошло. Всего разработок: {rows.length}.
        </EmptyResult>
      )}

      {experimentalLoaded && visible.length > 0 && (
        <>
          <ScrollHintBox className={styles.tableWrap} label="Разработки">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Изделие</th>
                  <th>Кто ведёт</th>
                  <th>Готовность</th>
                  <th>Текущий блокер</th>
                  <th>Срок</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ dev, tasks, state }) => {
                  const readiness = devReadiness(tasks);
                  const blocker = currentBlocker(tasks, typeNames, today);
                  const due = dev.due_date || dev.order?.due_date || null;
                  return (
                    <tr
                      key={dev.id}
                      className={styles.rowClickable}
                      onClick={() => openDev(dev.id)}
                    >
                      <td>
                        <strong>{dev.tech_name || 'Без названия'}</strong>
                        <div className={styles.cellSub}>
                          №{dev.order?.bitrix_id || '—'} · {dev.order?.title || ''}
                        </div>
                      </td>
                      <td>
                        {dev.technologist || dev.constructor
                          || <span className={styles.subText}>не назначен</span>}
                      </td>
                      <td>
                        {/* Ноль задач — «—», а не «0 %»: это «неизвестно», а не «готово» */}
                        {readiness.total > 0
                          ? `${readiness.done} / ${readiness.total}`
                          : <span className={styles.subText}>—</span>}
                      </td>
                      <td>
                        {dev.outcome
                          ? <span className={styles.subText}>{DEV_OUTCOME_LABELS[dev.outcome]}</span>
                          : (blocker
                            ? <>
                              {taskLabel(blocker, typeNames)}
                              <div className={styles.subText}>
                                {nextAction(dev, tasks, typeNames, today)}
                              </div>
                            </>
                            : <span className={styles.subText}>нет</span>)}
                      </td>
                      <td className={state === 'attention' ? styles.overdue : undefined}>
                        {due ? formatDateShort(due) : '—'}
                      </td>
                      <td>
                        <Badge variant={STATE_VARIANT[state]}>{DEV_STATE_LABELS[state]}</Badge>
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
            total={visible.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}

      {open && (
        <Drawer
          onClose={() => openDev(null)}
          title={open.dev.tech_name || 'Разработка'}
          subtitle={`№${open.dev.order?.bitrix_id || '—'} · ${open.dev.order?.title || ''}`}
          badge={<Badge variant={STATE_VARIANT[open.state]}>{DEV_STATE_LABELS[open.state]}</Badge>}
        >
          <DevCard
            dev={open.dev}
            order={openOrder}
            departments={departments}
            canManage={canManage}
            onUpdate={updateExperimental}
            onAddTasks={(rows_) => addDevTasks(open.dev.id, rows_)}
            onUpdateTask={updateDevTask}
            onSendTask={sendDevTaskToDept}
            onClose={closeExperimental}
          />
        </Drawer>
      )}
    </>
  );
}
