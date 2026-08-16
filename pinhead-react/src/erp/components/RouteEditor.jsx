import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { draftFromStages, linearize, routeIssues } from '../utils/routeDraft';
import { RouteFields, RouteIssues } from './RouteFields';
import { Button } from './Button';
import { confirm } from '../../store/useConfirmStore';
import styles from '../erp.module.css';

/**
 * Конструктор маршрута СУЩЕСТВУЮЩЕЙ позиции (правки заказчика 16.08, блок 2).
 *
 * ЧТО ПРОСИЛ ЗАКАЗЧИК: «маршрут не должен быть жёстко зафиксирован системой.
 * Необходимо позволить добавлять этап, удалять этап, менять порядок, выбирать
 * наш / подрядный исполнитель, добавлять несколько подрядных этапов, возвращать
 * изделие после подрядчика обратно в наши цеха».
 *
 * ВЕСЬ РАСЧЁТ — В `utils/routeDraft`, разметка — в `RouteFields` (она общая
 * с формой создания заказа). Здесь остаётся только то, что отличает правку
 * от заведения: чтение исходных этапов, замок на начатой работе и сохранение.
 *
 * ПОЧЕМУ НЕТ НОВОГО ПРАВА. Маршрут — решение по заказу, ровно как пропуск этапа
 * и плановые даты, а они под `order.manage`; под ним же вся таблица подряда
 * и сам экран «Подряд». Отдельное право означало бы «менеджер видит подряд,
 * но завести его не может» — тот самый декоративный доступ, ради которого
 * писался `utils/screenAccess`.
 */
export function RouteEditor({ item, orderId, onDone }) {
  const { departments, applyItemRoute } = useErpStore(useShallow((s) => ({
    departments: s.departments,
    applyItemRoute: s.applyItemRoute,
  })));
  const canManage = useErpAccess().can('order.manage');

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

  const save = async () => {
    const steps = linearize(draft).map((l) => ({
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
      <RouteFields draft={draft} onChange={setDraft} />
      <RouteIssues issues={issues} />

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
