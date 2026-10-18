import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { stageInputQty } from '../utils/stageInput';
import { reportedAccountedBySize, reportedDefect, stageUnaccounted } from '../utils/stageRemaining';
import { overPlanBlock, overPlanConfirm, stageQtyCap } from '../utils/stageOverPlan';
import { confirm } from '../../store/useConfirmStore';
import { useErpStore } from '../store/useErpStore';
import { SizeReportSection } from './SizeReportSection';
import { useStageReports } from './useStageReports';
import { CutResultTable } from '../screens/queue/CutResultTable';
import { CutUsageSection } from '../screens/queue/CutUsageSection';
import { CutTotalsBar } from '../screens/queue/CutTotalsBar';
import { useCutReport } from '../screens/queue/useCutReport';
import { useForeignRolls } from './useForeignRolls';
import {
  sizeInputCells, sizeInputFor, sizeInputRows, sizeLedger, sizeReportBlock, sizeTotals,
  sizeReportPayload,
} from '../utils/stageSizes';
import { rollsForItem } from '../utils/cutRolls';
import { reportedSizesOf } from '../utils/cutExtras';
import styles from '../erp.module.css';

/**
 * Отчёт цеха о результате работы (правки заказчика 10.08, P2).
 *
 * Документ: «Каждый этап должен завершаться внесением количественного
 * результата: сколько принято, сколько сделано, сколько брака, сколько
 * передано дальше. Набор полей у разных участков разный».
 *
 * Поля берутся из `department.result_fields` — схема живёт в данных, а не
 * в коде. Пусто = участок отчёта не требует, и форма не рисуется вовсе:
 * fail-open, потому что новый участок, заведённый директором, не должен
 * оказаться без возможности отчитаться.
 *
 * «Принято в работу» — не хранимое поле, а выход предыдущего этапа
 * (`utils/stageInput`, минимум по параллельным веткам). Показываем его сверху
 * и уносим снимком в журнал: цех должен видеть, из какого числа он исходит.
 */
export function StageReportForm({ entry, dept, busy, onSubmit, onCancel, canDefect = true }) {
  const { order, item, stage } = entry;

  /**
   * ДЕТАЛИЗАЦИЯ РЕЗУЛЬТАТА — СВОЙСТВО УЧАСТКА В ДАННЫХ (правки 16.09, пп. 4, 6).
   *
   * `result_detail = 'rolls'` (закрой) добавляет разбор по рулонам: с какого
   * кроили, сколько ткани ушло, сколько изделий каждого размера вышло.
   * Никакого `code === 'cutting'`: рядом уже живут `result_fields`
   * и `gate_material_kinds`, и правило проекта запрещает держать в коде
   * константы вида «ткань → закрой».
   */
  const byRolls = dept?.result_detail === 'rolls';
  /**
   * РЕЗУЛЬТАТ ПО РАЗМЕРАМ (правка 16.09, п. 6). У швейки колонка «Принято
   * из закроя» подтягивается из фактического результата предыдущего этапа —
   * мастер её не вводит. Признак участка тот же самый, что у рулонов,
   * и живёт он в данных (`erp_departments.result_detail`).
   */
  /**
   * РАЗМЕРНАЯ ВЕТКА БОЛЬШЕ НЕ ЗАВИСИТ ОТ СЕТКИ ПОЗИЦИИ (правка 20.09, п. 8).
   *
   * Условие `&& item.size_grid?.length > 0` означало: у позиции, заведённой
   * без размерной сетки, швейка сдаёт результат одним числом, а поля
   * «Стоимость сборки единицы» нет вовсе — оно живёт внутри этой же ветки.
   * Ровно это заказчик и описал: «результат сдаётся общим количеством…
   * в форме нет поля для стоимости сборки единицы». Сетки нет у 21 позиции
   * из 49, и проверял он на такой.
   *
   * Теперь размеры берутся из сетки, когда она есть, и из ФАКТА ЗАКРОЯ,
   * когда её нет («Размеры и количество „Покроено, шт" должны подтягиваться
   * из этапа закройки»).
   */
  const bySizes = dept?.result_detail === 'sizes';

  /**
   * ФОРМА СДАЧИ ТРЕБУЕТ ПОЛНЫЙ ЗАКАЗ (правка 21.09, пп. 2, 3, 4).
   *
   * Списочная выборка (`ORDER_LIST_SELECT`) намеренно тоньше карточки:
   * из неё выброшена `items.size_grid`, а рулоны в неё не входили никогда.
   * Форму сдачи при этом открывают из очереди цеха, то есть с ЛИСТОВЫМИ
   * данными, и обе недостающие вещи приезжали `undefined` — молча, без
   * единой ошибки:
   *
   *   · размерная сетка позиции не находилась, закрой предлагал стандартную
   *     шкалу и писал «у позиции нет размерной сетки» на позиции, где она
   *     заполнена (пп. 3 и 4 документа);
   *   · `material.rolls` пуст → `rollsForItem` возвращает пустой список,
   *     и при одной заполненной строке загоралось «Все принятые рулоны уже
   *     в списке» (п. 2 — «после добавления одного рулона система ошибочно
   *     считает, что все принятые рулоны уже в списке»).
   *
   * Поэтому заказ ДОЗАГРУЖАЕТСЯ, а не возвращается в списочную выборку:
   * сетку читает одна эта форма, а список возят все экраны раздела разом.
   * Рулоны в список всё же вернулись — их на всю базу четыре десятка строк,
   * и без них карточка очереди не знает, есть ли с чего кроить.
   */
  const needsDetail = byRolls || bySizes;
  const loadOne = useErpStore((st) => st.loadOne);
  const hasDetail = useErpStore((st) => st.detailIds.includes(order.id));
  /** Свежий заказ из стора: `entry.order` — снимок, сделанный до дозагрузки */
  const fullOrder = useErpStore((st) => st.orders.find((o) => o.id === order.id)) ?? order;
  const fullItem = useMemo(
    () => (fullOrder.items ?? []).find((it) => it.id === item.id) ?? item,
    [fullOrder, item],
  );
  useEffect(() => {
    if (needsDetail && !hasDetail) loadOne(order.id);
  }, [needsDetail, hasDetail, loadOne, order.id]);

  const [sizeValues, setSizeValues] = useState({});
  /**
   * Стоимость сборки стартует ЗАПИСАННОЙ (правка 05.10, п. 3: «должна
   * сохраняться после закрытия формы»). Прежде поле открывалось пустым,
   * а записанное жило серой подсказкой. Деталь заказа могла приехать позже
   * открытия формы — тогда значение подставляется, пока поле не трогали.
   */
  const savedCost = fullItem.assembly_cost_per_unit;
  const [assemblyCost, setAssemblyCost] = useState(savedCost ? String(savedCost) : '');
  const [costTouched, setCostTouched] = useState(false);
  useEffect(() => {
    if (!costTouched && savedCost) setAssemblyCost(String(savedCost));
  }, [savedCost, costTouched]);
  /**
   * Отчёты предков (столбец «Покроено» сквозь нанесение, правка 27.09, п. 6)
   * и свои прежние (плюсы, остаток по размерам и «Осталось сдать», п. 7) —
   * хук `useStageReports`; здесь только их производные.
   */
  // Этапы — из свежей позиции (снимок очереди мог отстать); в useMemo, чтобы `?? []` не сбивал мемоизацию
  const stages = useMemo(() => fullItem.stages ?? item.stages ?? [], [fullItem.stages, item.stages]);
  const { prevReports, ownReports } = useStageReports(stage, stages, bySizes);
  // Завершение рулона — отдельное окно у рулона, не часть записи (05.10, п. 5)
  const finishRoll = useErpStore((st) => st.finishRoll);
  /** Параметры рулона без метража — дозаполняются прямо в блоке сдачи (27.09, п. 4) */
  const setRollParams = useErpStore((st) => st.setRollParams);
  const reportedSizes = useMemo(() => reportedSizesOf(ownReports), [ownReports]);
  // Только СВОИ отчёты: выборка по id и так своя, но сумма обязана не зависеть от того
  const accountedBySize = useMemo(() => reportedAccountedBySize(ownReports, stage.id), [ownReports, stage.id]);
  const defectReported = useMemo(() => reportedDefect(ownReports, stage.id), [ownReports, stage.id]);
  const ledger = useMemo(() => sizeLedger(ownReports, stage.id), [ownReports, stage.id]);

  const sizeInput = useMemo(
    () => (bySizes ? sizeInputFor(stage, stages, prevReports) : null),
    [bySizes, stage, stages, prevReports],
  );
  const sizeFromPrev = useMemo(
    () => (bySizes ? sizeInputCells(stage, stages, prevReports) : []),
    [bySizes, stage, stages, prevReports],
  );
  const sizeRows = useMemo(
    () => (bySizes
      ? sizeInputRows(fullItem.size_grid, sizeInput, sizeFromPrev, accountedBySize, ledger)
      : []),
    [bySizes, fullItem.size_grid, sizeInput, sizeFromPrev, accountedBySize, ledger],
  );
  /**
   * ТАБЛИЦА ЕСТЬ ТОЛЬКО ТОГДА, КОГДА ЕСТЬ СТРОКИ (правка 20.09, п. 8).
   *
   * Строки берутся из сетки позиции либо из факта закроя. Когда нет ни того,
   * ни другого (закрой ещё ничего не сдал, сетку не завели), участок сдаёт
   * результат обычными полями — иначе мастер остался бы вообще без полей:
   * `fields` при размерной ветке оставляет только `extra`.
   */
  const useSizeTable = bySizes && sizeRows.length > 0;
  const sizeSums = useMemo(() => sizeTotals(sizeRows, sizeValues), [sizeRows, sizeValues]);
  const sizeBlock = useSizeTable ? sizeReportBlock(sizeRows, sizeValues) : null;
  /**
   * Стоимость сборки обязательна, ПОКА её у позиции нет (документ называет
   * поле обязательным). Когда она уже записана, спрашивать её на каждой
   * частичной сдаче незачем — «обязательное» превратилось бы в «вводите
   * одно и то же каждый день».
   */
  const needsCost = bySizes && !savedCost && assemblyCost === '';
  /** Рулоны позиции и остатки других заказов (правка 28.09): их же показывает секция */
  const { rolls: foreignRolls, reload: reloadForeign } = useForeignRolls(order.id, byRolls);
  const rollOptions = useMemo(
    () => (byRolls
      ? rollsForItem(fullOrder?.materials, fullItem?.id, [], foreignRolls)
      : []),
    [byRolls, fullOrder, fullItem, foreignRolls],
  );
  /** Закрой (правки 19.10): «Результат кроя» один раз + режимы рулонов «Расхода ткани» */
  const cut = useCutReport({ stage, order: fullOrder, item: fullItem, options: rollOptions, reported: reportedSizes });

  /**
   * Поля, пишущие в БРАК и ПЕРЕДЕЛКУ, требуют своего права.
   *
   * Форма целиком гейтилась одним `stage.progress`, а страж этапов разбирает
   * изменение по колонкам: `qty_rework` он проверяет отдельно, под
   * `stage.defect`. Матрица прав редактируема — стоит снять у роли «Оформлять
   * брак», и человек по-прежнему видел поле «В переделку», заполнял его
   * и получал 42501 на сохранении. Ни одно число при этом не записывалось,
   * а тост говорил про права вообще — запрещённое «кнопка есть, действие
   * падает», причём в самой частой форме цеха.
   *
   * Поля не прячем совсем, а убираем из НАБОРА: у участка их может быть два
   * в одну колонку, и «сшито» без «в переделку» — рабочий отчёт, а не урезанный.
   */
  const fields = useMemo(
    () => {
      const all = Array.isArray(dept?.result_fields) ? dept.result_fields : [];
      const visible = canDefect
        ? all
        : all.filter((f) => f.target !== 'qty_rework' && f.target !== 'qty_defect');
      /**
       * При разборе по рулонам поле «Скроено» уходит: то же число считается
       * из таблиц раскроя, и два писателя разошлись бы на первой опечатке.
       * Брак и переделка остаются — они к рулонам не привязаны.
       */
      if (byRolls) return visible.filter((f) => f.target !== 'qty_good');
      /**
       * При размерной таблице одиночные «Сшито / Брак / В переделку» уходят:
       * документ просит заменить их таблицей, а держать оба набора значило бы
       * два писателя одних и тех же трёх чисел.
       */
      if (useSizeTable) return visible.filter((f) => f.target === 'extra');
      return visible;
    },
    [dept, canDefect, byRolls, useSizeTable],
  );
  const qtyIn = useMemo(
    () => stageInputQty(stage, stages, item.qty),
    [stage, stages, item.qty],
  );
  /**
   * «Осталось сдать» — по учтённому (правка 27.09, п. 7): потолок минус
   * сдано минус окончательный брак. Формула одна с сервером
   * (`erp_stage_unaccounted`), и после сдачи 368 из 472 здесь 104.
   */
  const remaining = useMemo(
    () => stageUnaccounted({
      stage, allStages: stages, itemQty: item.qty, defectReported,
    }),
    [stage, stages, item.qty, defectReported],
  );
  /**
   * ПОТОЛОК ФАКТА (правка 12.09, вторая порция, п. 4): «плюсы» появляются
   * только на закрое, дальше сдать больше переданного нельзя. `null` —
   * потолка нет (участок с `allows_over_plan`).
   *
   * Числа `qtyIn`/`remaining` стояли здесь и раньше, но ТОЛЬКО в подсказке:
   * у поля ввода не было даже атрибута `max`, и сдать можно было любое число.
   */
  const cap = useMemo(
    () => stageQtyCap(stage, stages, item.qty, dept),
    [stage, stages, item.qty, dept],
  );

  const [values, setValues] = useState({});
  const [comment, setComment] = useState('');

  const num = (code) => {
    const raw = values[code];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };

  /** Суммируем по НАЗНАЧЕНИЮ: у участка может быть два поля в одну колонку */
  const totals = useMemo(() => {
    const acc = { qty_good: 0, qty_defect: 0, qty_rework: 0, qty_extra: 0 };
    const extra = {};
    for (const f of fields) {
      const n = num(f.code);
      if (f.target === 'extra') {
        if (values[f.code] !== undefined && values[f.code] !== '') extra[f.code] = n;
      } else if (acc[f.target] !== undefined) {
        acc[f.target] += n;
      }
    }
    return { ...acc, extra };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, values]);

  /**
   * Числа берутся из размерной таблицы, только когда она РИСУЕТСЯ
   * (`useSizeTable`). У участка с `result_detail = 'sizes'`, но без строк
   * таблицы, суммы по ней нулевые — и сдать результат стало бы нечем:
   * обычные поля при этом остаются на месте (см. `fields`).
   */
  const goodQty = byRolls ? cut.goodTotal : (useSizeTable ? sizeSums.good : totals.qty_good);
  const defectQty = useSizeTable ? sizeSums.defect : totals.qty_defect;
  const reworkQty = useSizeTable ? sizeSums.rework : totals.qty_rework;

  const anything = goodQty + defectQty + reworkQty + totals.qty_extra > 0;
  const needsComment = defectQty > 0 || reworkQty > 0;
  const missingRequired = fields.some((f) => f.required && num(f.code) <= 0);
  const overBlock = overPlanBlock(goodQty, stage, stages, item.qty, dept);

  // Двойной тап до перерисовки видит прежний `busy` — не спишет метры дважды
  const inFlight = useRef(false);
  /** Вопросы перед сдачей: `true` сразу, если спрашивать нечего; `false` — есть что поправить */
  const confirmed = () => {
    // Закрой: ошибки рулонов — сводкой и фокусом на первое поле, не молчаливой серой кнопкой
    if (byRolls && cut.attempt() > 0) { cut.firstErrorRef.current?.focus(); return false; }
    /** Р7: выпуск без отмеченного рулона — подтверждение, не блок */
    if (byRolls && goodQty > 0 && rollOptions.length > 0 && cut.payload.rolls.length === 0) {
      return confirm({
        title: 'Сдать без списания ткани?',
        message: 'Ни один рулон не отмечен как использованный — метры не спишутся со склада.',
        confirmLabel: 'Сдать без списания',
        cancelLabel: 'Отметить рулоны',
      }).then((ok) => {
        // После закрытия диалог возвращает фокус на кнопку — переводим его следом
        if (!ok) setTimeout(() => cut.firstGroupRef.current?.focus(), 0);
        return ok && overPlanAsked();
      });
    }
    return overPlanAsked();
  };
  /**
   * ПРЕВЫШЕНИЕ НА ЗАКРОЕ СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ (решение владельца):
   * потолка у закроя нет, но опечатка «1000» вместо «100» поднимает потолок
   * всем последующим этапам и снимает защиту, ради которой правка делается.
   * Разница называется числом — «превышение» без цифры проверить нечем.
   */
  const overPlanAsked = () => {
    const warn = overPlanConfirm(goodQty, stage, item.qty, dept);
    return !warn || confirm({ title: 'Сдать больше тиража?', message: warn, confirmLabel: 'Сдать' });
  };
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true; // и на время вопросов: второй тап не откроет второй диалог
    const asked = confirmed();
    if (asked !== true && !(await asked)) { inFlight.current = false; return; }
    const ok = await onSubmit({
      qtyIn,
      qtyGood: goodQty,
      qtyDefect: defectQty,
      qtyRework: reworkQty,
      qtyExtra: totals.qty_extra,
      comment,
      extra: totals.extra,
      /**
       * Закрой (правки 19.10, Р5): годные — таблицей «Результат кроя» один
       * раз, рулоны — только отмеченные, без размеров. `qty_good` выше
       * выведен из той же таблицы — разойтись им не с чего.
       */
      ...(byRolls ? cut.payload : {}),
      ...(bySizes
        ? {
          // Строки уезжают, только если таблица рисовалась: пустой список
          // ничего не портит, но и притворяться размерным фактом не должен
          sizes: useSizeTable ? sizeReportPayload(sizeRows, sizeValues) : [],
          /**
           * Стоимость сборки — ОДНА на позицию, а не по размерам (документ:
           * «мастер указывает один раз на всю позицию»). Пустое поле не
           * стирает уже записанное: сервер применяет только присланное.
           */
          assemblyCost: assemblyCost === '' ? null : Number(assemblyCost),
        }
        : {}),
    });
    inFlight.current = false;
    // Сдача списала метры — остатки других заказов перечитываются (05.10, п. 5)
    if (ok && byRolls) reloadForeign();
  };

  const actions = (
    <>
      <Button
        variant="primary"
        disabled={busy || !anything || missingRequired || Boolean(overBlock)
          || Boolean(sizeBlock) || needsCost || (needsComment && !comment.trim())}
        onClick={submit}
      >
        <Icon name="check" size={14} /> Сдать результат
      </Button>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>Отмена</Button>
    </>
  );

  return (
    <div className={styles.queueBlockForm}>
      <span className={styles.queueReason}>
        <span className={styles.cellWithIcon}>
          <Icon name="box" size={14} />
          Принято в работу: <b>{qtyIn}</b> шт
          {qtyIn !== item.qty && <span className={styles.subText}> (тираж {item.qty})</span>}
          {remaining > 0 && <span className={styles.subText}> · осталось сдать {remaining}</span>}
        </span>
      </span>

      {/*
        Секция ждёт ДОЗАГРУЗКУ заказа: до неё рулонов нет ни одного, и
        «Склад ещё не принял рулоны» было бы неправдой о живой поставке
      */}
      {byRolls && (hasDetail ? <CutResultTable cut={cut} disabled={busy} /> : (
        <p className={styles.queueReason} role="status">Подтягиваем принятые рулоны…</p>
      ))}

      {useSizeTable && (
        <SizeReportSection
          rows={sizeRows}
          values={sizeValues}
          onChange={(key, code, value) => setSizeValues((v) => ({
            ...v, [key]: { ...v[key], [code]: value },
          }))}
          canDefect={canDefect}
          disabled={busy}
        />
      )}

      {/*
        СТОИМОСТЬ СБОРКИ ЖИВЁТ СНАРУЖИ РАЗМЕРНОЙ ТАБЛИЦЫ (правка 20.09, п. 8).

        Раньше поле стояло внутри неё, и на позиции без размерной сетки
        таблица не рисовалась — а вместе с ней исчезало и поле. Заказчик
        описал это прямо: «в форме нет поля для стоимости сборки единицы».
        Величина при этом к размерам не относится вовсе: она «один раз
        на всю позицию».
      */}
      {bySizes && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Стоимость сборки за единицу, ₽{needsCost ? ' *' : ''}
          </span>
          <input
            type="number" min="0" step="0.01"
            className={`${styles.input} ${styles.qtySmallInput}`}
            value={assemblyCost}
            disabled={busy}
            onChange={(e) => { setCostTouched(true); setAssemblyCost(e.target.value); }}
            aria-label="Стоимость сборки за единицу"
          />
          <span className={styles.subText}>
            {fullItem.assembly_cost_per_unit
              ? `Записано по позиции: ${fullItem.assembly_cost_per_unit} ₽ за единицу`
              : 'Один раз на всю позицию, а не по размерам'}
          </span>
        </label>
      )}

      <div className={styles.planFormRow}>
        {fields.map((f) => (
          <label key={f.code} className={styles.field}>
            <span className={styles.fieldLabel}>
              {f.label}{f.required ? ' *' : ''}{f.unit ? `, ${f.unit}` : ''}
            </span>
            <input
              type="number"
              min="0"
              /* Потолок стоит и атрибутом: стрелки и мобильная клавиатура
                 не дадут набрать заведомо лишнее ещё до проверки */
              max={cap !== null && f.target === 'qty_good' ? cap : undefined}
              className={`${styles.input} ${styles.qtySmallInput}`}
              value={values[f.code] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.code]: e.target.value }))}
              aria-label={`${f.label}${f.unit ? `, ${f.unit}` : ''}`}
            />
          </label>
        ))}
      </div>

      {/*
        Комментарий обязателен при отклонении — то же правило стоит CHECK-ом
        в базе. Здесь оно не дублируется «на всякий случай», а объясняется
        человеку до отправки: узнать о нём из отказа сервера хуже.
      */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Комментарий{needsComment ? ' * (объясните отклонение)' : ''}
        </span>
        <input
          className={styles.input}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={needsComment ? 'что именно пошло не так' : 'необязательно'}
        />
      </label>

      {byRolls && hasDetail && (
        <CutUsageSection
          cut={cut} options={rollOptions} order={fullOrder} item={fullItem} stage={stage}
          extraRolls={foreignRolls} onFinishRoll={finishRoll} onRollParams={setRollParams} disabled={busy}
        />
      )}

      {/* Причина отказа названа ДО отправки: узнать о потолке из ответа
          сервера хуже, чем прочитать его рядом с полем */}
      {sizeBlock && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} /> {sizeBlock}
        </p>
      )}

      {overBlock && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} /> {overBlock}
        </p>
      )}

      {byRolls && hasDetail ? <CutTotalsBar cut={cut} options={rollOptions}>{actions}</CutTotalsBar>
        : <div className={styles.queueActions}>{actions}</div>}
    </div>
  );
}
