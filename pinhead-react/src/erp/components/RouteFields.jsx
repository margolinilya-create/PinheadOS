import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { deptShortName } from '../data/departments';
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

/** Один этап внутри шага маршрута */
function StepRow({ step, gi, si, depts, onPatch, onRemove, canRemove }) {
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
        {depts.map((d) => (
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
      <input
        className={styles.input}
        list="erp-route-operations"
        value={step.operation}
        disabled={step.locked}
        placeholder="Операция (если не совпадает с участком)"
        onChange={(e) => onPatch(gi, si, { operation: e.target.value })}
        aria-label="Операция"
      />

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
  const depts = useMemo(
    () => departments.filter((d) => d.active).sort((a, b) => a.sort_order - b.sort_order),
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
                <StepRow
                  key={si}
                  step={step} gi={gi} si={si} depts={depts}
                  onPatch={patch} onRemove={drop}
                  canRemove={draft.length > 1 || group.length > 1}
                />
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
