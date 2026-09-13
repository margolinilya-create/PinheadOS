import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Badge } from '../components/Badge';
import { RouteProgress } from '../components/RouteProgress';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import { LoadFailed, EmptyState } from '../components/ErpStates';
import { useErpStore } from '../store/useErpStore';
import { useStagePermissions } from '../store/useStagePermissions';
import { findStage } from '../store/orderHelpers';
import { deptShortName } from '../data/departments';
import { isStageAwaitingProcurement, isStageReady, waitingReason, materialsForItem } from '../utils/routes';
import { stageMissingTz } from '../utils/tz';
import { stageQtyProgress } from '../utils/progress';
import { isFileResultStage, stageResultFiles } from '../utils/stageResult';
import { STAGE_CHIP_CLASS } from '../utils/stageUi';
import { daysLeft, formatDateShort, stageOverdue } from '../utils/time';
import { MATERIAL_STATUS_LABELS, STAGE_STATUS_LABELS } from '../types';
import { supabase } from '../../lib/supabase';
import styles from '../styles';
import DeptBindingNotice from '../components/DeptBindingNotice';
import { Icon } from '../components/Icon';
import { StageActionsPanel } from './queue/StageActionsPanel';
import { useStageActions } from './queue/useStageActions';
import { CommentsSection } from './orderCard/CommentsSection';
import { useOrderDetail } from './orderCard/useOrderDetail';
import { dueLabelCompact } from '../utils/format';
import { ButtonLink } from '../components/Button';

/**
 * Страница производственного задания.
 *
 * РАСКЛАДКА ПЕРЕСОБРАНА ПО РЕФЕРЕНСУ ЗАКАЗЧИКА (правка 13.09, п. 4).
 * Производственная логика не менялась ни в одной строке — переставлены блоки
 * и убрано лишнее:
 *
 *  1. вверху — название этапа и изделия плюс статус;
 *  2. под ним ОДНОЙ компактной строкой — ключевое по заказу: заказ, изделие,
 *     количество, выполнено, срок;
 *  3. слева «ТЗ и действия», справа «Маршрут и прогресс» — рядом, а не одно
 *     под другим: на 768×1024, ради которых пилот и запущен, маршрут уезжал
 *     под сгиб;
 *  4. ниже компактное «Задание» — только рабочие данные ЭТАПА (материал,
 *     исполнитель, план этапа). Заказ, клиент и менеджер оттуда ушли: они
 *     теперь в строке выше и в карточке заказа, а повторять их в дефинишн-листе
 *     значило дважды отвечать на один вопрос;
 *  5. файлы — компактной строкой, а не сеткой плиток;
 *  6. внизу комментарии.
 *
 * ПУСТОЕ НЕ ПОКАЗЫВАЕТСЯ (то же требование). Прочерк в режиме просмотра
 * ничего не сообщает, а место занимает наравне с заполненным: «Менеджер — —»
 * читается как поле, которое кто-то забыл заполнить. Исключение одно
 * и осознанное — исполнитель: «не закреплено» это СОБЫТИЕ («задание никто
 * не взял»), а не отсутствие данных, и мастеру его видеть надо.
 *
 * Действия («Взять в работу», «Записать результат», «Проблема», «Завершить
 * этап») общие с очередью цеха — `StageActionsPanel` + `useStageActions`.
 */
export default function ProductionTask() {
  const { stageId } = useParams();
  const {
    orders, departments, loaded, loadError, loadAll, findOrderIdByStage, myDeptLoaded,
    detailError,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      myDeptLoaded: s.myDeptLoaded,
      detailError: s.detailError,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      findOrderIdByStage: s.findOrderIdByStage,
    })),
  );
  const actions = useStageActions();
  const location = useLocation();
  const [resolvedOrderId, setResolvedOrderId] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  const found = useMemo(() => findStage(orders, stageId), [orders, stageId]);

  // Диплинк на задание архивного/чужого заказа: в сторе его нет — резолвим заказ по этапу
  useEffect(() => {
    if (!loaded || found || resolvedOrderId || notFound) return undefined;
    let alive = true;
    findOrderIdByStage(stageId).then((id) => {
      if (!alive) return;
      if (id) setResolvedOrderId(id);
      /**
       * «Не найдено» — только когда сервер ОТВЕТИЛ и этапа действительно нет
       * (правка 03.09). При сбое запроса функция тоже отдавала `null`,
       * и рабочий по ссылке на задание читал «Задание не найдено или было
       * удалено» — про задание, которое на месте. Отказ теперь виден
       * во флаге `detailError` и показывается «Не удалось загрузить».
       */
      else if (!useErpStore.getState().detailError) setNotFound(true);
    });
    return () => { alive = false; };
  }, [loaded, found, resolvedOrderId, notFound, findOrderIdByStage, stageId]);

  // Комментарии/история/вложения — общий хук карточки заказа
  const detail = useOrderDetail(found?.order.id ?? resolvedOrderId ?? null);

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const deptShortById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );

  // Хук прав — до ранних выходов (правило хуков): цех берём из найденного этапа
  const perms = useStagePermissions(found?.stage.department_id ?? null);

  if (loadError && !loaded) {
    return (
      <>
        <PageHead title="Производственное задание" sub="Задание цеха по позиции заказа." />
        <LoadFailed onRetry={loadAll} what="задание" />
      </>
    );
  }
  if (!loaded) return <ScreenSkeleton />;
  if (!found) {
    // Сбой резолва этапа — отдельная ветка, с кнопкой повтора
    if (detailError && !notFound) {
      return (
        <>
          <PageHead title="Производственное задание" />
          <LoadFailed onRetry={() => { setNotFound(false); loadAll(); }} what="задание" />
        </>
      );
    }
    // Диплинк на задание архивного заказа: резолвим его отдельным запросом —
    // до ответа показываем скелетон, а не текст «Загружаем…» (правило DESIGN.md)
    if (!notFound) return <ScreenSkeleton />;
    return (
      <>
        <PageHead title="Производственное задание" sub="Задание цеха по позиции заказа." />
        <EmptyState
          icon="ban"
          title="Задание не найдено"
          text="Возможно, оно было удалено."
        />
      </>
    );
  }

  const { order, item, stage } = found;
  const dept = deptById.get(stage.department_id);
  const itemMaterials = materialsForItem(order.materials, item.id);
  const deptName = dept ? deptShortName(dept.code, dept.name) : 'Цех';
  const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, stage.id);
  const noTz = stageMissingTz(order, item.id, dept);
  const ready = stage.status === 'waiting'
    && isStageReady(stage, item.stages, materialsForItem(order.materials, item.id),
      dept, awaitProc, noTz);
  const group = stage.status === 'waiting' && ready ? 'ready' : stage.status;
  const display = group === 'ready' ? 'ready' : stage.status;
  const reason = (display === 'waiting' || display === 'blocked')
    ? waitingReason(
        stage, item.stages, materialsForItem(order.materials, item.id),
        deptNameById, dept, awaitProc, noTz)
    : null;
  const progress = stageQtyProgress(stage, item.qty);
  const d = daysLeft(order.due_date);
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const entry = { order, item, stage, group, reason };
  /**
   * Результат этапа — файл (правка 13.09, п. 9). У такого этапа количества нет
   * вовсе: «выполнено» здесь показывало бы вечные 0 из 100.
   */
  const fileResult = isFileResultStage(stage);
  const resultFiles = fileResult ? stageResultFiles(order, stage.id) : [];
  const itemName = `${item.product_type}${item.variant ? ` · ${item.variant}` : ''}`;
  /**
   * ЗАДАЧА НАЗЫВАЕТ СЕБЯ. У позиции с вышивкой этапов в одном цехе два —
   * разработка программы и сама вышивка, — и по имени участка их не различить
   * (правка 12.09, вторая порция). Имя операции печатается, только когда
   * оно расходится с именем цеха.
   */
  const stageName = stage.operation && stage.operation !== deptName
    ? `${deptName} · ${stage.operation}`
    : deptName;

  /**
   * Ключевая строка заказа. Собирается списком, чтобы пустое отсеивалось
   * ОДНИМ правилом, а не пятью условиями в разметке: требование «пустые
   * значения с „—" в режиме просмотра не выводить» действует на все поля.
   */
  const keyFacts = [
    { label: 'Заказ', value: `№${order.bitrix_id || '—'} · ${order.title}` },
    { label: 'Изделие', value: itemName },
    { label: 'Количество', value: `${item.qty} шт`, mono: true },
    fileResult
      ? {
        label: 'Результат',
        value: resultFiles.length > 0 ? 'программа приложена' : 'нет программы',
      }
      : {
        label: 'Выполнено',
        value: `${progress.done} из ${progress.total} шт (${progress.pct}%)`,
        mono: true,
      },
    order.due_date
      ? {
        label: 'Срок',
        value: `${formatDateShort(order.due_date)}${d !== null ? ` · ${dueLabelCompact(d)}` : ''}`,
        tone: d !== null && d < 0 ? styles.overdue : undefined,
      }
      : null,
  ].filter(Boolean);

  return (
    <>
      <PageHead
        title={`${stageName}: ${itemName}`}
        sub={`Задание цеха по заказу №${order.bitrix_id || '—'}.`}
      />

      {/*
        Сюда цех приходит работать: пустой блок действий обязан объясниться.
        Но ЖДЁМ БУТСТРАП (правка 03.09): до него `resolveErpRole` отдаёт
        `worker`, а он в `DEPT_BOUND_ROLES` — и нормально заведённому рабочему
        полсекунды показывали, что его профиль не настроен. В очереди цеха это
        условие уже стоит, сюда не доехало.
      */}
      {myDeptLoaded && perms.needsDeptBinding && <DeptBindingNotice />}

      {/* СТАТУС — В ШАПКЕ, РЯДОМ С НАЗВАНИЕМ (правка 13.09, п. 4): он первое,
          что спрашивают у задания, и стоять после двух кнопок навигации
          ему незачем */}
      <div className={styles.toolbar}>
        <span className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[display]]}`}>
          {STAGE_STATUS_LABELS[display]}
        </span>
        {overdue && (
          <Badge variant="blocked"><Icon name="clock" size={13} /> Этап просрочен</Badge>
        )}
        {/*
          Образец экс-цеха. Пометка стояла в строке и карточке очереди, а сюда
          цех приходит РАБОТАТЬ — и именно здесь важно понимать, что тираж
          один-два, а спрос другой (документ 20.08: «заметная пометка
          ЭКС / ОБРАЗЕЦ»). В маршрутную логику признак не входит: образец
          проходит те же гейты и переходы.
        */}
        {stage.origin === 'experimental' && (
          <span
            className={`${styles.chip} ${styles.chipWaiting}`}
            title="Образец из экспериментального цеха — разработка, а не серия"
          >
            <Icon name="flask" size={13} /> ЭКС / ОБРАЗЕЦ
          </span>
        )}
        <div className={styles.spacer} />
        {/* Заказ открывается своей страницей и помнит, откуда пришли. Это
            ДРУГОЙ адресат, а не второй путь к тому же (правка 13.09, п. 5):
            карточка заказа несёт маршрут, ТЗ, закупку, историю и переписку */}
        <ButtonLink
          to={`/orders/${order.id}`}
          state={{ from: `${location.pathname}${location.search}` }}
          variant="secondary"
        >
          Открыть заказ №{order.bitrix_id || '—'} ↗
        </ButtonLink>
        {/* Возврат туда, откуда пришли: ссылка без search теряла и фильтры,
            и позицию прокрутки (useScrollRestore ключуется по pathname+search) */}
        <ButtonLink
          to={location.state?.from || `/queue/${dept?.code ?? ''}`}
          variant="ghost"
        >
          ← В очередь цеха
        </ButtonLink>
      </div>

      {/* Ключевое по заказу — ОДНОЙ строкой, а не дефинишн-листом на полэкрана */}
      <dl className={styles.taskKeyFacts}>
        {keyFacts.map((f) => (
          <div key={f.label} className={styles.taskKeyFact}>
            <dt>{f.label}</dt>
            <dd className={[f.mono && styles.progressCell, f.tone].filter(Boolean).join(' ') || undefined}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className={styles.taskGrid}>
        {/*
          ТЗ И ДЕЙСТВИЯ — ПЕРВЫМИ (§6.2 обхода 04.09, блокер Б4).
          Страница задания монтирует ту же панель, что строка очереди, и своей
          роли не имела: очередь отвечает «что взять следующим», страница —
          «работаю над этим». Отвечать на второй вопрос она начинала третьим
          экраном: сверху лежали справка «Задание» и «Маршрут и прогресс»,
          а ТЗ и кнопки — под ними.
        */}
        <section className={styles.matSection}>
          <div className={styles.matSectionHead}><strong>ТЗ и действия</strong></div>
          {!perms.inDept && (
            <div className={`${styles.queueReason} ${styles.cellWithIcon}`}>
              <Icon name="eye" size={14} />Это не ваш цех — только просмотр.
            </div>
          )}
          <StageActionsPanel
            entry={entry}
            perms={perms}
            deptShortById={deptShortById}
            actions={actions}
          />
        </section>

        <section className={styles.matSection}>
          <div className={styles.matSectionHead}><strong>Маршрут и прогресс</strong></div>
          <RouteProgress
            item={item}
            order={order}
            deptById={deptById}
            currentStageId={stage.id}
          />
        </section>
      </div>

      {/*
        «ЗАДАНИЕ» — ТОЛЬКО РАБОЧИЕ ДАННЫЕ ЭТАПА (правка 13.09, п. 4).
        Заказ, клиент, менеджер, изделие, количество, выполнено и срок отсюда
        ушли: первые три — в карточку заказа, остальные — в строку выше.
        Осталось то, что относится к самой работе цеха.
      */}
      <section className={styles.matSection}>
        <div className={styles.matSectionHead}><strong>Задание</strong></div>
        <dl className={styles.taskFacts}>
          {/* Материалы ПОЗИЦИИ, а не всего заказа (правка 03.09): в заказе
              из трёх изделий швея видела ткань чужого и делала по ней вывод
              о своей готовности. Пустой список не показывается вовсе —
              подпись «Материалы не ожидаются» была утверждением, которого
              данные не подтверждают */}
          {itemMaterials.length > 0 && (
            <>
              <dt>Материал</dt>
              <dd>
                <ul className={styles.tzMatList}>
                  {itemMaterials.map((m) => (
                    <li key={m.id}>
                      {m.name}{m.color ? ` · ${m.color}` : ''}
                      <span className={styles.subText}> — {MATERIAL_STATUS_LABELS[m.status] || m.status}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {/* «Не закреплено» ПОКАЗЫВАЕТСЯ — это событие, а не пустота:
              мастеру важно видеть, что задание никто не взял */}
          <dt>Исполнитель</dt>
          <dd>{stage.assignee || <span className={styles.subText}>не закреплено</span>}</dd>
          {stage.planned_end && (
            <>
              <dt>План этапа</dt>
              <dd>{formatDateShort(stage.planned_end)}</dd>
            </>
          )}
          {stage.qty_rework > 0 && (
            <>
              <dt>На переделку</dt>
              <dd className={styles.progressCell}>{stage.qty_rework} шт</dd>
            </>
          )}
        </dl>
        {reason && (
          <div className={styles.queueReason}>
            <span className={styles.cellWithIcon}><Icon name="clock" size={14} />{reason}</span>
          </div>
        )}
        {stage.status === 'blocked' && stage.block_reason && (
          <div className={`${styles.queueReason} ${styles.overdue}`}>
            <span className={styles.cellWithIcon}><Icon name="ban" size={14} />{stage.block_reason}</span>
          </div>
        )}
      </section>

      {/* ФАЙЛЫ — КОМПАКТНОЙ СТРОКОЙ (правка 13.09, п. 4). Сетка плиток
          по 120px отдавала им полэкрана ради имени файла; пустое состояние
          не показывается вовсе — «Файлов пока нет» это тот же прочерк */}
      {(order.attachments ?? []).length > 0 && (
        <section className={styles.matSection}>
          <div className={styles.matSectionHead}><strong>Файлы</strong></div>
          <div className={styles.taskFileRow}>
            {order.attachments.map((a) => (
              <a
                key={a.id}
                className={styles.cellWithIcon}
                href={supabase.storage.from('erp-attachments').getPublicUrl(a.file_path).data.publicUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="paperclip" size={14} /> {a.file_name || a.file_path}
              </a>
            ))}
          </div>
        </section>
      )}

      <CommentsSection comments={detail.comments} onSend={detail.onSendComment} />
    </>
  );
}
