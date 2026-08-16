import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { deptShortName } from '../data/departments';
import {
  draftFromStages,
  emptyStep,
  insertGroup,
  addParallel,
  moveGroup,
  removeStep,
  patchStep,
  linearize,
  routeIssues,
} from '../utils/routeDraft';
import { Button } from './Button';
import { Icon } from './Icon';
import { DictionaryDatalist } from './DictionaryDatalist';
import { confirm } from '../../store/useConfirmStore';
import styles from '../erp.module.css';

/**
 * Конструктор маршрута позиции (правки заказчика 16.08, блок 2).
 *
 * ЧТО ПРОСИЛ ЗАКАЗЧИК: «маршрут не должен быть жёстко зафиксирован системой.
 * Необходимо позволить добавлять этап, удалять этап, менять порядок, выбирать
 * наш / подрядный исполнитель, добавлять несколько подрядных этапов, возвращать
 * изделие после подрядчика обратно в наши цеха».
 *
 * ВЕСЬ РАСЧЁТ — В `utils/routeDraft`, здесь только разметка и обработчики.
 * Это не стилистика: сохранение маршрута обязано совпадать с автоматическим
 * расчётом до последнего `sort_order` (инвариант тождества, `routeDraft.test.ts`),
 * а расчёт, размазанный по компоненту, тестом не накрывается.
 *
 * СТРОКА СПИСКА — ШАГ, А НЕ ЭТАП. Документ описывает маршрут линейно, модель —
 * граф с параллельными ветками нанесения. Шаг (группа) — ровно то, что
 * `buildRoute` уже помечает одинаковым `sortOrder`, поэтому «внутри шага
 * несколько этапов» это не усложнение конструктора, а честное изображение
 * того, что и так происходит.
 *
 * ПОЧЕМУ НЕТ НОВОГО ПРАВА. Маршрут — решение по заказу, ровно как пропуск этапа
 * и плановые даты, а они под `order.manage`; под ним же вся таблица подряда
 * и сам экран «Подряд». Отдельное право означало бы «менеджер видит подряд,
 * но завести его не может» — тот самый декоративный доступ, ради которого
 * писался `utils/screenAccess`.
 */

const EXECUTOR_LABELS = {
  internal: 'Наш цех',
  contractor: 'Подрядчик',
};

/** Один этап внутри шага маршрута */
function StepRow({ step, gi, si, depts, onPatch, onRemove, canRemove }) {
  const id = `route-${gi}-${si}`;
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
        id={id}
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

export function RouteEditor({ item, orderId, onDone }) {
  const { departments, applyItemRoute } = useErpStore(useShallow((s) => ({
    departments: s.departments,
    applyItemRoute: s.applyItemRoute,
  })));
  const canManage = useErpAccess().can('order.manage');

  const depts = useMemo(
    () => departments.filter((d) => d.active).sort((a, b) => a.sort_order - b.sort_order),
    [departments],
  );
  const codeById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.code])),
    [departments],
  );
  const idByCode = useMemo(
    () => new Map(departments.map((d) => [d.code, d.id])),
    [departments],
  );

  const initial = useMemo(
    () => draftFromStages(item.stages ?? [], codeById),
    [item.stages, codeById],
  );
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  const issues = useMemo(() => routeIssues(draft), [draft]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initial),
    [draft, initial],
  );

  const patch = (gi, si, p) => setDraft((d) => patchStep(d, gi, si, p));
  const drop = (gi, si) => setDraft((d) => removeStep(d, gi, si));

  const save = async () => {
    const linear = linearize(draft);
    const steps = linear.map((l) => ({
      stage_id: l.step.stageId,
      department_id: idByCode.get(l.step.departmentCode) ?? null,
      sort_order: l.sortOrder,
      executor: l.step.executor,
      contractor: l.step.executor === 'contractor'
        ? (l.step.contractor.trim() || null)
        : null,
      operation: l.step.operation.trim() || null,
      depends_on: l.dependsOn,
    }));
    /**
     * Удаление этапа названо ПОШТУЧНО перед сохранением. «Маршрут изменится»
     * человек и так видит на экране; чего он не видит — что именно исчезнет
     * вместе с этапом, если тот уже стоит в очереди цеха или разложен по плану.
     */
    const removedCount = (item.stages ?? [])
      .filter((s) => s.status !== 'skipped')
      .filter((s) => !steps.some((x) => x.stage_id === s.id)).length;
    if (removedCount > 0) {
      const ok = await confirm({
        title: 'Сохранить маршрут?',
        message: `Из маршрута исчезнет этапов: ${removedCount}. `
          + 'Этап с начатой работой останется — его убирают пропуском, а не правкой маршрута.',
        confirmLabel: 'Сохранить',
      });
      if (!ok) return;
    }
    setSaving(true);
    const ok = await applyItemRoute(orderId, item.id, steps);
    setSaving(false);
    if (ok) onDone?.();
  };

  if (!canManage) {
    return (
      <p className={styles.subText}>
        Только просмотр: маршрут заказа правит менеджер (право «Ведение заказа»).
      </p>
    );
  }

  return (
    <div className={styles.routeEditor}>
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
                  onClick={() => setDraft((d) => moveGroup(d, gi, -1))}
                  aria-label={`Шаг ${gi + 1} выше`}
                />
                <Button
                  variant="ghost" size="sm" icon="arrowDown" iconOnly
                  disabled={gi === draft.length - 1 || locked || draft[gi + 1].some((s) => s.locked)}
                  onClick={() => setDraft((d) => moveGroup(d, gi, 1))}
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
                  onClick={() => setDraft((d) => addParallel(d, gi, emptyStep('')))}
                >
                  Параллельный этап
                </Button>
                <Button
                  variant="ghost" size="sm" icon="plus"
                  onClick={() => setDraft((d) => insertGroup(d, gi, emptyStep('')))}
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
          onClick={() => setDraft((d) => insertGroup(d, -1, emptyStep('')))}
        >
          Добавить первый этап
        </Button>
      )}

      {issues.length > 0 && (
        <ul className={styles.routeIssues}>
          {issues.map((p, i) => (
            <li key={i}>{p.group === null ? p.text : `Шаг ${p.group + 1}: ${p.text}`}</li>
          ))}
        </ul>
      )}

      <div className={styles.routeEditorFoot}>
        <Button
          variant="primary"
          disabled={issues.length > 0 || !dirty}
          loading={saving}
          onClick={save}
        >
          Сохранить маршрут
        </Button>
        <Button
          variant="ghost"
          disabled={saving || !dirty}
          onClick={() => setDraft(initial)}
        >
          Отменить правки
        </Button>
        {!dirty && <span className={styles.subText}>Маршрут не менялся</span>}
      </div>
    </div>
  );
}
