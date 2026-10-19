import { Suspense, lazy, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { useAuthStore } from '../../../store/useAuthStore';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { PageHead } from '../../components/PageHead';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { Tabs, TabPanel } from '../../components/Tabs';
import {
  BIZ_TASK_KIND_LABELS, BIZ_TASK_STATUS_LABELS, bizTaskActions, bizTaskRolesOf,
  canManageBizTasks, isBizTaskStaff, isOverdue,
} from '../../utils/bizTasks';
import { formatDue } from '../../../utils/date';
import { STATUS_VARIANT, orderLabel } from './bizTaskView';
import { formatMoment } from './bizTaskCardView';
import { BizTaskActions } from './BizTaskActions';
import { BizTaskChecklist } from './BizTaskChecklist';
import { BizTaskHistory } from './BizTaskHistory';
import { BizTaskFiles } from './BizTaskFiles';
import styles from './BizTaskCard.module.css';

/**
 * Диалог — ленивым чанком. Статический импорт `ChatPanel` в чанк раздела
 * задач сливал `MentionPicker` с чанком ленты (у них совпадал набор
 * импортёров) и переписывал карту предзагрузки оболочки ERP — строгая база
 * `bundle:budget` сдвигалась без единой правки ERP-оболочки.
 */
const ChatPanel = lazy(() => import('../../components/chat/ChatPanel').then((m) => ({ default: m.ChatPanel })));

/** Узкий экран — один ряд вкладок вместо двух колонок */
const NARROW = '(max-width: 760px)';

const PANES = [
  { id: 'task', label: 'Задача' },
  { id: 'chat', label: 'Обсуждение' },
  { id: 'history', label: 'История' },
  { id: 'files', label: 'Файлы' },
];

const NO_DETAIL = { watchers: null, checklist: [], events: [], files: [] };

/** Строка «подпись — значение»; пустое значение не показываем вовсе */
function Fact({ label, children }) {
  if (!children) return null;
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * КАРТОЧКА БИЗНЕС-ЗАДАЧИ (правки 19.10, п. 7, «Референс карточки задачи»).
 *
 * Слева — ссылка на заказ, название, статус и «Просрочена» (бейдж РЯДОМ
 * со статусом, иконка + текст), ответственный, срок, постановщик,
 * наблюдатели, описание, чек-лист, «Результат» и кнопки по `bizTaskActions`;
 * справа — диалог задачи (`ChatPanel` с `taskId`). На компьютере «История»
 * и «Файлы» — под левой колонкой; на ≤ 760 px — один ряд вкладок
 * «Задача · Обсуждение · История · Файлы», вкладка — в адресе (`?pane=`):
 * ссылка «К сообщению» из «Файлов» открывает обсуждение на нужном сообщении.
 *
 * ОТКРЫТИЕ НЕ НАЧИНАЕТ РАБОТУ: карточка отмечает «видел»
 * (`markBizTaskSeen`), статус меняет только кнопка «Взять в работу».
 * Отметку ставят только сотруднику ERP — иначе ворота писателя ответили бы
 * 42501 тостом на каждое открытие.
 */
export function BizTaskCard({ taskId }) {
  const task = useErpStore((s) => s.bizTasks[taskId]);
  const detail = useErpStore((s) => s.bizTaskDetails[taskId]) ?? NO_DETAIL;
  const directory = useErpStore((s) => s.chatDirectory);
  const loadChatDirectory = useErpStore((s) => s.loadChatDirectory);
  const markSeen = useErpStore((s) => s.markBizTaskSeen);
  const myRole = useErpStore((s) => s.myRole);
  const user = useAuthStore((s) => s.user);
  const { can } = useErpAccess();
  const narrow = useMediaQuery(NARROW);
  const [params, setParams] = useSearchParams();
  const pane = PANES.some((p) => p.id === params.get('pane')) ? params.get('pane') : 'task';
  const focusMsg = params.get('msg');

  const me = user?.id ?? null;
  const isStaff = me === 'dev' || isBizTaskStaff(user?.role, myRole);

  useEffect(() => { void loadChatDirectory(); }, [loadChatDirectory]);
  useEffect(() => {
    if (isStaff) void markSeen(taskId);
  }, [taskId, isStaff, markSeen]);

  const names = useMemo(() => new Map((directory ?? []).map((p) => [p.user_id, p.name])), [directory]);
  if (!task) return null;

  const watchers = detail.watchers ?? task.watchers;
  const roles = bizTaskRolesOf(task, me, watchers);
  const canManage = canManageBizTasks(can, isStaff);
  const actions = bizTaskActions(task, roles, canManage, isStaff);
  /** Выбор людей — сотрудники ERP; уже стоящие наблюдатели — чтобы их можно было снять */
  const people = (directory ?? []).filter((p) => p.role !== null || watchers.includes(p.user_id));
  // «Сейчас» — на рендер: просрочка пересчитается со звонком realtime
  const overdue = isOverdue(task, new Date());

  const setPane = (id) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (id === 'task') next.delete('pane'); else next.set('pane', id);
    return next;
  }, { replace: true });

  const summary = (
    <div className={styles.main}>
      <div className={styles.state}>
        <Badge variant={STATUS_VARIANT[task.status]}>{BIZ_TASK_STATUS_LABELS[task.status]}</Badge>
        {overdue && (
          <Badge variant="danger">
            <Icon name="alert" size={13} />
            Просрочена
          </Badge>
        )}
        {task.review_required && <span className={styles.muted}>Проверка постановщиком</span>}
      </div>

      <dl className={styles.facts}>
        <Fact label="Ответственный">{names.get(task.assignee_id) ?? '—'}</Fact>
        <Fact label="Срок">{formatDue(task.due_at)}</Fact>
        <Fact label="Постановщик">{names.get(task.creator_id) ?? '—'}</Fact>
        <Fact label="Наблюдатели">{watchers.map((id) => names.get(id) ?? '—').join(', ') || 'нет'}</Fact>
        <Fact label="Создана">{formatMoment(task.created_at)}</Fact>
        <Fact label="Сдана на проверку">{formatMoment(task.submitted_at)}</Fact>
        <Fact label="Проверена">{formatMoment(task.reviewed_at)}</Fact>
        <Fact label="Завершена">{formatMoment(task.completed_at)}</Fact>
        <Fact label="Отменена">{formatMoment(task.cancelled_at)}</Fact>
      </dl>

      {task.status === 'paused' && task.pause_reason && (
        <p className={styles.note}>Причина приостановки: {task.pause_reason}</p>
      )}
      {task.status === 'cancelled' && task.cancel_reason && (
        <p className={styles.note}>Причина отмены: {task.cancel_reason}</p>
      )}
      {task.status === 'in_progress' && task.return_reason && (
        <p className={styles.note}>Вернули в работу. Что исправить: {task.return_reason}</p>
      )}

      <BizTaskActions task={task} detail={{ ...detail, watchers }} actions={actions} people={people} />

      <section className={styles.block} aria-label="Описание">
        {task.description
          ? <p className={styles.description}>{task.description}</p>
          : <p className={styles.muted}>Описания нет.</p>}
      </section>

      <BizTaskChecklist
        taskId={task.id}
        items={detail.checklist}
        canToggle={actions.includes('toggle_item')}
        canEdit={actions.includes('checklist')}
      />

      {task.result_text && (
        <section className={`${styles.block} ${styles.result}`} aria-labelledby={`${task.id}-result`}>
          <h2 id={`${task.id}-result`} className={styles.blockTitle}>Результат</h2>
          <p className={styles.description}>{task.result_text}</p>
          {task.result_message_id && (
            <Link to={`?msg=${task.result_message_id}&pane=chat`}>Сообщение-результат в обсуждении</Link>
          )}
        </section>
      )}
    </div>
  );
  const history = <BizTaskHistory events={detail.events} names={names} />;
  const files = <BizTaskFiles task={task} files={detail.files} names={names} canAttach={actions.includes('attach')} />;
  const chat = (
    <Suspense fallback={<p className={styles.muted} role="status">Загружаем обсуждение…</p>}>
      <ChatPanel taskId={task.id} canManage={canManage} focusId={focusMsg} />
    </Suspense>
  );
  const content = { task: summary, chat, history, files };

  return (
    <div className={styles.card}>
      <Link to={`/orders/${task.order_id}?tab=tasks`} className={styles.back}>
        <Icon name="arrowLeft" size={14} />
        Заказ {task.order ? orderLabel(task.order) : ''}
      </Link>
      <PageHead title={task.title} sub={BIZ_TASK_KIND_LABELS[task.kind]} />
      {narrow ? (
        <>
          <Tabs idPrefix="biz-task" label="Разделы задачи" tabs={PANES} active={pane} onSelect={setPane} />
          <TabPanel idPrefix="biz-task" active={pane} className={pane === 'chat' ? styles.chatPane : styles.pane}>
            {content[pane]}
          </TabPanel>
        </>
      ) : (
        <div className={styles.layout}>
          <div className={styles.column}>
            {summary}
            {history}
            {files}
          </div>
          <div className={styles.side}>{chat}</div>
        </div>
      )}
    </div>
  );
}
