import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { useDictionary } from '../store/useDictionary';
import { deptShortName, isProductionDept } from '../data/departments';
import {
  emptyStep,
  insertGroup,
  addParallel,
  moveGroup,
  removeStep,
  patchStep,
} from '../utils/routeDraft';
import { Button } from './Button';
import { Icon } from './Icon';
import { DateField } from './DateField';
import { DictionaryDatalist } from './DictionaryDatalist';
import styles from '../erp.module.css';

/**
 * Разметка конструктора маршрута — общая для карточки заказа и формы создания.
 *
 * ПОЧЕМУ ОДИН КОМПОНЕНТ НА ДВА МЕСТА. Маршрут задаётся дважды: при создании
 * заказа и при его правке, и это ОДНО И ТО ЖЕ решение — какие этапы, в каком
 * порядке, чьими руками. Две реализации разошлись бы в первую же правку, причём
 * молча: обе «работают», просто предлагают разное. Различие между местами не в
 * разметке, а в том, куда уезжает результат — в RPC правки маршрута или в payload
 * создания заказа, — поэтому состояние черновика держит вызывающий.
 *
 * СТРОКА — ШАГ, А НЕ ЭТАП. Документ описывает маршрут линейно, модель — граф
 * с параллельными ветками нанесения. Шаг (группа) — ровно то, что `buildRoute`
 * уже помечает одинаковым `sortOrder`.
 */

const EXECUTOR_LABELS = {
  internal: 'Наш цех',
  contractor: 'Подрядчик',
};

/**
 * Поле «Операция» с пополнением библиотеки (правки заказчика 20.08).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ: «если нужной операции нет, менеджер нажимает
 * + Создать новую операцию; после сохранения операция используется в текущем
 * маршруте, автоматически добавляется в библиотеку и становится доступна
 * в следующих заказах. Добавление нового вида подрядных работ не должно
 * требовать доработки ERP».
 *
 * Кнопка появляется, только когда набранное значение библиотеке НЕ известно:
 * иначе она предлагала бы завести дубль того, что уже есть. Гейт — зеркало
 * серверной политики (`catalog.edit` ИЛИ `order.manage` для этого вида).
 */
function OperationField({ step, gi, si, onPatch }) {
  const items = useDictionary('route_operation');
  const createDictionaryItem = useErpStore((s) => s.createDictionaryItem);
  const { can } = useErpAccess();
  const canAdd = can('catalog.edit') || can('order.manage');
  const [saving, setSaving] = useState(false);

  const value = step.operation.trim();
  const known = items.some((d) => d.name.toLowerCase() === value.toLowerCase());
  const showAdd = canAdd && !step.locked && value.length > 1 && !known;

  const add = async () => {
    setSaving(true);
    await createDictionaryItem('route_operation', value);
    setSaving(false);
  };

  return (
    <>
      <input
        className={styles.input}
        list="erp-route-operations"
        value={step.operation}
        disabled={step.locked}
        placeholder={step.executor === 'contractor'
          ? 'Операция подрядчика: варка, сублимация…'
          : 'Операция (если не совпадает с участком)'}
        onChange={(e) => onPatch(gi, si, { operation: e.target.value })}
        aria-label="Операция"
      />
      {showAdd && (
        <Button
          variant="ghost"
          size="sm"
          icon="plus"
          loading={saving}
          onClick={add}
          title="Операция сохранится в библиотеке и будет предлагаться в следующих заказах"
        >
          В библиотеку
        </Button>
      )}
    </>
  );
}

/** Дополнительные поля подрядного этапа — раскрываются вместе с исполнителем */
function ContractorFields({ step, gi, si, onPatch }) {
  const set = (patch) => onPatch(gi, si, patch);
  return (
    <div className={styles.routeSubFields}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Количество</span>
        <input
          type="number"
          min="0"
          className={styles.input}
          value={step.qty}
          disabled={step.locked}
          placeholder="150"
          onChange={(e) => set({ qty: e.target.value.replace('-', '') })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Передача, план</span>
        <DateField
          showFormatHint={false}
          value={step.sendPlan}
          disabled={step.locked}
          onChange={(v) => set({ sendPlan: v })}
          aria-label="Плановая дата передачи подрядчику"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Возврат, план</span>
        <DateField
          showFormatHint={false}
          value={step.returnPlan}
          disabled={step.locked}
          onChange={(v) => set({ returnPlan: v })}
          aria-label="Плановая дата возврата от подрядчика"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Ответственный Pinhead</span>
        <input
          className={styles.input}
          value={step.responsible}
          disabled={step.locked}
          placeholder="кто ведёт передачу"
          onChange={(e) => set({ responsible: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Что передаём</span>
        <input
          className={styles.input}
          value={step.handover}
          disabled={step.locked}
          placeholder="сшитые худи, полотно, кепки"
          onChange={(e) => set({ handover: e.target.value })}
        />
      </label>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span className={styles.fieldLabel}>Комментарий</span>
        <input
          className={styles.input}
          value={step.comment}
          disabled={step.locked}
          placeholder="Stone Wash, допуски, особые условия"
          onChange={(e) => set({ comment: e.target.value })}
        />
      </label>
    </div>
  );
}

/** Один этап внутри шага маршрута */
function StepRow({ step, gi, si, depts, onPatch, onRemove, canRemove }) {
  /**
   * Участок, уже стоящий в этапе, показываем ВСЕГДА, даже если он выпал
   * из предлагаемых (стал непроизводственным, деактивирован, пришёл из старого
   * маршрута). Иначе select не нашёл бы своего значения, показал бы «Участок…»
   * и первое же сохранение молча перевесило бы этап в никуда.
   */
  const options = useMemo(() => {
    if (!step.departmentCode || depts.some((d) => d.code === step.departmentCode)) return depts;
    return [...depts, { code: step.departmentCode, name: step.departmentCode }];
  }, [depts, step.departmentCode]);

  return (
    <div className={styles.routeStepRow}>
      <select
        className={styles.select}
        value={step.departmentCode}
        disabled={step.locked}
        onChange={(e) => onPatch(gi, si, { departmentCode: e.target.value })}
        aria-label="Участок ответственности"
      >
        <option value="">Участок…</option>
        {options.map((d) => (
          <option key={d.code} value={d.code}>{deptShortName(d.code, d.name)}</option>
        ))}
      </select>

      <select
        className={styles.select}
        value={step.executor}
        disabled={step.locked}
        onChange={(e) => onPatch(gi, si, {
          executor: e.target.value,
          // Уходя из подряда, имя подрядчика не держим: строка `erp_subcontracting`
          // при сохранении удаляется, и оставленное имя врало бы про исполнителя
          ...(e.target.value === 'internal' ? { contractor: '' } : {}),
        })}
        aria-label="Исполнитель этапа"
      >
        {Object.entries(EXECUTOR_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>

      {step.executor === 'contractor' && (
        <input
          className={styles.input}
          value={step.contractor}
          disabled={step.locked}
          placeholder="Подрядчик"
          onChange={(e) => onPatch(gi, si, { contractor: e.target.value })}
          aria-label="Подрядчик"
        />
      )}

      {/* Операция уточняет, ЧТО делают, когда это расходится с именем цеха:
          сублимацию принимает участок ДТФ, упаковку — склад готовой продукции.
          Заводить их отдельными цехами нельзя — справочник участков перестанет
          означать наши участки и потечёт в меню, очередь, план и загрузку. */}
      <OperationField step={step} gi={gi} si={si} onPatch={onPatch} />

      {step.locked ? (
        <span className={styles.subText} title="В этапе уже есть работа — его можно только пропустить">
          <Icon name="shield" size={13} /> в работе
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          icon="trash"
          iconOnly
          disabled={!canRemove}
          onClick={() => onRemove(gi, si)}
          aria-label="Убрать этап из маршрута"
        />
      )}
    </div>
  );
}

export function RouteFields({ draft, onChange }) {
  const departments = useErpStore(useShallow((s) => s.departments));
  /**
   * Предлагаем только участки, у которых ЕСТЬ ПОВЕРХНОСТЬ с их открытыми
   * этапами: производственные (очередь, канбан, план) и закупка (свой экран,
   * читающий этапы). Склад, логистика и экс-цех сюда не входят — этап там
   * не появится нигде, и заказ встанет молча. Это ровно дефект 12.08, из-за
   * которого 33 заказа стояли невидимыми: тогда причиной был `is_production`
   * у закупки, а список конструктора предлагал такие участки до сих пор.
   *
   * Признак берётся из данных (`isProductionDept`), а не из списка кодов:
   * участок, заведённый директором в админке, обязан появляться сам.
   */
  const depts = useMemo(
    () => departments
      .filter((d) => d.active && (isProductionDept(d) || d.code === 'supply'))
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments],
  );

  const patch = (gi, si, p) => onChange(patchStep(draft, gi, si, p));
  const drop = (gi, si) => onChange(removeStep(draft, gi, si));

  return (
    <>
      <DictionaryDatalist kind="route_operation" id="erp-route-operations" />

      <ol className={styles.routeSteps}>
        {draft.map((group, gi) => {
          const locked = group.some((s) => s.locked);
          return (
            <li key={gi} className={styles.routeStep}>
              <div className={styles.routeStepHead}>
                <span className={styles.routeStepNo}>{gi + 1}</span>
                {group.length > 1 && (
                  <span className={`${styles.chip} ${styles.chipNeutral}`}>параллельно</span>
                )}
                <div className={styles.spacer} />
                <Button
                  variant="ghost" size="sm" icon="arrowUp" iconOnly
                  disabled={gi === 0 || locked || draft[gi - 1].some((s) => s.locked)}
                  onClick={() => onChange(moveGroup(draft, gi, -1))}
                  aria-label={`Шаг ${gi + 1} выше`}
                />
                <Button
                  variant="ghost" size="sm" icon="arrowDown" iconOnly
                  disabled={gi === draft.length - 1 || locked || draft[gi + 1].some((s) => s.locked)}
                  onClick={() => onChange(moveGroup(draft, gi, 1))}
                  aria-label={`Шаг ${gi + 1} ниже`}
                />
              </div>

              {group.map((step, si) => (
                <div key={si}>
                  <StepRow
                    step={step} gi={gi} si={si} depts={depts}
                    onPatch={patch} onRemove={drop}
                    canRemove={draft.length > 1 || group.length > 1}
                  />
                  {/* Поля подрядчика раскрываются вместе с исполнителем: документ
                      требует заполнить их ЗДЕСЬ, одним движением с выбором
                      «Подрядчик», а не потом на другом экране */}
                  {step.executor === 'contractor' && (
                    <ContractorFields step={step} gi={gi} si={si} onPatch={patch} />
                  )}
                </div>
              ))}

              <div className={styles.routeStepFoot}>
                <Button
                  variant="ghost" size="sm" icon="plus"
                  onClick={() => onChange(addParallel(draft, gi, emptyStep('')))}
                >
                  Параллельный этап
                </Button>
                <Button
                  variant="ghost" size="sm" icon="plus"
                  onClick={() => onChange(insertGroup(draft, gi, emptyStep('')))}
                >
                  Шаг после
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      {draft.length === 0 && (
        <Button
          variant="secondary" size="sm" icon="plus"
          onClick={() => onChange(insertGroup(draft, -1, emptyStep('')))}
        >
          Добавить первый этап
        </Button>
      )}
    </>
  );
}

/** Перечень проблем маршрута под конструктором — общий вид для обоих мест */
export function RouteIssues({ issues }) {
  if (issues.length === 0) return null;
  return (
    <ul className={styles.routeIssues}>
      {issues.map((p, i) => (
        <li key={i}>{p.group === null ? p.text : `Шаг ${p.group + 1}: ${p.text}`}</li>
      ))}
    </ul>
  );
}
