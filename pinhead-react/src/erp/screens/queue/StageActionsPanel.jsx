import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useDictionary } from '../../store/useDictionary';
import { stageOverdue } from '../../utils/time';
import { factoryToday } from '../../../utils/date';
import { defaultPlannedEnd } from '../../utils/stagePlan';
import { PROCUREMENT_CAUSE_LABELS } from '../../types';
import { TzViewer } from '../../components/TzViewer';
import { itemTzDocument, tzUpdatedAfterStart } from '../../utils/tz';
import { confirmDefectRollback } from '../../utils/stageDefect';
import styles from '../../styles';
import { DateField } from '../../components/DateField';
import { PhotoAttach } from './PhotoAttach';
import { TzBlock } from './TzBlock';
import { DefectWizard } from './DefectWizard';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { DictionaryChips } from '../../components/DictionaryChips';
import { StageReportForm } from '../../components/StageReportForm';
import { StageResultFile } from './StageResultFile';
import { MoveStageSelect } from './MoveStageSelect';
import { TaskRollsInWork } from './TaskRollsInWork';
import { embroideryProgramBlock, isFileResultStage, stageResultFiles } from '../../utils/stageResult';
import { stageUnaccounted } from '../../utils/stageRemaining';
import { stageBrandingNote } from '../../utils/devNote';
import { useStageMove } from '../../hooks/useStageMove';

/**
 * Действия цеха над заданием: «Взять в работу», «Записать результат», «Проблема»,
 * «Завершить этап», брак/переделка и комментарий просрочки.
 *
 * Вынесено из QueueCard, чтобы одинаково работало в развёрнутой строке очереди
 * (правка 2) и на странице производственного задания (правка 5). Логику вызовов
 * держит useStageActions — сюда приходит готовый набор обработчиков.
 *
 * `perms` — набор из useStagePermissions: каждая кнопка гейтится своим правом
 * матрицы, а не общим «этот ли мой цех». Снятая в админке галочка «Оформлять брак»
 * должна убирать кнопку «Брак», а не оставаться украшением.
 */
export function StageActionsPanel({ entry, perms, deptShortById, actions, showTz = true }) {
  const { order, item, stage, group } = entry;
  /** Перенос в другой цех — та же функция, что у канбана (§2.5) */
  const { moveStageTo, canMove, targetsFor } = useStageMove();
  const canMoveDept = canMove(stage);
  const moveTargets = useMemo(() => targetsFor(stage), [targetsFor, stage]);
  /** Задача дневного плана этого этапа на сегодня — если руководитель её ставил */
  const todaySlot = useErpStore(useShallow((st) => (st.planSlots ?? []).find(
    (sl) => sl.stage_id === stage.id
      && sl.work_date === factoryToday()
      && sl.status !== 'cancelled') ?? null));
  const {
    onStart, onDone, onProgress, onBlock, onUnblock, onDefect, onSkip, onForceComplete,
    onAckOverdue,
  } = actions;

  const overdue = stageOverdue(stage.planned_end, stage.status);
  const needsAck = overdue && !stage.overdue_ack_at;
  // Остаток — от потолка учёта, а не от тиража (правка 27.09, п. 7); брак
  // по отчётам панель не читает — точное «не учтено» показывает форма
  const remaining = stageUnaccounted({
    stage, allStages: item.stages ?? [], itemQty: item.qty, defectReported: 0,
  });
  // Вышивка ждёт «Разработку программы вышивки» той же позиции (27.09, п. 3)
  const programBlock = embroideryProgramBlock(stage, item.stages ?? []);

  // Норматив участка (правка 12) и справочники быстрых причин (правка 12)
  const normDays = useErpStore(
    useShallow((s) => s.departments.find((d) => d.id === stage.department_id)?.norm_days ?? null),
  );
  /**
   * Нормативы ВСЕХ участков — мастеру брака: получателем переделки может быть
   * любой этап позиции, и подставлять ему норматив текущего цеха было бы
   * неправдой. Селектор отдаёт примитивы в Map, поэтому `useShallow` здесь
   * не спасает — мемоизуем список и строим карту рядом.
   */
  const departments = useErpStore(useShallow((s) => s.departments));
  const normDaysByDept = useMemo(
    () => new Map(departments.map((d) => [d.id, d.norm_days ?? null])),
    [departments],
  );
  /**
   * Схема отчёта участка. Пусто — участок отчёта не требует, и остаётся прежнее
   * поле «сколько сделано»: fail-open, потому что цех не должен остаться без
   * способа сдать работу из-за незаполненной настройки.
   */
  const resultFields = useErpStore(
    (s2) => s2.departments.find((d) => d.id === stage.department_id)?.result_fields ?? null,
  );
  const reportDept = useErpStore(
    (s2) => s2.departments.find((d) => d.id === stage.department_id) ?? null,
  );
  /**
   * РЕЗУЛЬТАТ ЭТАПА — ФАЙЛ (правка 12.09, вторая порция, баг 02). Признак
   * у САМОГО этапа: схема отчёта принадлежит участку, и разработка программы
   * вышивки получала от цеха вышивки поля «Вышито» и «Брак».
   */
  const fileResult = isFileResultStage(stage);
  // Уточнения технолога для участка нанесения (правка 13.09, п. 10)
  const brandingNote = stageBrandingNote(order, stage, reportDept);
  const resultFiles = stageResultFiles(order, stage.id);
  const hasReportSchema = !fileResult
    && Array.isArray(resultFields) && resultFields.length > 0;
  const submitStageReport = useErpStore((s2) => s2.submitStageReport);

  const blockReasons = useDictionary('block_reason');
  const problemTypes = useDictionary('problem_type');

  // Актуальная версия PDF-ТЗ этого цеха: назначение → группа → is_current (волна 4)
  const tzDoc = itemTzDocument(order, item.id);

  const [ackText, setAckText] = useState('');
  // План завершения по умолчанию: норматив участка, иначе срок клиента (не «сегодня» —
  // иначе этап с дальним сроком мгновенно становился «просрочен» на следующий день, ERP-04).
  const [startDate, setStartDate] = useState(
    () => defaultPlannedEnd({
      plannedEnd: stage.planned_end,
      normDays,
      dueDate: order.due_date,
      // Дата запуска участвует в расчёте срока (правка 30.08, п. 10):
      // этап не планируется раньше, чем заказ вообще запустится
      launchDate: order.launch_date,
    }),
  );
  /**
   * Пустое поле, а НЕ преднабранный остаток. Раньше здесь стоял
   * `String(remaining || item.qty)`: в поле уже лежал весь остаток, и один тап по
   * «Записать результат» уводил `qty_done` в полный тираж — `reportProgress`
   * при `newDone >= total` закрывает этап и открывает следующий цех. То есть
   * кнопка молча делала то же, что «Завершить этап» делает через `confirmStageDone`.
   * На планшете в перчатках это соседняя кнопка.
   *
   * Диалога здесь намеренно нет: когда цех САМ вписал число, ничего не
   * приписывается — подтверждение по `stageDone` нужно ровно для обратного случая,
   * когда система дописывает несданное за цех.
   */
  const [doneQty, setDoneQty] = useState('');
  /**
   * Отчёт по схеме участка (правки 10.08, P2) — вместо поля «сколько сделано»,
   * когда у цеха задана схема. Пока он открыт, завершения этапа, пропуска
   * и смены цеха нет (правка 05.10, п. 5): это не часть записи партии.
   */
  const [reportMode, setReportMode] = useState(false);
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const [blockPhoto, setBlockPhoto] = useState(null);
  // Поля брака живут в DefectWizard: 12 полей внутри строки очереди превращали
  // экран цеха в простыню — здесь остаётся только признак открытого мастера.
  const [defectMode, setDefectMode] = useState(false);
  /**
   * `busy` гасит кнопки на время запроса (`withPending` в сторе защищает от
   * гонки с realtime, но не от повторного тапа) — двойной тап закрыт.
   * ЧЕГО НЕ ХВАТАЛО (правка 03.09): видимого «выполняется». `loading` стоял
   * только у «Взять в работу» (единственной кнопки с формой), а пять
   * остальных действий просто ГАСЛИ. На планшете по цеховому Wi-Fi это
   * читается как «нажал — ничего не произошло, кнопка сломалась»: ровно то,
   * против чего в этом же файле стоит комментарий про немую блокировку.
   */
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (busy) return false;
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  };

  /**
   * Отправка брака: подтверждение отката промежуточных этапов и защита от
   * повторного тапа остаются здесь — мастер только собирает данные.
   * Возвращает false, если человек отказался в подтверждении: тогда мастер
   * не закрывается и введённое не теряется.
   */
  const submitDefect = (payload, photo) => run(async () => {
    // Возврат переоткрывает и промежуточные этапы — рабочий видел только
    // «Вернуть: Швейный цех» и не знал, что откатятся ещё ВТО и Печать
    const targetStage = item.stages.find((s2) => s2.id === payload.target) ?? null;
    const ok = await confirmDefectRollback({
      stage,
      targetStage,
      allStages: item.stages,
      deptNameById: deptShortById,
      qty: payload.qty,
    });
    if (!ok) return false;
    await onDefect(entry, payload, photo);
    return true;
  });

  return (
    <>
      {perms.any && needsAck && (
        <div className={styles.queueBlockForm}>
          <span className={`${styles.overdue} ${styles.cellWithIcon}`}>
            <Icon name="alert" size={14} />Этап просрочен — требуется комментарий
          </span>
          <input
            className={styles.input}
            placeholder="Причина задержки"
            value={ackText}
            onChange={(e) => setAckText(e.target.value)}
            aria-label="Причина задержки этапа"
          />
          <Button
            variant="secondary"
            loading={busy}
            disabled={busy || !ackText.trim()}
            onClick={() => { onAckOverdue(stage.id, ackText.trim()); setAckText(''); }}>
            Сохранить
          </Button>
        </div>
      )}

      {showTz && tzDoc && (
        <TzViewer
          doc={tzDoc}
          compact
          badge={tzUpdatedAfterStart(tzDoc, stage)
            ? <span className={`${styles.chip} ${styles.chipBlocked}`}>ТЗ обновлено</span>
            : null}
        />
      )}
      {showTz && <TzBlock order={order} item={item} />}

      {/*
        КОММЕНТАРИЙ ПО ПРОРАБОТКЕ (правка 13.09, п. 10) — «важные уточнения
        по образцу/нанесению», оставленные технологом при переносе карточки
        в «Нанесения». Стоит рядом с ТЗ, а не среди действий: это ВХОДНЫЕ
        данные работы, а не то, что цех делает. Показывается только участку
        нанесения и только когда текст есть — пустой блок с подписью
        означал бы, что технолог что-то написал.
      */}
      {brandingNote && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}>
            <Icon name="flask" size={14} />
            Комментарий по проработке: {brandingNote}
          </span>
        </div>
      )}

      {/*
        ПЛАН ЗАВЕРШЕНИЯ СТОИТ РЯДОМ С КНОПКОЙ, А НЕ ОТКРЫВАЕТСЯ ЕЮ
        (правка заказчика 30.08, п. 9).

        Раньше «Взять в работу» лишь показывала эту форму, а работу начинала
        вторая кнопка «В работу». Со стороны цеха это выглядело ровно так, как
        описано в документе: «нажал — заказ не перевёлся, пришлось нажимать
        ещё раз». На планшете форма к тому же раскрывалась ниже видимой части
        строки, то есть первое нажатие не давало вообще никакого отклика.

        Решение сессии 39 «плановую дату спрашивают ВСЕ входы в работу» при
        этом сохранено: поле видно ДО нажатия и предзаполнено
        `defaultPlannedEnd` — тем же правилом, что у возврата брака и запуска
        закупки. Спрашивать дату и выполнять действие с первого раза
        не противоречат друг другу, если поле не прячется за кнопкой.
      */}
      {perms.take && group === 'ready' && (
        <label className={styles.planDateRow}>
          План завершения
          <DateField
            value={startDate}
            onChange={setStartDate}
            aria-label="Плановая дата завершения"
          />
          {/* Норматив — ПОСЛЕ поля: он объясняет подставленную дату, а стоя
              между подписью и полем, разрывал строку надвое */}
          {normDays > 0 && (
            <span className={styles.subText}>норматив участка {normDays} дн.</span>
          )}
        </label>
      )}

      {/*
        ПЛАН НА СЕГОДНЯ РЯДОМ С ФАКТОМ ЭТАПА (Б3 обхода 04.09, половина,
        доступная интерфейсу).
        Один результат вводится в ДВУХ местах и это разные числа: здесь
        «Записать результат» приращает `erp_item_stages.qty_done`, а форма
        плана пишет АБСОЛЮТ за день в `erp_calendar_slots.qty_done`. Связки
        между ними нет ни триггером, ни расчётом — то есть цех, отчитавшийся
        тут, в плане остаётся «факт 0». Выбор модели за владельцем
        (§10.2 отчёта); пока величины две, обе обязаны быть видны на ОБЕИХ
        поверхностях, иначе расхождение молчит.
      */}
      {todaySlot && (
        <p className={styles.queueReason}>
          В плане на сегодня: {todaySlot.qty_planned} план · {todaySlot.qty_done ?? 0} факт.
          {' '}
          Это отдельное число — оно не считается из того, что вы запишете здесь.
        </p>
      )}

      {perms.any && (
        <div className={styles.queueActions}>
          {group === 'ready' && (
            <>
              {perms.take && (
                <Button
                  variant="primary"
                  /* `loading`, а не только `disabled`: погасшая кнопка без
                     признака работы читается как «опять не сработало» — ровно
                     та жалоба, из-за которой правился сам поток (п. 9) */
                  loading={busy}
                  disabled={busy}
                  onClick={() => run(() => onStart(entry, startDate))}>
                  <Icon name="play" size={14} /> Взять в работу
                </Button>
              )}
              {perms.block && !blockMode && (
                <Button variant="ghost" onClick={() => setBlockMode(true)}>
                  <Icon name="ban" size={14} /> Проблема
                </Button>
              )}
            </>
          )}
          {group === 'in_progress' && (
            <>
              {/*
                ИЕРАРХИЯ ДЕЙСТВИЙ (обход 04.09). «Записать результат» —
                ежедневное действие цеха, «Завершить этап» — необратимое
                и на весь тираж. Главной кнопкой стояло ВТОРОЕ: самая заметная
                цель на экране закрывала этап, а сдача дневной выработки
                выглядела второстепенной. Правило то же, что у опасных действий
                в остальном разделе — обычная работа впереди, необратимая
                рядом и спокойнее.
              */}
              {perms.progress && fileResult && (
                <StageResultFile order={order} item={item} stage={stage} canUpload />
              )}
              {perms.progress && !fileResult && (hasReportSchema ? (
                !reportMode && (
                  <Button variant="primary" icon="plus" onClick={() => setReportMode(true)}>
                    Записать результат
                  </Button>
                )
              ) : (
                <>
                  {/*
                    `max` СНЯТ (правка 12.09, п. 5): цех выпускает сверх тиража,
                    и браузер запрещал ввести настоящее число — «плюсы»
                    не доходили бы до системы вовсе. Остаток остаётся
                    ПОДСКАЗКОЙ в плейсхолдере и в имени поля: он отвечает
                    на «сколько ещё ждут», а не «сколько разрешено».
                  */}
                  <input
                    type="number"
                    min="1"
                    className={`${styles.input} ${styles.qtySmallInput}`}
                    value={doneQty}
                    onChange={(e) => setDoneQty(e.target.value)}
                    placeholder={`из ${remaining}`}
                    aria-label={`Сколько сделано, шт (осталось ${remaining} из ${item.qty})`}
                  />
                  <Button
                    variant="primary"
                    icon="plus"
                    loading={busy}
                    disabled={busy || !(Number(doneQty) > 0)}
                    onClick={() => run(async () => {
                      await onProgress(entry, Math.max(1, Number(doneQty) || 0));
                      setDoneQty('');
                    })}
                  >
                    Записать результат
                  </Button>
                </>
              ))}
              {perms.complete && !reportMode && (
                <Button
                  variant="secondary"
                  loading={busy}
                  /* Файл — единственный результат этого этапа (решение
                     владельца): закрытый пустым, он оставил бы вышивальщицу
                     без программы, и выяснилось бы это уже в цехе */
                  disabled={busy || (fileResult && resultFiles.length === 0) || Boolean(programBlock)}
                  onClick={() => run(() => onDone(entry))}
                >
                  <Icon name="check" size={14} /> Завершить этап
                </Button>
              )}
              {fileResult && resultFiles.length === 0 && (
                <span className={styles.subText}>
                  Приложите файл программы — без него этап не закрыть.
                </span>
              )}
              {programBlock && <span className={styles.subText}>{programBlock}</span>}
              {!blockMode && !defectMode && (
                <>
                  {/*
                    БРАКА У ФАЙЛОВОГО РЕЗУЛЬТАТА НЕТ (правка 13.09, п. 9):
                    «этап не производит изделия и не должен учитывать тираж,
                    выполненное количество, остаток, брак или плюсы». Мастер
                    брака спрашивает количество штук и возвращает их
                    предыдущему цеху — у разработки программы возвращать
                    нечего, программу просто перезаливают файлом.
                  */}
                  {perms.defect && !fileResult && (
                    <Button variant="ghost" onClick={() => setDefectMode(true)}>
                      <Icon name="undo" size={14} /> Брак
                    </Button>
                  )}
                  {perms.block && (
                    <Button variant="ghost" onClick={() => setBlockMode(true)}>
                      <Icon name="ban" size={14} /> Проблема
                    </Button>
                  )}
                  {/*
                    Пропуск — аварийный выход для застрявшего маршрута, поэтому
                    стоит последним и требует причины. Право `order.manage`:
                    решение принимает тот, кто ведёт заказ, а не цех.
                  */}
                  {perms.skip && !reportMode && (
                    <Button variant="ghost" loading={busy} disabled={busy} onClick={() => run(() => onSkip(entry))}>
                      <Icon name="chevronRight" size={14} /> Пропустить этап
                    </Button>
                  )}
                  {/*
                    ЗАВЕРШИТЬ ПРИНУДИТЕЛЬНО (правка 20.09, п. 5) — рядом
                    с пропуском и после него: это соседние аварийные выходы,
                    и разница между ними смысловая. Пропуск говорит «операции
                    НЕ БЫЛО», принудительное завершение — «операция была,
                    но этап не проходит проверок, которых при заведении заказа
                    ещё не существовало».

                    Право своё (`stage.force_complete`), по умолчанию только
                    у директора, и проверяется оно ещё и на сервере — сама RPC
                    и страж этапов. Скрытой кнопки мало: путь через REST
                    остаётся открытым для любого участника.
                  */}
                  {perms.forceComplete && !reportMode && (
                    <Button
                      variant="ghost"
                      loading={busy}
                      disabled={busy}
                      onClick={() => run(() => onForceComplete(entry))}
                    >
                      <Icon name="check" size={14} /> Завершить принудительно
                    </Button>
                  )}
                </>
              )}
            </>
          )}
          {canMoveDept && moveTargets.length > 0 && !reportMode && (
            <MoveStageSelect entry={entry} targets={moveTargets} busy={busy} run={run} moveStageTo={moveStageTo} />
          )}
          {group === 'done' && perms.defect && !defectMode && (
            <Button variant="ghost" onClick={() => setDefectMode(true)}>
              <Icon name="undo" size={14} /> Брак / переделка
            </Button>
          )}
          {group === 'blocked' && perms.block && (
            <Button variant="secondary" loading={busy} disabled={busy} onClick={() => run(() => onUnblock(entry))}>
              Снять блокировку
            </Button>
          )}
        </div>
      )}

      {perms.progress && group === 'in_progress' && !reportMode && reportDept?.result_detail === 'rolls'
        && <TaskRollsInWork entry={entry} disabled={busy} /> /* QA 09.10: рядом с «Завершить этап» */}

      {perms.progress && reportMode && !fileResult && (
        <StageReportForm
          entry={entry}
          dept={reportDept}
          busy={busy}
          /**
           * Брак и переделка — своё право: страж этапов проверяет `qty_rework`
           * отдельно от `qty_done`. Без этого поле «В переделку» показывалось
           * и роли без `stage.defect`, а сохранение падало 42501 целиком —
           * вместе с уже введённым «сшито».
           */
          canDefect={perms.defect}
          onCancel={() => setReportMode(false)}
          onSubmit={(payload) => run(async () => {
            const ok = await submitStageReport(stage.id, payload);
            if (ok) setReportMode(false);
            return ok;
          })}
        />
      )}

      {perms.block && blockMode && (
        <div className={styles.queueBlockForm}>
          <DictionaryChips
            items={blockReasons}
            label="Частые причины блокировки"
            onPick={(v) => setBlockText((t) => (t.trim() ? `${t.trim()}, ${v}` : v))}
          />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Что мешает *</span>
            <input
              className={styles.input}
              placeholder="брак кроя, нет ниток…"
              value={blockText}
              onChange={(e) => setBlockText(e.target.value)}
              autoFocus
            />
          </label>
          <PhotoAttach file={blockPhoto} onFile={setBlockPhoto} label="Фото (необязательно)" />
          <Button
            variant="danger"
            loading={busy}
            disabled={busy || !blockText.trim()}
            onClick={() => run(async () => {
              await onBlock(entry, blockText.trim(), blockPhoto);
              setBlockMode(false);
              setBlockText('');
              setBlockPhoto(null);
            })}
          >
            Заблокировать
          </Button>
          <Button variant="ghost" onClick={() => { setBlockMode(false); setBlockPhoto(null); }}>
            Отмена
          </Button>
        </div>
      )}

      {perms.defect && defectMode && (
        <DefectWizard
          entry={entry}
          deptShortById={deptShortById}
          normDaysByDept={normDaysByDept}
          problemTypes={problemTypes}
          busy={busy}
          onSubmit={submitDefect}
          onClose={() => setDefectMode(false)}
        />
      )}
    </>
  );
}
