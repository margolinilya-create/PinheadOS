import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { confirmWithInput } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { devMoveIntent, devMovePrompt, devMoveRefusalText } from '../utils/devBoardMove';
import { devBrandingFromPrints, DEV_BRANDING_DEPT_CODE } from '../utils/experimentalBoard';
import { devOwnStageToClose, devStageRemainder } from '../utils/devOwnStage';

/**
 * ПЕРЕНОС КАРТОЧКИ РАЗРАБОТКИ — ОДНА РЕАЛИЗАЦИЯ НА ДОСКУ И НА СТРАНИЦУ.
 *
 * §3.6 обхода 04.09: со страницы разработки карточку нельзя было перенести
 * между колонками, хотя диалоги переноса обещают «перейдёт», а сама страница
 * с 22.08 — основное место работы технолога (шторку заказчик отверг). Всё
 * жило в `Experimental.jsx`: и закрытие покидаемого этапа, и вопрос о названии
 * лекал, и заведение задач нанесений.
 *
 * Здесь ровно тот же код, вынесенный целиком. Второй реализации быть не может:
 * порядок «закрыть свой этап → записать колонку → завести нанесения» держит
 * работу образцов, заведённых до 02.09, и повторение его на второй поверхности
 * разошлось бы молча — обе «работают», просто по-разному.
 *
 * `requestMove` — общий гейт: `devMoveIntent` решает, можно ли, и называет
 * причину отказа. Молча не сработавший перенос человек повторяет ещё трижды,
 * прежде чем решить, что сайт сломан.
 */
export function useDevStageMove() {
  const {
    experimental, orders, departments,
    updateExperimental, addDevTasks, sendDevTaskToDept, reportProgress,
  } = useErpStore(
    useShallow((s) => ({
      experimental: s.experimental,
      orders: s.orders,
      departments: s.departments,
      updateExperimental: s.updateExperimental,
      addDevTasks: s.addDevTasks,
      sendDevTaskToDept: s.sendDevTaskToDept,
      reportProgress: s.reportProgress,
    })),
  );

  const closeOwnStage = useCallback(async (dev, from) => {
    const order = orders.find((o) => o.id === dev.order_id);
    const item = (order?.items ?? []).find((it) => it.id === dev.item_id);
    if (!item) return;
    const target = devOwnStageToClose({ from, stages: item.stages, departments });
    if (!target) return;
    const rest = devStageRemainder(target, item.qty);
    if (rest > 0) {
      await reportProgress(target.id, rest, { comment: 'Этап закрыт переносом карточки ЭКС' });
    }
  }, [orders, departments, reportProgress]);

  const moveDevStage = useCallback(async (devId, stage) => {
    const dev = experimental.find((e) => e.id === devId);
    if (!dev) return false;
    const from = dev.board_stage ?? 'patterns';

    const prompt = devMovePrompt(from, stage, dev);
    if (prompt) {
      const { ok: confirmed, value } = await confirmWithInput({
        title: prompt.title,
        message: 'Название сохранится в карточке разработки и в финальном пакете.',
        confirmLabel: prompt.confirmLabel,
        prompt: { label: prompt.label, required: true, initialValue: prompt.initialValue },
      });
      if (!confirmed) return false;
      /**
       * Сперва название, потом колонка. Обратный порядок оставил бы карточку
       * в «Крое» с незаписанным названием — то есть этап, объявленный
       * завершённым, без своего результата.
       */
      const saved = await updateExperimental(devId, { [prompt.field]: value.trim() });
      if (!saved) return false;
    }

    /**
     * ПОРЯДОК ОБЯЗАТЕЛЕН — и остаётся обязательным ради РАЗРАБОТОК, ЗАВЕДЁННЫХ
     * ДО 02.09: сначала закрыть покидаемый собственный этап, потом писать
     * колонку и заводить работу нанесений. У таких образцов этап нанесения
     * стоит в маршруте и зависит от кроя (`depends_on = ['cutting']`), то есть
     * до его закрытия висит в `waiting` — цех такой работы не видит. Обратный
     * порядок привязал бы задачу разработки к невидимому этапу, и «Нанесения»
     * встали бы молча.
     *
     * У образцов, заведённых после 02.09, собственных этапов маршрута нет
     * вовсе (`BASE_CHAIN.samples` — одна закупка), и `closeOwnStage` для них
     * ничего не делает: `devOwnStageToClose` отвечает `null` — «закрывать
     * нечего», а не «забыли».
     */
    await closeOwnStage(dev, from);

    if (stage !== 'branding') return updateExperimental(devId, { board_stage: stage });

    /**
     * Виды нанесений и их порядок — из позиции заказа.
     *
     * НАНЕСЕНИЙ НЕТ — ШАГ ПРОПУСКАЕТСЯ (прежнее поведение пустого выбора,
     * п. 4.2 от 24.08: «если нанесения не нужны, технолог переносит карточку
     * сразу из Кроя в Пошив»). Оставить карточку в пустых «Нанесениях»
     * значило бы завести стоянку, из которой человека никто не позовёт:
     * автопереход считает закрытие задач, а их нет.
     */
    const item = orders
      .flatMap((o) => o.items ?? [])
      .find((it) => it.id === dev.item_id);
    const types = devBrandingFromPrints(item?.prints);
    if (types.length === 0) {
      return updateExperimental(devId, { board_stage: 'sewing' });
    }

    /**
     * ПОРЯДОК ОСОЗНАННЫЙ: сначала колонка, потом задачи. Перенос — то, что
     * человек нажал, и он обязан состояться; при сбое на задачах карточка
     * стоит в «Нанесениях» с пустой дорожкой «Ожидает» — состояние видимое
     * и поправимое. Обратный порядок дал бы задачи в цехах при карточке,
     * оставшейся в «Крое»: работа идёт, а на доске её нет.
     *
     * Одной транзакцией это не делается и не должно: `erp_experimental_add_tasks`
     * заводит задачи атомарно сам, а отправка в цех — отдельное действие
     * над каждой задачей, у которого свои права и свой отказ.
     *
     * Уже заведённые виды не дублируются: повторный вход в «Нанесения»
     * (например, после отката назад) не должен второй раз слать ту же
     * работу в цех.
     */
    const ok = await updateExperimental(devId, { board_stage: 'branding' });
    if (!ok) return false;

    const existing = new Set((dev.tasks ?? []).map((t) => t.task_type));
    const fresh = types.filter((t) => !existing.has(t));
    if (fresh.length === 0) return true;

    const created = await addDevTasks(
      devId,
      fresh.map((t, i) => ({ task_type: t, sort_order: 100 + i * 10 })),
    );
    for (const task of created ?? []) {
      const dept = departments.find(
        (d) => d.code === DEV_BRANDING_DEPT_CODE[task.task_type]);
      if (dept) await sendDevTaskToDept(task.id, { department_id: dept.id });
    }
    return true;
  }, [experimental, orders, updateExperimental, addDevTasks, sendDevTaskToDept,
    departments, closeOwnStage]);

  /**
   * Гейт переноса: можно ли и, если нет, почему. Контекст (`materialsPending`,
   * `hasBranding`, `brandingOpen`) считает поверхность — у доски он приезжает
   * в строке, у страницы собирается из заказа.
   */
  const requestMove = useCallback(async (ctx, to) => {
    const intent = devMoveIntent({ ...ctx, to });
    if (!intent.ok) {
      // «Карточка уже здесь» — не ошибка, а обычный исход броска мимо
      if (intent.reason !== 'same') toast.error(devMoveRefusalText(intent));
      return false;
    }
    return moveDevStage(ctx.devId, intent.to);
  }, [moveDevStage]);

  return { moveDevStage, requestMove };
}
