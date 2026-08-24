import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { DictionaryDatalist } from '../../components/DictionaryDatalist';
import { ReadOnlyFieldset } from '../../components/ReadOnlyFieldset';
import { useDictionary } from '../../store/useDictionary';
import { OrderLink } from '../../components/OrderLink';
import { confirm, confirmWithInput } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { DEV_OUTCOME_LABELS } from '../../types';
import {
  currentBlocker, devReadiness, nextAction, reworkHistory, taskLabel,
} from '../../utils/experimentalTasks';
import { deptShortName, isProductionDept } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { factoryToday } from '../../../utils/date';
import { StageIndicator } from '../../components/StageIndicator';
import {
  DEV_STAGE_LABELS, cuttingGate, devBoardColumn, devRouteSteps, devStageStates,
  devStageOfTask, extraTasks,
} from '../../utils/experimentalBoard';
import { wantsSkuCard } from '../../utils/finalPackage';
import { DevStageRoute } from './DevStageRoute';
import { DevTasksSection } from './DevTasksSection';
import { DevSendToDept } from './DevSendToDept';
import { DevSampleCheck } from './DevSampleCheck';
import { DevFinalPackage } from './DevFinalPackage';
import { DevToSku } from './DevToSku';
import { DevCardTabs } from './DevCardTabs';
import { DevAside } from './DevAside';
import { DevFilesTab } from './DevFilesTab';
import styles from '../../styles';

/**
 * Карточка разработки (ТЗ заказчика 12.08, п.12–14).
 *
 * Пять взаимоисключающих веток по `exp.phase` из прежней карточки удалены —
 * это и была линейная модель, которую заказчик отверг. Здесь всегда видно
 * одно и то же: кто ведёт, готовность, текущий блокер, следующее действие
 * и доска задач.
 *
 * Чего здесь НЕТ намеренно:
 *  · автоматической передачи образца в общий швейный цех (ТЗ п.6) — пошив
 *    образца это обычная задача, а передача в цех отдельное действие над ней;
 *  · «возврата конструктору» как фазы (п.8) — это РЕЗУЛЬТАТ примерки, и он
 *    заводит новые задачи с новым кругом;
 *  · автосоздания производственного заказа при «Готово к серии» (п.9) —
 *    решение заказчика: заказ заводит менеджер.
 *
 * ВКЛАДКИ И ПРАВАЯ КОЛОНКА (референс заказчика 24.08). Карточка была одной
 * простынёй: поля, маршрут, две таблицы задач, форма, приёмка образца,
 * история доработок, пакет из двенадцати полей и перенос в каталог — подряд.
 *
 * Раскладка взята с референса, СПОСОБ ОТКРЫТИЯ — нет: там карточка нарисована
 * боковой панелью, а 16.08 заказчик решил обратное («для такого количества
 * информации боковая панель неудобна»), и шторки в проекте не осталось нигде.
 * Возвращать её значит завести вторую поверхность с тем же содержимым — то,
 * от чего ушли и в заказе, и здесь. Берём то, что решает названную проблему:
 * вкладки и постоянную справку справа.
 *
 * ВКЛАДКА ПО УМОЛЧАНИЮ — «Задачи», как на референсе: в карточку приходят
 * работать, а не читать поля.
 */

function AddTaskForm({ typeItems, onAdd, tasks }) {
  const [type, setType] = useState('');
  const [title, setTitle] = useState('');
  const [responsible, setResponsible] = useState('');
  const [due, setDue] = useState('');
  const [dependsOn, setDependsOn] = useState([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!type.trim()) { toast.error('Выберите тип задачи'); return; }
    setBusy(true);
    /**
     * Зависимости на СУЩЕСТВУЮЩИЕ задачи передаются id, а не индексами:
     * индексы в RPC адресуют элементы этой же пачки, а здесь пачка из одной
     * задачи. Поэтому связь дописывается вторым шагом — иначе пришлось бы
     * усложнять контракт ради единственного случая.
     */
    const rows = await onAdd([{
      task_type: type.trim(),
      title: title.trim() || null,
      responsible: responsible.trim() || null,
      due_date: due || null,
    }], dependsOn);
    setBusy(false);
    if (rows) { setType(''); setTitle(''); setResponsible(''); setDue(''); setDependsOn([]); }
  };

  const openTasks = tasks.filter((t) => t.status !== 'cancelled');

  return (
    <div className={styles.formGrid}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Тип задачи</span>
        {/* Справочник — подсказка поверх свободного ввода (правило проекта) */}
        <DictionaryDatalist kind="experimental_task_type" id="erp-dev-task-types" />
        <input
          className={styles.input}
          value={type}
          list="erp-dev-task-types"
          onChange={(e) => setType(e.target.value)}
          placeholder="Лекала, Подбор материала, Примерка…"
          aria-label="Тип задачи"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Уточнение</span>
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Доработка лекал: рукав +2 см"
          aria-label="Название задачи"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Ответственный</span>
        <input
          className={styles.input}
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
          aria-label="Ответственный за задачу"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Срок</span>
        <DateField value={due} onChange={setDue} aria-label="Срок задачи" />
      </label>
      {openTasks.length > 0 && (
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.fieldLabel}>Зависит от (необязательно)</span>
          <div className={styles.checkRow}>
            {openTasks.map((t) => (
              <label key={t.id} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={dependsOn.includes(t.id)}
                  onChange={(e) => setDependsOn((prev) => (e.target.checked
                    ? [...prev, t.id]
                    : prev.filter((x) => x !== t.id)))}
                />
                {taskLabel(t, typeItems)}
              </label>
            ))}
          </div>
        </label>
      )}
      <div className={styles.modalActions}>
        {/* Подпись сабмита отличается от подписи кнопки, которая эту форму
            раскрывает: две кнопки «+ Добавить задачу» на одном экране —
            это «нажал и ничего не произошло» у того, кто попал в первую */}
        <Button variant="primary" disabled={busy} onClick={submit}>Создать задачу</Button>
      </div>
    </div>
  );
}

export function DevCard({
  dev, order, departments, canManage,
  onUpdate, onAddTasks, onUpdateTask, onSendTask, onClose,
  onApproveSample, onUploadFile, onRemoveFile,
}) {
  const typeDict = useDictionary('experimental_task_type');
  const typeNames = useMemo(
    () => new Map((typeDict ?? []).map((d) => [d.code, d.name])), [typeDict]);
  const deptNames = useMemo(
    () => new Map((departments ?? []).map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments]);

  const tasks = dev.tasks ?? [];
  const today = factoryToday();
  const readiness = devReadiness(tasks);
  const blocker = currentBlocker(tasks, typeNames, today);
  const action = nextAction(dev, tasks, typeNames, today);
  const history = reworkHistory(tasks);
  /**
   * Путь разработки СВЕРХУ — прямое требование документа 20.08: «Построение
   * лекал — Крой — Нанесения — Пошив — Финальный этап… должно быть понятно,
   * что уже выполнено, что сейчас в работе и что ещё осталось». Считается тем
   * же `devStageStates`, что и доска: два ответа на один вопрос разошлись бы.
   */
  const stageStates = devStageStates({
    dev, tasks, materials: order?.materials ?? [],
  });
  const currentStage = devBoardColumn(stageStates, dev);
  /**
   * Разделение задач на две группы (п. 4.6): «если внутри разработки создана
   * задача Доработать рукав, на общей доске не должна появляться отдельная
   * колонка Доработать рукав». Отбор один — `devStageOfTask`, та же таблица
   * соответствий, по которой доска считает колонки.
   */
  // Без useMemo: обход одного короткого массива, а `tasks` пересобирается
  // на каждый рендер (`dev.tasks ?? []`) — мемоизация тут только мешает
  const extra = extraTasks(tasks);
  const stageTaskList = tasks.filter((t) => devStageOfTask(t.task_type) !== null);
  /**
   * Статус материалов — обязательный пункт карточки по документу 20.08.
   * Считается ТЕМ ЖЕ гейтом кроя, что и доска: «крой можно начать только когда
   * лекала готовы И материалы физически приняты складом». Второй ответ на тот
   * же вопрос разошёлся бы с первым — а человек читает оба на одном экране.
   */
  const patternsDone = tasks
    .filter((t) => t.task_type === 'patterns')
    .every((t) => t.status === 'done' || t.status === 'cancelled');
  const [toSkuOpen, setToSkuOpen] = useState(false);
  const materialGate = cuttingGate({
    patternsDone: patternsDone && tasks.some((t) => t.task_type === 'patterns'),
    itemId: dev.item_id,
    materials: order?.materials ?? [],
  });
  /**
   * Позиция заказа, которую разрабатывают. Нужна справке справа: изделие
   * и размерный ряд описывает ЗАКАЗ, у разработки своих полей для них нет
   * и заводить их значило бы держать два ответа на один вопрос.
   */
  const item = useMemo(
    () => (order?.items ?? []).find((it) => it.id === dev.item_id) ?? null,
    [order, dev.item_id],
  );

  const shops = useMemo(
    () => (departments ?? []).filter((d) => d.active && isProductionDept(d)),
    [departments]);
  /** Задача, для которой открыта форма передачи в цех */
  const [sendFor, setSendFor] = useState(null);

  /**
   * ЗАВЕРШЕНИЕ ЗАДАЧИ «ПОСТРОЕНИЕ ЛЕКАЛ» ТРЕБУЕТ РЕЗУЛЬТАТА (правка 22.08,
   * п. 4.13). «Сейчас задачу Построение лекал можно завершить без
   * зафиксированного результата. При завершении сделать обязательным поле
   * Техническое название лекал».
   *
   * И ТУТ ЖЕ РЕШАЕТСЯ П. 4.14: введённое название пишется прямо
   * в `erp_experimental.pattern_tech_name` — то самое поле, которое читает
   * финальный технический пакет и проверяет страж `erp_dev_package_guard`.
   * Отдельного «переноса» не существует, потому что колонка одна: два поля
   * с одним смыслом разошлись бы в первую же правку.
   *
   * Обёртка стоит здесь, а не в `DevTasksSection`: та ничего не знает
   * о разработке, а название принадлежит именно ей.
   */
  const updateTask = async (taskId, patch) => {
    const task = tasks.find((t) => t.id === taskId);
    const closingPatterns = patch.status === 'done'
      && task?.task_type === 'patterns'
      && !dev.pattern_tech_name?.trim();
    if (closingPatterns) {
      const { ok, value } = await confirmWithInput({
        title: 'Чем закончилось построение лекал?',
        message: 'Название попадёт в финальный технический пакет — вводить его второй раз не придётся.',
        confirmLabel: 'Завершить',
        prompt: {
          label: 'Техническое название лекал',
          placeholder: 'PNHD-T04-FreeFit-v1',
          required: true,
        },
      });
      if (!ok) return null;
      const saved = await onUpdate(dev.id, { pattern_tech_name: value.trim() });
      // Название — условие завершения, а не довесок: не записалось — задача
      // остаётся открытой, иначе результат потеряется молча
      if (saved === false) return null;
    }
    return onUpdateTask(taskId, patch);
  };

  /**
   * Добавление задачи + необязательная связь с уже существующими.
   *
   * Ответственный по умолчанию — проработчик разработки (п. 4.16: «не нужно
   * заставлять пользователя повторно выбирать одного и того же технолога
   * в каждой микро-задаче»). Явно указанный в форме сильнее.
   */
  const addTasks = async (rows, dependsOnIds = []) => {
    const withOwner = rows.map((r) => ({
      ...r,
      responsible: r.responsible?.trim() || dev.technologist || null,
    }));
    const created = await onAddTasks(withOwner);
    if (created && created.length > 0 && dependsOnIds.length > 0) {
      await onUpdateTask(created[0].id, { depends_on: dependsOnIds });
    }
    return created;
  };

  const blockTask = async (task) => {
    const { ok, value } = await confirmWithInput({
      title: `Заблокировать «${taskLabel(task, typeNames)}»?`,
      message: 'Задача остановится, пока блокировку не снимут. Причина видна в карточке.',
      confirmLabel: 'Заблокировать',
      variant: 'danger',
      prompt: { label: 'Чего не хватает', placeholder: 'Нет ткани / нет решения по цвету', required: true },
    });
    if (ok) await onUpdateTask(task.id, { status: 'blocked', blocked_reason: value });
  };

  const sendTask = (task) => {
    // Позиция обязательна: этап заводится на неё, и без неё RPC откажет
    // внятной ошибкой — но сказать об этом лучше до открытия формы
    if (!dev.item_id) {
      toast.error('У разработки не указана позиция заказа — этап создать не из чего');
      return;
    }
    setSendFor(task);
  };

  /**
   * Файл к задаче (правка 24.08, п. 4.4). Идёт тем же путём, что файлы
   * финального пакета, — различается одна колонка (`taskId`). Второй загрузчик
   * рядом означал бы две реализации привязки, уборки сироты и пути в бакете.
   */
  const uploadTaskFile = (taskId, file) => onUploadFile({
    devId: dev.id, orderId: dev.order_id, kind: 'dev_task', file, taskId,
  });

  /**
   * Доработка нового круга. Состав задач считает `reworkPlan` по ВЫБРАННЫМ
   * областям (правки 20.08): прежняя жёсткая тройка `rework → sample → fitting`
   * перезапускала вышивку из-за длины рукава и не перезапускала крой вовсе.
   *
   * Открытая примерка закрывается тем же действием — «не принято» это её
   * результат, а не отдельная задача.
   */
  const startRework = async (rows) => {
    const created = await onAddTasks(rows);
    if (!created) return null;
    if (fittingTask) {
      await onUpdateTask(fittingTask.id, { status: 'done', result: 'Не принято' });
    }
    return created;
  };

  const closeDev = async (outcome) => {
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    if (open.length > 0) {
      const ok = await confirm({
        title: `Закрыть разработку как «${DEV_OUTCOME_LABELS[outcome]}»?`,
        message: `Не закрыто задач: ${open.length}. Они останутся в истории как есть.`,
        confirmLabel: 'Закрыть',
        variant: 'danger',
      });
      if (!ok) return;
    }
    const { ok, value } = await confirmWithInput({
      title: DEV_OUTCOME_LABELS[outcome],
      message: outcome === 'ready_for_serial'
        ? 'Разработка закроется успешно. Производственный заказ на серию заводит менеджер — автоматически он не создаётся.'
        : 'Разработка закроется с этим исходом.',
      confirmLabel: 'Зафиксировать',
      prompt: { label: 'Комментарий', placeholder: 'необязательно' },
    });
    if (ok) await onClose(dev.id, { outcome, comment: value });
  };

  const fittingTask = tasks.find(
    (t) => t.task_type === 'fitting' && t.status !== 'done' && t.status !== 'cancelled');

  /**
   * Активная вкладка — в адресе (`?tab=`), тем же приёмом, что в карточке
   * заказа: ссылку на разработку шлют коллегам, и «посмотри финальный пакет»
   * должно открываться сразу нужной панелью. `replace`, чтобы переключение
   * не забивало историю: «Назад» обязан вернуть к списку разработок,
   * а не пройти шесть вкладок.
   */
  const [params, setParams] = useSearchParams();
  const activeCount = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled').length;
  const files = dev.attachments ?? [];
  // Без useMemo: шесть литералов на рендер дешевле, чем сравнение зависимостей,
  // а `tasks`/`attachments` и так пересобираются каждый раз (`dev.tasks ?? []`)
  const tabs = [
    { id: 'tasks', label: 'Задачи', count: activeCount },
    { id: 'info', label: 'Информация' },
    { id: 'files', label: 'Файлы', count: files.length },
    { id: 'rework', label: 'История доработок', count: history.length },
    { id: 'package', label: 'Финальный пакет' },
    { id: 'sku', label: 'SKU' },
  ];
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.id === requested) ? requested : 'tasks';
  const selectTab = (id) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (id === 'tasks') next.delete('tab'); else next.set('tab', id);
    return next;
  }, { replace: true });

  /** Форма новой задачи раскрывается кнопкой — как на референсе */
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>
            {order ? (
              <OrderLink orderId={order.id}>
                №{order.bitrix_id || '—'}
              </OrderLink>
            ) : `№${dev.order?.bitrix_id || '—'}`}
            {' · '}
            {order?.title || dev.order?.title || 'Заказ'}
          </strong>
        </div>
        <div className={styles.checkRow}>
          {/* Готовность — в ЗАДАЧАХ, а не в штуках: это разные величины */}
          <span className={`${styles.chip} ${styles.chipNeutral}`}>
            Готовность {readiness.total > 0 ? `${readiness.done} / ${readiness.total}` : '—'}
          </span>
          {dev.outcome && (
            <Badge variant={dev.outcome === 'ready_for_serial' ? 'ready' : 'neutral'}>
              {DEV_OUTCOME_LABELS[dev.outcome]}
            </Badge>
          )}
        </div>
      </div>

      {/*
        Progress-stepper маршрута (правка 23.08, п. 7): пять этапов, у каждого
        видно состояние словами. Узлы считает `devRouteSteps` — из тех же
        `devStageStates`, что рисуют доску: два ответа на один вопрос
        разошлись бы. Сборка узлов стояла ЗДЕСЬ и состояний не показывала:
        у всех шагов, кроме текущего и закрытых, вид был одинаковый.
      */}
      <StageIndicator
        variant="dots"
        label="Путь разработки"
        nodes={devRouteSteps(stageStates, currentStage)}
      />

      <DevCardTabs tabs={tabs} active={tab} onSelect={selectTab} />

      <div className={styles.devLayout}>
        <div
          className={styles.devMain}
          id="dev-tabpanel"
          role="tabpanel"
          aria-labelledby={`dev-tab-${tab}`}
          tabIndex={-1}
        >
      <ReadOnlyFieldset
        canManage={canManage}
        note="Только просмотр: разработку ведёт технолог."
      >
        {/* ─── Информация: поля самой разработки ─── */}
        {tab === 'info' && (
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Название изделия</span>
              <input
                className={styles.input}
                defaultValue={dev.tech_name || ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (dev.tech_name || null)) onUpdate(dev.id, { tech_name: v });
                }}
                aria-label="Название изделия"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Тип разработки</span>
              <input
                className={styles.input}
                defaultValue={dev.dev_type || ''}
                placeholder="Кастомный заказ / своя линейка"
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (dev.dev_type || null)) onUpdate(dev.id, { dev_type: v });
                }}
                aria-label="Тип разработки"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Конструктор</span>
              <input
                className={styles.input}
                defaultValue={dev.constructor || ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (dev.constructor || null)) onUpdate(dev.id, { constructorName: v });
                }}
                aria-label="Конструктор"
              />
            </label>
            <label className={styles.field}>
              {/* «Проработчик» — подпись заказчика; код колонки `technologist`
                  не переименовывается (правило проекта про коды ролей) */}
              <span className={styles.fieldLabel}>Проработчик</span>
              <input
                className={styles.input}
                defaultValue={dev.technologist || ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (dev.technologist || null)) onUpdate(dev.id, { technologist: v });
                }}
                aria-label="Проработчик"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Срок разработки</span>
              <DateField
                value={dev.due_date || ''}
                onChange={(v) => onUpdate(dev.id, { due_date: v || null })}
                aria-label="Срок разработки"
              />
              {!dev.due_date && order?.due_date && (
                <span className={styles.subText}>
                  не задан — считается по сроку заказа {formatDateShort(order.due_date)}
                </span>
              )}
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.fieldLabel}>Комментарий</span>
              <textarea
                className={styles.input}
                rows={2}
                defaultValue={dev.comment || ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (dev.comment || null)) onUpdate(dev.id, { comment: v });
                }}
                aria-label="Комментарий к разработке"
              />
            </label>
          </div>
        )}

        {/* ─── Задачи: маршрут, две группы задач, приёмка образца ─── */}
        {tab === 'tasks' && (
          <>
            {/*
              ДВА БЛОКА, А НЕ ОДИН СПИСОК (правка 22.08, п. 4.7). Верхний двигает
              разработку по канбану, нижний — внутренний список работ технолога.
              Раньше они лежали вперемешку, и понять, какая задача что делает,
              было нельзя: отсюда и ощущение, что доска спорит со списком.
            */}
            <h3 className={styles.queueGroupTitle}>Основной маршрут разработки</h3>
            <p className={styles.subText}>
              Эти этапы двигают разработку по доске. Колонку канбана ставит
              технолог вручную — расчёт показывает, что с работой.
            </p>
            <DevStageRoute
              states={stageStates}
              currentStage={currentStage}
              tasks={tasks}
              typeNames={typeNames}
              onUpdateTask={updateTask}
              canManage={canManage}
            />

            <div className={styles.matSectionHead} style={{ marginTop: 16 }}>
              <h3 className={styles.queueGroupTitle}>Задачи этапов</h3>
              {/*
                Кнопка стоит в шапке блока задач (референс 24.08), а не формой
                внизу страницы: форма, развёрнутая всегда, отодвигала работу —
                а приходят сюда к задачам, а не к их заведению.
              */}
              {!dev.outcome && canManage && (
                <Button
                  variant="secondary"
                  onClick={() => setAddOpen((v) => !v)}
                  aria-expanded={addOpen}
                >
                  + Добавить задачу
                </Button>
              )}
            </div>
            {addOpen && !dev.outcome && (
              <AddTaskForm typeItems={typeNames} tasks={tasks} onAdd={addTasks} />
            )}
            <DevTasksSection
              tasks={stageTaskList}
              allTasks={tasks}
              typeNames={typeNames}
              deptNames={deptNames}
              onUpdate={updateTask}
              onSend={sendTask}
              onBlock={blockTask}
              canManage={canManage}
              files={files}
              onUploadFile={uploadTaskFile}
              onRemoveFile={(attId) => onRemoveFile(dev.id, attId)}
            />

            <h3 className={styles.queueGroupTitle} style={{ marginTop: 16 }}>
              Дополнительные задачи
            </h3>
            <p className={styles.subText}>
              Внутренние работы технолога: доработать рукав, подобрать ткань,
              проверить молнию. Колонок на доске они не создают.
            </p>
            <DevTasksSection
              tasks={extra}
              allTasks={tasks}
              typeNames={typeNames}
              deptNames={deptNames}
              onUpdate={updateTask}
              onSend={sendTask}
              onBlock={blockTask}
              canManage={canManage}
              files={files}
              onUploadFile={uploadTaskFile}
              onRemoveFile={(attId) => onRemoveFile(dev.id, attId)}
              emptyText="Дополнительных задач нет — добавьте, если нужна работа вне основных этапов."
            />

            {sendFor && (
              <DevSendToDept
                task={sendFor}
                taskName={taskLabel(sendFor, typeNames)}
                departments={shops}
                onSend={onSendTask}
                onCancel={() => setSendFor(null)}
              />
            )}

            {/* Приёмка образца — ДЕЙСТВИЕ по текущей работе, поэтому она здесь,
                а не в истории доработок: история отвечает на «что уже было» */}
            {!dev.outcome && (
              <DevSampleCheck
                dev={dev}
                tasks={tasks}
                onApprove={(note) => onApproveSample(dev.id, note)}
                onRework={startRework}
              />
            )}
          </>
        )}

        {/* ─── Файлы: сводный реестр вложений разработки ─── */}
        {tab === 'files' && (
          <DevFilesTab files={files} tasks={tasks} typeNames={typeNames} />
        )}

        {/* ─── История доработок ───
            Прямое требование документа. Круг считает СЕРВЕР по типу задачи,
            поэтому номер стоит у каждой задачи, а не у группы: группа «Круг 1»
            не содержала бы половины своей же работы и врала бы убедительно. */}
        {tab === 'rework' && (
          history.length > 0 ? (
            <ul className={styles.subText}>
              {history.map((t) => (
                <li key={t.id}>
                  {taskLabel(t, typeNames)} · круг {t.cycle}
                  {t.done_on ? ` · ${formatDateShort(t.done_on)}` : ''}
                  {t.comment ? ` — ${t.comment}` : ''}
                  {t.result ? ` → ${t.result}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.subText}>
              Доработок не было: образец либо ещё не смотрели, либо приняли
              с первого круга.
            </p>
          )
        )}

        {/* ─── Финальный пакет и исход разработки ─── */}
        {tab === 'package' && (
          <>
            {!dev.outcome ? (
              <>
                <DevFinalPackage
                  dev={dev}
                  attachments={files}
                  canManage={canManage}
                  onUpdate={onUpdate}
                  onUpload={(kind, file) => onUploadFile({
                    devId: dev.id, orderId: dev.order_id, kind, file,
                  })}
                  onRemoveFile={(attId) => onRemoveFile(dev.id, attId)}
                  onReady={() => closeDev('ready_for_serial')}
                />

                <h3 className={styles.queueGroupTitle} style={{ marginTop: 16 }}>
                  Другой итог разработки
                </h3>
                <div className={styles.queueActions}>
                  {Object.entries(DEV_OUTCOME_LABELS)
                    // «Готово к серии» живёт в блоке пакета: там же видно, чего
                    // не хватает. Кнопка в общем ряду обходила бы этот перечень
                    .filter(([code]) => code !== 'ready_for_serial')
                    .map(([code, label]) => (
                      <Button key={code} variant="ghost" onClick={() => closeDev(code)}>
                        {label}
                      </Button>
                    ))}
                </div>
                <p className={styles.subText}>
                  Незаконченная разработка закрывается незаконченной: финального
                  пакета такие исходы не требуют.
                </p>
              </>
            ) : (
              <p className={styles.subText}>
                Разработка закрыта{dev.closed_at ? ` ${formatDateShort(dev.closed_at)}` : ''}
                {dev.outcome_comment ? `: ${dev.outcome_comment}` : ''}.
              </p>
            )}
          </>
        )}

        {/* ─── SKU ───
            ПЕРЕНОС В КАТАЛОГ (решение заказчика 21.08). Документ обещает, что
            «при следующем заказе этой модели экспериментальный цех повторно
            не требуется» — но пока пакет лежит только здесь, менеджер повторного
            заказа о нём не знает: открывает визард, модели там нет, и заводит
            разработку заново. Повторный перенос запрещён: второй артикул той же
            модели — два источника правды о ней.

            ПРЕДЛАГАЕТСЯ ТОЛЬКО ПРИ ВКЛЮЧЁННОМ ПЕРЕКЛЮЧАТЕЛЕ (правка 24.08,
            п. 4.6): пакет без карточки SKU не содержит ни описания, ни ценовой
            вилки — звать в форму, которую нечем заполнить, незачем.

            Вкладка при этом есть ВСЕГДА и объясняет, чего не хватает. Прятать
            её значит оставить вопрос «а модель-то в каталоге?» без ответа —
            и человек пойдёт искать её в визарде. */}
        {tab === 'sku' && (
          dev.sku_code ? (
            <span className={`${styles.chip} ${styles.chipDone}`}>
              В каталоге SKU: {dev.sku_code}
            </span>
          ) : dev.outcome === 'ready_for_serial' && wantsSkuCard(dev) ? (
            <>
              <Button
                variant="primary"
                icon="box"
                disabled={!canManage}
                onClick={() => setToSkuOpen(true)}
              >
                Перенести модель в каталог SKU
              </Button>
              <p className={styles.subText} style={{ marginTop: 4 }}>
                Артикул опишет модель числами прайса — код, категорию и цену
                пошива спросим в форме: пакет их не содержит.
              </p>
            </>
          ) : (
            <p className={styles.subText}>
              {wantsSkuCard(dev)
                ? `Модель отмечена для каталога. Перенос станет доступен, когда
                   разработка завершится с исходом «Готово к серии».`
                : `Модель в каталог не идёт: переключатель «Добавить модель
                   в каталог SKU» во вкладке «Финальный пакет» выключен.`}
            </p>
          )
        )}
      </ReadOnlyFieldset>
        </div>

        <DevAside
          dev={dev}
          item={item}
          blocker={blocker}
          action={action}
          materialGate={materialGate}
          files={files}
          typeNames={typeNames}
          onShowFiles={() => selectTab('files')}
        />
      </div>

      {toSkuOpen && (
        <DevToSku
          dev={dev}
          attachments={files}
          onClose={() => setToSkuOpen(false)}
        />
      )}
    </section>
  );
}
