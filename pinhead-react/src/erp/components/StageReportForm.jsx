import { useMemo, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { stageInputQty, stageRemainingQty } from '../utils/stageInput';
import { overPlanBlock, overPlanConfirm, stageQtyCap } from '../utils/stageOverPlan';
import { confirm } from '../../store/useConfirmStore';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { SizeResultTable } from './SizeResultTable';
import { CutRollsSection } from '../screens/queue/CutRollsSection';
import {
  sizeInputCells, sizeInputFor, sizeInputRows, sizeReportBlock, sizeTotals, sizeReportPayload,
  rowEntered,
} from '../utils/stageSizes';
import {
  cutBlock, cutRollsPayload, cutSizesPayload, cutTotals, rollsForItem,
} from '../utils/cutRolls';
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

  const [rollEntries, setRollEntries] = useState([]);
  const [sizeValues, setSizeValues] = useState({});
  const [assemblyCost, setAssemblyCost] = useState('');
  const [prevReports, setPrevReports] = useState([]);
  const [ownReports, setOwnReports] = useState([]);

  const loadStageReports = useErpStore(useShallow((st) => st.loadStageReports));

  /**
   * Отчёты предшественников — точечной загрузкой при открытии формы: журнал
   * результатов растёт быстрее всего, и возить его в выборке заказа ради
   * одной формы нельзя.
   */
  useEffect(() => {
    if (!bySizes) return undefined;
    let alive = true;
    const deps = stage.depends_on ?? [];
    if (deps.length === 0) return undefined;
    loadStageReports(deps).then((rows) => { if (alive) setPrevReports(rows); });
    return () => { alive = false; };
  }, [bySizes, stage.depends_on, loadStageReports]);

  /**
   * СОБСТВЕННЫЕ прежние отчёты этого этапа — для плюсов (правка 21.09, п. 3).
   *
   * Закрой сдаёт частями, и плюс считается накопительно: 30 шт сегодня
   * и 25 завтра при плане 50 — это плюс 5, а не два раза «меньше плана».
   * Сервер считает то же и по тем же строкам; здесь они нужны, чтобы цех
   * ВИДЕЛ плюс до нажатия кнопки, а не узнавал о нём из журнала.
   */
  useEffect(() => {
    if (!byRolls) return undefined;
    let alive = true;
    loadStageReports([stage.id]).then((rows) => { if (alive) setOwnReports(rows); });
    return () => { alive = false; };
  }, [byRolls, stage.id, loadStageReports]);
  const reportedSizes = useMemo(() => reportedSizesOf(ownReports), [ownReports]);

  const sizeInput = useMemo(
    () => (bySizes ? sizeInputFor(stage, item.stages ?? [], prevReports) : null),
    [bySizes, stage, item.stages, prevReports],
  );
  const sizeFromPrev = useMemo(
    () => (bySizes ? sizeInputCells(stage, item.stages ?? [], prevReports) : []),
    [bySizes, stage, item.stages, prevReports],
  );
  const sizeRows = useMemo(
    () => (bySizes ? sizeInputRows(fullItem.size_grid, sizeInput, sizeFromPrev) : []),
    [bySizes, fullItem.size_grid, sizeInput, sizeFromPrev],
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
  const needsCost = bySizes && !fullItem.assembly_cost_per_unit && assemblyCost === '';
  /** Рулоны, принятые складом по этой позиции: их же показывает секция */
  const rollOptions = useMemo(
    () => (byRolls
      ? rollsForItem(fullOrder?.materials, fullItem?.id, rollEntries.map((e) => e.rollId))
      : []),
    [byRolls, fullOrder, fullItem, rollEntries],
  );

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
    () => stageInputQty(stage, item.stages ?? [], item.qty),
    [stage, item],
  );
  const remaining = useMemo(
    () => stageRemainingQty(stage, item.stages ?? [], item.qty),
    [stage, item],
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
    () => stageQtyCap(stage, item.stages ?? [], item.qty, dept),
    [stage, item, dept],
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

  /** Выход раскроя считается из таблиц рулонов — это и есть «скроено» */
  const rollTotals = useMemo(() => cutTotals(rollEntries), [rollEntries]);
  const rollBlock = byRolls && rollEntries.length > 0
    ? cutBlock(rollEntries, rollOptions)
    : null;
  /**
   * Числа берутся из размерной таблицы, только когда она РИСУЕТСЯ
   * (`useSizeTable`). У участка с `result_detail = 'sizes'`, но без строк
   * таблицы, суммы по ней нулевые — и сдать результат стало бы нечем:
   * обычные поля при этом остаются на месте (см. `fields`).
   */
  const goodQty = byRolls ? rollTotals.qty : (useSizeTable ? sizeSums.good : totals.qty_good);
  const defectQty = useSizeTable ? sizeSums.defect : totals.qty_defect;
  const reworkQty = useSizeTable ? sizeSums.rework : totals.qty_rework;

  const anything = goodQty + defectQty + reworkQty + totals.qty_extra > 0;
  const needsComment = defectQty > 0 || reworkQty > 0;
  const missingRequired = fields.some((f) => f.required && num(f.code) <= 0);
  const overBlock = overPlanBlock(goodQty, stage, item.stages ?? [], item.qty, dept);

  const submit = async () => {
    /**
     * ПРЕВЫШЕНИЕ НА ЗАКРОЕ СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ (решение владельца):
     * потолка у закроя нет, но опечатка «1000» вместо «100» поднимает потолок
     * всем последующим этапам и снимает защиту, ради которой правка делается.
     * Разница называется числом — «превышение» без цифры проверить нечем.
     */
    const warn = overPlanConfirm(goodQty, stage, item.qty, dept);
    if (warn && !(await confirm({
      title: 'Сдать больше тиража?',
      message: warn,
      confirmLabel: 'Сдать',
    }))) return;
    onSubmit({
      qtyIn,
      qtyGood: goodQty,
      qtyDefect: defectQty,
      qtyRework: reworkQty,
      qtyExtra: totals.qty_extra,
      comment,
      extra: totals.extra,
      /**
       * Рулоны и размеры уезжают вместе: сервер по ним же считает
       * заголовочное `qty_good`, поэтому число выше и эти строки не могут
       * разойтись — оно из них и выведено.
       */
      ...(byRolls && rollEntries.length > 0
        ? {
          rolls: cutRollsPayload(rollEntries, rollOptions),
          // Разбивка считается по ВВЕДЁННЫМ строкам рулонов (правка 20.09,
          // п. 7). Прежде она собиралась по ячейкам сетки позиции — и у
          // позиции без сетки выходила пустой, то есть размерный факт закроя
          // не сохранялся вовсе.
          sizes: cutSizesPayload(rollEntries),
        }
        : {}),
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
  };

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
      {byRolls && (hasDetail ? (
        <CutRollsSection
          order={fullOrder}
          item={fullItem}
          entries={rollEntries}
          onChange={setRollEntries}
          reported={reportedSizes}
          disabled={busy}
        />
      ) : (
        <p className={styles.queueReason} role="status">Подтягиваем принятые рулоны…</p>
      ))}

      {useSizeTable && (
        <>
          <span className={styles.fieldLabel}>Размерная разбивка</span>
          <SizeResultTable
            rows={sizeRows.map((r) => ({ ...r, expected: r.expected ?? '—' }))}
            columns={[
              {
                code: 'good',
                label: 'Сшито, шт',
                /* Подсветка ИМЕННО этого поля: документ просит показать,
                   какую строку исправлять, а не «где-то превышение» */
                invalid: (row, vals) => row.expected !== null
                  && row.expected !== '—'
                  && rowEntered(vals) > Number(row.expected),
              },
              ...(canDefect ? [
                { code: 'defect', label: 'Брак, шт' },
                { code: 'rework', label: 'В переделку, шт' },
              ] : []),
              {
                code: 'state',
                label: 'Статус',
                /* Колонка-ВЫВОД: считается, а не вводится. Мастер видит
                   состояние строки, не сверяя два числа глазами */
                render: (row, vals) => {
                  if (row.expected === null || row.expected === '—') {
                    return <span className={styles.subText}>—</span>;
                  }
                  const entered = rowEntered(vals);
                  if (entered === 0) return <span className={styles.subText}>не заполнено</span>;
                  if (entered > Number(row.expected)) {
                    return (
                      <span className={styles.cellError}>
                        Нельзя указать больше, чем покроено
                      </span>
                    );
                  }
                  const left = Number(row.expected) - entered;
                  return left > 0
                    ? <span className={styles.subText}>осталось {left}</span>
                    : <span className={styles.subText}>готово</span>;
                },
              },
            ]}
            values={sizeValues}
            onChange={(key, code, value) => setSizeValues((v) => ({
              ...v, [key]: { ...v[key], [code]: value },
            }))}
            expectedLabel="Покроено, шт"
            caption="Результат пошива по размерам"
            disabled={busy}
          />
        </>
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
            onChange={(e) => setAssemblyCost(e.target.value)}
            placeholder={fullItem.assembly_cost_per_unit
              ? String(fullItem.assembly_cost_per_unit) : ''}
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

      {/* Причина отказа названа ДО отправки: узнать о потолке из ответа
          сервера хуже, чем прочитать его рядом с полем */}
      {sizeBlock && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} /> {sizeBlock}
        </p>
      )}

      {rollBlock && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} /> {rollBlock}
        </p>
      )}

      {overBlock && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} /> {overBlock}
        </p>
      )}

      <div className={styles.queueActions}>
        <Button
          variant="primary"
          disabled={busy || !anything || missingRequired || Boolean(overBlock)
            || Boolean(rollBlock) || Boolean(sizeBlock) || needsCost
            || (needsComment && !comment.trim())}
          onClick={submit}
        >
          <Icon name="check" size={14} /> Сдать результат
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}
