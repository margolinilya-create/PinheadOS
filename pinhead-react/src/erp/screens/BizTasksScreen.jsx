import { useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';
import { PageHead } from '../components/PageHead';
import { FilterBar } from '../components/FilterBar';
import { Tabs, TabPanel } from '../components/Tabs';
import { Button } from '../components/Button';
import { EmptyResult, EmptyState, LoadFailed } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { useListParams } from '../hooks/useListParams';
import { useListScroll } from '../hooks/useListScroll';
import {
  BIZ_TASK_KINDS, BIZ_TASK_KIND_LABELS, BIZ_TASK_STATUSES, BIZ_TASK_STATUS_LABELS, isBizTaskStaff,
} from '../utils/bizTasks';
import { BizTaskList } from './bizTasks/BizTaskList';
import BizTaskPage from './BizTaskPage';
import { BizTaskCreateForm } from './bizTasks/BizTaskCreateForm';
import { byDue, hasRole, matchesListFilters, orderLabel } from './bizTasks/bizTaskView';
import styles from './bizTasks/BizTasksScreen.module.css';

/** Умолчания адреса: значение, равное умолчанию, из адреса убирается (`useListParams`) */
const DEFAULTS = { tab: 'assignee', status: 'active' };
const FILTER_KEYS = ['q', 'kind', 'who', 'status', 'due', 'unread'];
const NO_FILTERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, '']));

const TABS = [
  { id: 'assignee', label: 'Мне' },
  { id: 'creator', label: 'Поставленные мной' },
  { id: 'watcher', label: 'Наблюдаю' },
];

/** Пусто по существу — у каждой вкладки своё объяснение */
const EMPTY_TEXT = {
  assignee: 'Вам ничего не поручено. Задачи, где вы ответственный, появятся здесь.',
  creator: 'Активных задач, поставленных вами, нет.',
  watcher: 'Вы не наблюдаете ни за одной активной задачей.',
};

const DUE_OPTIONS = [
  ['', 'Любой'],
  ['overdue', 'Просроченные'],
  ['day', 'Ближайшие сутки'],
  ['week', 'Ближайшая неделя'],
];

const isClosedOrder = (status) => status === 'cancelled' || String(status ?? '').startsWith('done');

/** Выбор в панели фильтров: подпись связана с полем (`htmlFor`), а не обёрткой — в имя не попадут варианты */
function FilterSelect({ label, value, onChange, children }) {
  const id = useId();
  return (
    <span className={styles.select}>
      <label htmlFor={id} className={styles.selectLabel}>{label}</label>
      <select id={id} className={styles.control} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </span>
  );
}

/**
 * Строки вкладки: грузим по роли (`loadBizTasks`), показываем из стора —
 * одна строка на id, её же правят карточка и realtime. Перечитывание —
 * на смену вкладки и на звонок `bizTaskPing`; сбой перечитывания не стирает
 * уже показанное.
 */
function useTabRows(tab) {
  const load = useErpStore((s) => s.loadBizTasks);
  const ping = useErpStore((s) => s.bizTaskPing);
  const [state, setState] = useState({ tab: null, loaded: false, failed: false, attempt: 0 });

  useEffect(() => {
    if (!load) return undefined;
    let alive = true;
    load({ scope: tab }).then((rows) => {
      if (!alive) return;
      setState((prev) => {
        const was = prev.tab === tab && prev.loaded;
        return rows ? { ...prev, tab, loaded: true, failed: false } : { ...prev, tab, loaded: was, failed: !was };
      });
    });
    return () => { alive = false; };
  }, [load, tab, ping, state.attempt]);

  const mine = state.tab === tab;
  const retry = () => setState((prev) => ({ ...prev, attempt: prev.attempt + 1 }));
  return { loaded: mine && state.loaded, failed: mine && state.failed, retry };
}

/**
 * ОБЩИЙ РАЗДЕЛ «БИЗНЕС-ЗАДАЧИ» (правки 19.10, п. 7, «Список задач»).
 *
 * Вкладки — роль в задаче: «Мне» (по умолчанию, активные, где я ответственный),
 * «Поставленные мной», «Наблюдаю». В строке сверх вкладки заказа — заказ и
 * постановщик. Поиск по названию и номеру заказа; фильтры тип / ответственный /
 * статус / срок / «есть непрочитанные» — В АДРЕСЕ: карточка задачи и «назад»
 * их не сбрасывают, ссылку можно переслать. Положение прокрутки возвращает
 * `useListScroll`.
 *
 * Создание — с выбором заказа (только открытые заказы). Задача, которую я
 * поставил, всегда есть в «Поставленные мной»: не попала под текущий вид —
 * переключаемся туда без фильтров и ставим фокус на новую строку.
 */
function BizTasksList() {
  const { get, patch } = useListParams(DEFAULTS);
  const tab = TABS.some((t) => t.id === get('tab')) ? get('tab') : DEFAULTS.tab;
  const filters = {
    q: get('q'), kind: get('kind'), who: get('who'), status: get('status'),
    due: get('due'), unread: get('unread') === '1',
  };
  const filtered = FILTER_KEYS.some((k) => get(k) !== (DEFAULTS[k] ?? ''));

  const all = useErpStore((s) => s.bizTasks);
  const unread = useErpStore((s) => s.bizTaskUnread);
  const directory = useErpStore((s) => s.chatDirectory);
  const loadChatDirectory = useErpStore((s) => s.loadChatDirectory);
  const orders = useErpStore((s) => s.orders);
  const myRole = useErpStore((s) => s.myRole);
  const user = useAuthStore((s) => s.user);
  const me = user?.id ?? '';
  useEffect(() => { void loadChatDirectory(); }, [loadChatDirectory]);

  const { loaded, failed, retry } = useTabRows(tab);
  useListScroll(`biz-tasks:${tab}`, loaded);
  const [creating, setCreating] = useState(false);
  const [focusId, setFocusId] = useState(null);

  const names = useMemo(() => new Map((directory ?? []).map((p) => [p.user_id, p.name])), [directory]);
  const tabRows = useMemo(
    () => Object.values(all ?? {}).filter((t) => hasRole(t, tab, me)),
    [all, tab, me],
  );
  // «Сейчас» для просрочки — на рендер: минута опоздания пересчитается со звонком
  const now = new Date();
  const shown = tabRows.filter((t) => matchesListFilters(t, filters, now, unread ?? {})).sort(byDue);
  /** Ответственные — те, кто есть во вкладке: пустой выбор из всего завода бесполезен */
  const assignees = useMemo(() => [...new Set(tabRows.map((t) => t.assignee_id))]
    .map((id) => [id, names.get(id) ?? '—'])
    .sort((a, b) => a[1].localeCompare(b[1], 'ru')), [tabRows, names]);
  const orderOptions = useMemo(() => (orders ?? [])
    .filter((o) => !isClosedOrder(o.status))
    .map((o) => ({ id: o.id, label: orderLabel(o) })), [orders]);

  const staff = user?.id === 'dev' || isBizTaskStaff(user?.role, myRole);
  const createReason = staff ? '' : 'Задачи ставят сотрудники ERP';

  const onCreated = (row) => {
    setCreating(false);
    if (!hasRole(row, tab, me) || !matchesListFilters(row, filters, new Date(), unread ?? {})) {
      patch({ ...NO_FILTERS, tab: 'creator' });
    }
    setFocusId(row.id);
  };

  const body = () => {
    if (failed && !loaded) return <LoadFailed onRetry={retry} what="задачи" />;
    if (!loaded) return <TableSkeleton rows={5} label="Загружаем задачи" />;
    if (shown.length > 0) {
      return <BizTaskList tasks={shown} names={names} unread={unread} now={now} showOrder focusId={focusId} />;
    }
    if (!filtered) return <EmptyState icon="inbox" text={EMPTY_TEXT[tab]} />;
    return (
      <EmptyResult icon="filter" onReset={() => patch(NO_FILTERS)} resetLabel="Сбросить фильтры">
        Ничего не нашлось
      </EmptyResult>
    );
  };

  return (
    <div className={styles.screen}>
      <PageHead title="Бизнес-задачи" sub="Поручения по заказам: доставка, закупка и другие дела" />
      <div className={styles.bar}>
        <Tabs
          idPrefix="biz-tasks"
          label="Мои задачи"
          tabs={TABS}
          active={tab}
          onSelect={(id) => patch({ tab: id })}
        />
        {!creating && (
          <Button variant="primary" icon="plus" ariaDisabledReason={createReason} onClick={() => setCreating(true)}>
            Создать задачу
          </Button>
        )}
      </div>
      {creating && (
        <BizTaskCreateForm orders={orderOptions} onCreated={onCreated} onCancel={() => setCreating(false)} />
      )}
      <TabPanel idPrefix="biz-tasks" active={tab} className={styles.panel}>
        <FilterBar
          search={filters.q}
          onSearch={(q) => patch({ q })}
          searchLabel="Поиск по названию задачи и номеру заказа"
          searchPlaceholder="Название или PH-…"
        >
          <FilterSelect label="Тип" value={filters.kind} onChange={(kind) => patch({ kind })}>
            <option value="">Любой</option>
            {BIZ_TASK_KINDS.map((k) => <option key={k} value={k}>{BIZ_TASK_KIND_LABELS[k]}</option>)}
          </FilterSelect>
          <FilterSelect label="Ответственный" value={filters.who} onChange={(who) => patch({ who })}>
            <option value="">Любой</option>
            {assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </FilterSelect>
          <FilterSelect label="Статус" value={filters.status} onChange={(status) => patch({ status })}>
            <option value="active">Активные</option>
            <option value="all">Все</option>
            {BIZ_TASK_STATUSES.map((s) => <option key={s} value={s}>{BIZ_TASK_STATUS_LABELS[s]}</option>)}
          </FilterSelect>
          <FilterSelect label="Срок" value={filters.due} onChange={(due) => patch({ due })}>
            {DUE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </FilterSelect>
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={filters.unread}
            onClick={() => patch({ unread: filters.unread ? '' : '1' })}
          >
            Есть непрочитанные
          </button>
        </FilterBar>
        {body()}
      </TabPanel>
    </div>
  );
}

/**
 * Вход маршрута на оба адреса — `/biz-tasks` и `/biz-tasks/:taskId` (один
 * ленивый чанк, см. `ErpApp`). Задача A→B — свежий инстанс страницы по ключу,
 * без мигания прошлой задачи; уход в задачу размонтирует список, и его
 * прокрутка запоминается.
 */
export default function BizTasksScreen() {
  const { taskId } = useParams();
  return taskId ? <BizTaskPage key={taskId} /> : <BizTasksList />;
}
