import { useEffect, useMemo, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { Button } from '../../components/Button';
import { EmptyResult, EmptyState, LoadFailed } from '../../components/ErpStates';
import { isBizTaskStaff } from '../../utils/bizTasks';
import { BizTaskList } from '../bizTasks/BizTaskList';
import { BizTaskCreateForm } from '../bizTasks/BizTaskCreateForm';
import { byDue, matchesOrderFilter, orderTaskCounts } from '../bizTasks/bizTaskView';
import { useOrderTaskRows } from './useOrderBizTasks';
import styles from './OrderBizTasksTab.module.css';

/** Фильтры вкладки; у открытых, просроченных и завершённых — счётчик (спека, «Список задач») */
const FILTERS = [
  { id: 'open', label: 'Открытые', count: 'open' },
  { id: 'overdue', label: 'Просроченные', count: 'overdue' },
  { id: 'done', label: 'Завершённые', count: 'done' },
  { id: 'cancelled', label: 'Отменённые' },
  { id: 'all', label: 'Все' },
];

const isClosedOrder = (status) => status === 'cancelled' || String(status ?? '').startsWith('done');

/**
 * ВКЛАДКА «БИЗНЕС-ЗАДАЧИ» КАРТОЧКИ ЗАКАЗА (правки 19.10, п. 7) — ленивый чанк.
 *
 * Строки грузит карточка (`useOrderBizTasks`: число открытых стоит в подписи
 * вкладки), здесь — счётчики, фильтр, список и форма создания с подставленным
 * заказом. По умолчанию — открытые; завершённые и отменённые — фильтром.
 * Фильтры — переключатели вида (`aria-pressed`), а не вкладки: панелей у них нет.
 *
 * «Создать задачу» — блок по условию с причиной (`aria-disabled`), а не
 * пропажа кнопки: у закрытого заказа и у не-сотрудника ERP писатель
 * `erp_biz_task_create` откажет, и человек должен знать почему.
 */
export default function OrderBizTasksTab({ order, loaded, failed, onRetry }) {
  const tasks = useOrderTaskRows(order.id);
  const unread = useErpStore((s) => s.bizTaskUnread);
  const directory = useErpStore((s) => s.chatDirectory);
  const loadChatDirectory = useErpStore((s) => s.loadChatDirectory);
  const myRole = useErpStore((s) => s.myRole);
  const user = useAuthStore((s) => s.user);
  useEffect(() => { void loadChatDirectory(); }, [loadChatDirectory]);

  const [filter, setFilter] = useState('open');
  const [creating, setCreating] = useState(false);
  const [focusId, setFocusId] = useState(null);

  // «Сейчас» для просрочки — на рендер: минута опоздания пересчитается со звонком
  const now = new Date();
  const counts = orderTaskCounts(tasks, now);
  const shown = tasks.filter((t) => matchesOrderFilter(t, filter, now)).sort(byDue);
  const names = useMemo(() => new Map((directory ?? []).map((p) => [p.user_id, p.name])), [directory]);

  const staff = user?.id === 'dev' || isBizTaskStaff(user?.role, myRole);
  const createReason = isClosedOrder(order.status)
    ? 'Заказ закрыт — новые задачи к нему не ставятся'
    : !staff ? 'Задачи ставят сотрудники ERP' : '';
  const createButton = (
    <Button variant="primary" icon="plus" ariaDisabledReason={createReason} onClick={() => setCreating(true)}>
      Создать задачу
    </Button>
  );

  const onCreated = (row) => {
    setCreating(false);
    // Новая задача — «Новая», то есть открытая: показываем её, где бы ни стоял фильтр
    if (!matchesOrderFilter(row, filter, new Date())) setFilter('open');
    setFocusId(row.id);
  };

  const form = creating && (
    <BizTaskCreateForm
      order={{ id: order.id, label: `${order.bitrix_id ? `№${order.bitrix_id} · ` : ''}${order.title}` }}
      onCreated={onCreated}
      onCancel={() => setCreating(false)}
    />
  );

  if (failed && !loaded) return <LoadFailed onRetry={onRetry} what="задачи заказа" />;
  if (!loaded) return <div className={styles.loading} role="status">Загружаем задачи…</div>;

  if (tasks.length === 0) {
    return form || (
      <EmptyState
        icon="inbox"
        text="По заказу нет задач. Поручите доставку, закупку или другое дело."
        action={createButton}
      />
    );
  }

  return (
    <section className={styles.tab} aria-label="Бизнес-задачи заказа">
      <div className={styles.bar}>
        <div className={styles.filters} role="group" aria-label="Какие задачи показать">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={styles.filter}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}{f.count && ' '}
              {f.count && <span className={styles.count}>{counts[f.count]}</span>}
            </button>
          ))}
        </div>
        {!creating && createButton}
      </div>
      {form}
      {shown.length > 0 ? (
        <BizTaskList tasks={shown} names={names} unread={unread} now={now} focusId={focusId} />
      ) : (
        <EmptyResult icon="filter" onReset={() => setFilter('all')} resetLabel="Показать все">
          Под фильтр ничего не попало.
        </EmptyResult>
      )}
    </section>
  );
}
