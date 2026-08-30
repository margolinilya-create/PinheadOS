import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { currentActor } from '../../store/shared';
import { deptShortName } from '../../data/departments';
import { confirmStageDone, stageCompletionBlock } from '../../utils/stageDone';
import { materialsForItem } from '../../utils/routes';
import { confirmWithInput } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';

/**
 * Действия цеха над заданием: взять в работу, записать результат, проблема,
 * завершить этап, брак. Вынесены из DepartmentQueue, чтобы очередь, строка очереди
 * и страница производственного задания вызывали одно и то же (правки 5 и 8).
 *
 * «Взять в работу» закрепляет задание за исполнителем (erp_item_stages.assignee) —
 * колонка была в схеме с первой фазы, но никогда не заполнялась.
 *
 * Каждое действие подтверждается тостом успеха. Раньше цех работал вслепую:
 * `toast.success` во всём ERP вызывался 6 раз и ни разу — на действии этапа.
 * При этом задание после «Завершить» ИСЧЕЗАЕТ из списка (блок «Завершено
 * недавно» по умолчанию свёрнут), а при сбое оптимистичное состояние
 * откатывается — и строка тоже пропадает. Обе ветки выглядели одинаково,
 * и отличить «сохранилось» от «не сохранилось» было нельзя.
 */

/** Цеха, которые откроются после закрытия этапа — для текста подтверждения */
function dependentDeptNamesFactory(deptNameById) {
  return (entry) => entry.item.stages
    .filter((st) => st.depends_on.includes(entry.stage.id))
    .map((st) => deptNameById.get(st.department_id) || 'следующий этап');
}

export function useStageActions() {
  const {
    departments, setStageStatus, setStagePlan, reportProgress, reportDefect,
    uploadOrderAttachment, ackStageOverdue,
  } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      setStageStatus: s.setStageStatus,
      setStagePlan: s.setStagePlan,
      reportProgress: s.reportProgress,
      reportDefect: s.reportDefect,
      uploadOrderAttachment: s.uploadOrderAttachment,
      ackStageOverdue: s.ackStageOverdue,
    })),
  );
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );
  const dependentDeptNames = useMemo(() => dependentDeptNamesFactory(deptNameById), [deptNameById]);

  /**
   * Взять в работу: закрепление за исполнителем + план завершения.
   *
   * ПОРЯДОК ЗАПИСЕЙ ОБРАТНЫЙ ПРЕЖНЕМУ (правка заказчика 30.08, п. 9).
   * Раньше первым уходил план, и падение второго запроса оставляло дату
   * у этапа, который никуда не запустился, — а рабочий видел, что «ничего
   * не произошло». Теперь главное действие идёт первым, а план пишется
   * только после его успеха: то же правило, что у возврата брака — план
   * это НАМЕРЕНИЕ, и неудача не должна оставлять его у незапущенного этапа.
   *
   * Неудача самого плана взятие в работу не отменяет и тостом не кричит:
   * причину уже назвал `erpError` слайса, а этап в работе — состояние
   * верное. Дату можно поставить в карточке заказа.
   */
  const onStart = useCallback(async (entry, plannedEnd) => {
    const ok = await setStageStatus(entry.stage.id, 'in_progress', { assignee: currentActor() });
    if (!ok) return false;
    if (plannedEnd) await setStagePlan(entry.stage.id, { planned_end: plannedEnd });
    toast.success(`Взято в работу: ${entry.item.product_type || 'позиция'} · ${entry.item.qty} шт`);
    return true;
  }, [setStagePlan, setStageStatus]);

  /**
   * «Готово» без числа — закрыть этап целиком.
   * Пишет весь тираж, поэтому при незакрытом остатке сперва спрашиваем: иначе
   * «сдал 40 из 100 → нажал Завершить» тихо превращалось в 100 сданных штук
   * и открывало следующий цех на количество, которого физически нет.
   */
  const onDone = useCallback(async (entry) => {
    const ok = await confirmStageDone({
      stage: entry.stage,
      qty: entry.item.qty,
      allStages: entry.item.stages,
      deptNameById,
      // Гейт закупки (правка 30.08, п. 5): материалы ПОЗИЦИИ и цех этапа
      materials: materialsForItem(entry.order.materials, entry.item.id),
      dept: departments.find((d) => d.id === entry.stage.department_id),
    });
    if (!ok) return false;
    const saved = await setStageStatus(entry.stage.id, 'done', { qty_done: entry.item.qty });
    // Называем количество и следующий цех: задание уходит из списка, и это
    // единственный след того, что именно записано
    if (saved) {
      const next = dependentDeptNames(entry);
      toast.success(next.length > 0
        ? `Этап завершён: ${entry.item.qty} шт · открыт ${next.join(', ')}`
        : `Этап завершён: ${entry.item.qty} шт`);
    }
    return saved;
  }, [setStageStatus, deptNameById, dependentDeptNames, departments]);

  /**
   * «Частично» — накопительный прогресс qty_done += N.
   *
   * ГЕЙТ ЗАКУПКИ СТОИТ И ЗДЕСЬ (правка 30.08, п. 5), и это не перестраховка:
   * `erp_stage_report_progress` при `qty_done >= qty` САМ ставит этапу
   * `status = 'done'`. То есть «Записать результат» на весь остаток —
   * четвёртый путь закрытия этапа, и без гейта закрой закрывался бы при
   * неприехавшей ткани ровно так же, как через «Завершить этап», только
   * молча. Комментарий в `StageActionsPanel` это давно признаёт («кнопка
   * молча делала то же, что „Завершить этап“»), но гейт туда не доходил.
   *
   * Проверяем ТОЛЬКО когда запись реально добирает тираж: частичная сдача
   * при неприехавшем материале законна — цех отчитывается за то, что сделал.
   */
  const onProgress = useCallback(async (entry, qty) => {
    const closesStage = (entry.stage.qty_done ?? 0) + qty >= entry.item.qty;
    if (closesStage) {
      const blocked = stageCompletionBlock({
        stage: entry.stage,
        qty: entry.item.qty,
        allStages: entry.item.stages,
        materials: materialsForItem(entry.order.materials, entry.item.id),
        dept: departments.find((d) => d.id === entry.stage.department_id),
      });
      if (blocked) {
        toast.error(blocked);
        return false;
      }
    }
    const ok = await reportProgress(entry.stage.id, qty);
    if (ok) {
      const done = (entry.stage.qty_done ?? 0) + qty;
      const left = Math.max(entry.item.qty - done, 0);
      // Остаток в тексте: рабочий вводит числа подряд и должен видеть,
      // сколько ещё числится за ним, не пересчитывая в уме
      toast.success(left > 0
        ? `Записано ${qty} шт · осталось ${left}`
        : `Записано ${qty} шт · этап закрыт`);
    }
    return ok;
  }, [reportProgress, departments]);

  const onBlock = useCallback(async (entry, reason, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Блокировка: ${reason}`);
    const ok = await setStageStatus(entry.stage.id, 'blocked', {
      block_reason: photoOk ? `${reason} (фото во вложениях)` : reason,
    });
    if (photo && !photoOk) toast.warning('Блокировка записана, но фото не загрузилось');
    else if (ok) toast.success('Проблема записана — задание остановлено');
    return ok;
  }, [setStageStatus, uploadOrderAttachment]);

  const onUnblock = useCallback(async (entry) => {
    const ok = await setStageStatus(entry.stage.id, 'waiting', { block_reason: null });
    if (ok) toast.success('Блокировка снята');
    return ok;
  }, [setStageStatus]);

  const onDefect = useCallback(async (entry, opts, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Брак: ${opts.reason}`);
    const ok = await reportDefect(entry.stage.id, {
      ...opts,
      reason: photoOk ? `${opts.reason} (фото во вложениях)` : opts.reason,
    });
    if (photo && !photoOk) toast.warning('Брак записан, но фото не загрузилось');
    return ok;
  }, [reportDefect, uploadOrderAttachment]);

  /**
   * «Пропустить этап» — точечный ответ на застрявший маршрут (правки 10.08).
   *
   * Заказчик просил аварийно снимать блокирующие механики. Для гейтов (материалы,
   * ТЗ, отгрузка) это отдельный режим в админке, а вот «этап ждёт предыдущий» —
   * не проверка, а сам маршрут: глобально отключать его нельзя, иначе запустится
   * всё сразу. Правильный масштаб здесь — один этап.
   *
   * Статус `skipped` в схеме был с самого начала и везде трактуется как пройденный
   * (готовность к отгрузке, зависимости, прогресс), но поставить его человеку было
   * НЕЧЕМ. Причина обязательна: пропуск — это решение, за которым завтра придут
   * с вопросом «почему цех не работал».
   */
  const onSkip = useCallback(async (entry) => {
    const deptName = deptNameById.get(entry.stage.department_id) || 'этап';
    const next = dependentDeptNames(entry);
    const { ok: confirmed, value: reason } = await confirmWithInput({
      title: `Пропустить «${deptName}»?`,
      message: next.length > 0
        ? `Этап станет пройденным, и откроется ${next.join(', ')}. Работа по нему записана не будет.`
        : 'Этап станет пройденным. Работа по нему записана не будет.',
      confirmLabel: 'Пропустить',
      variant: 'danger',
      prompt: {
        label: 'Причина пропуска (попадёт в историю заказа)',
        placeholder: 'напр. операция не нужна на этом заказе',
        required: true,
      },
    });
    if (!confirmed) return false;
    const ok = await setStageStatus(entry.stage.id, 'skipped', { comment: `Пропуск: ${reason}` });
    if (ok) toast.success('Этап отмечен пропущенным');
    return ok;
  }, [setStageStatus, deptNameById, dependentDeptNames]);

  return {
    onStart, onDone, onProgress, onBlock, onUnblock, onDefect, onSkip,
    onAckOverdue: ackStageOverdue,
  };
}
