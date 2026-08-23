import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { PageHead } from '../components/PageHead';
import { Icon } from '../components/Icon';
import { toast } from '../../store/useToastStore';
import { confirm } from '../../store/useConfirmStore';
import { pluralize } from '../../utils/i18n';
import styles from '../styles';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { LoadFailed, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { Button } from '../components/Button';
import { useCompactLayout } from '../layout/useCompactLayout';
import { DeptCard } from './admin/DeptCard';
import {
  DeptFlags, DeptName, GateKinds, HeadSelect, NormDaysInput, ResultFieldsCell, SortOrderInput,
} from './admin/DeptFields';

/**
 * Справочник производственных участков (правки 11 и 12): создание, переименование,
 * порядок в потоке, отключение, закрепление руководителя за цехом и нормативный
 * срок этапа в днях (подставляется планом завершения при «Взять в работу»).
 *
 * Участки не удаляются — на них ссылаются этапы заказов; отключение убирает их
 * из очередей и канбана, история остаётся целой.
 */

/** Латинский код участка из названия — стабильный ключ для маршрутов и ссылок */
function codeFromName(name) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  };
  const slug = name.trim().toLowerCase().split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  return slug || `dept_${Date.now().toString(36)}`;
}

export default function DepartmentsScreen({ embedded = false }) {
  const {
    departments, orders, loaded, loadError, loadAll,
    employees, employeesLoaded, loadEmployees,
    createDepartment, updateDepartment,
  } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      orders: s.orders,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      employees: s.employees,
      employeesLoaded: s.employeesLoaded,
      loadEmployees: s.loadEmployees,
      createDepartment: s.createDepartment,
      updateDepartment: s.updateDepartment,
    })),
  );
  const compact = useCompactLayout();
  const [draft, setDraft] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  /** Сколько незакрытых заданий висит на участке — для текста подтверждения */
  const openStagesIn = (deptId) => (orders ?? [])
    .filter((o) => o.status === 'active')
    .flatMap((o) => o.items ?? [])
    .flatMap((it) => it.stages ?? [])
    .filter((st) => st.department_id === deptId
      && st.status !== 'done' && st.status !== 'skipped').length;

  /**
   * Отключение участка и снятие признака «производственный» применялись сразу,
   * без единого слова. Между тем участок с активными этапами исчезает из очередей,
   * канбана и меню, а снятие `is_production` выводит его ещё и из маршрута и гейта ТЗ:
   * задания «повисают» без видимого места.
   */
  const toggleActive = async (d) => {
    if (d.active) {
      const open = openStagesIn(d.id);
      const ok = await confirm({
        title: `Отключить участок «${d.name}»?`,
        message: open > 0
          ? `На участке ${open} ${pluralize(open, 'незакрытое задание', 'незакрытых задания', 'незакрытых заданий')}. `
            + 'Он исчезнет из очередей, канбана и меню — задания останутся, но открыть их будет негде.'
          : 'Участок исчезнет из очередей, канбана и меню. Данные сохранятся, вернуть можно здесь же.',
        confirmLabel: 'Отключить',
        variant: 'danger',
      });
      if (!ok) return;
    }
    await updateDepartment(d.id, { active: !d.active });
  };

  const toggleProduction = async (d, next) => {
    if (!next) {
      const open = openStagesIn(d.id);
      const ok = await confirm({
        title: `Убрать «${d.name}» из производственных?`,
        message: [
          open > 0 ? `На участке ${open} ${pluralize(open, 'незакрытое задание', 'незакрытых задания', 'незакрытых заданий')}.` : '',
          'Участок пропадёт из меню цехов, канбана и маршрута новых заказов, и ему перестанет требоваться ТЗ.',
        ].filter(Boolean).join(' '),
        confirmLabel: 'Убрать',
        variant: 'danger',
      });
      if (!ok) return;
    }
    await updateDepartment(d.id, { is_production: next });
  };

  /**
   * Материал этого вида не пришёл → этап участка стоит в группе «Ожидают материалы».
   * Настройка живёт в данных, а не в коде: цех, заведённый здесь, должен попадать
   * под гейт без релиза (то же правило, что у `is_production`).
   */
  const toggleGateKind = async (d, kind, on) => {
    const current = d.gate_material_kinds ?? [];
    const next = on ? [...new Set([...current, kind])] : current.filter((k) => k !== kind);
    await updateDepartment(d.id, { gate_material_kinds: next });
  };

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  // Список руководителей берём из сотрудников — вкладка «Цеха» может открыться первой
  useEffect(() => {
    if (!employeesLoaded) loadEmployees();
  }, [employeesLoaded, loadEmployees]);

  const visible = useMemo(
    () => departments
      .filter((d) => showHidden || d.active)
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments, showHidden],
  );

  /** Кандидаты в руководители: активные сотрудники этого цеха + руководящие роли */
  const headCandidates = useMemo(() => {
    const active = employees.filter((e) => e.active);
    return (deptId) => active.filter(
      (e) => e.department_id === deptId
        || ['foreman', 'dispatcher', 'manager', 'director'].includes(e.role),
    );
  }, [employees]);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    const code = codeFromName(name);
    if (departments.some((d) => d.code === code)) {
      toast.warning('Участок с таким кодом уже есть');
      return;
    }
    const created = await createDepartment({
      code,
      name,
      sort_order: departments.reduce((max, d) => Math.max(max, d.sort_order), 0) + 10,
      // Новый участок заводят ради работы в цехах — сразу производственный;
      // снять галочку можно тут же, если это склад или служба
      is_production: true,
    });
    if (created) setDraft('');
  };

  return (
    <>
      {!embedded && (
        <PageHead
          title="Цеха и участки"
          sub={`${departments.length} подразделений — общий справочник производства.`}
        />
      )}

      <div className={styles.queueReason} style={{ marginBottom: 12 }}>
        Порядок задаёт последовательность участков в меню и на канбане. Норматив — плановый
        срок этапа в днях: подставляется при «Взять в работу», если задан. Участки не удаляются:
        на них ссылаются этапы заказов, отключение убирает их из очередей.
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          value={draft}
          placeholder="Новый участок, напр. «Цех термопереноса»"
          aria-label="Название нового участка"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <Button variant="primary" disabled={!draft.trim()} onClick={add}>
          + Добавить участок
        </Button>
        <div className={styles.spacer} />
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Показывать отключённые
        </label>
      </div>

      {/* Три состояния по правилу UX-2: ошибка → скелетон → пусто.
          Ни одного из них здесь не было: при сбое загрузки экран показывал
          пустую таблицу с одной шапкой, а повторить запрос было нечем —
          эффект `if (!loaded) loadAll()` второй раз не срабатывает. */}
      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="участки" />}
      {!loaded && !loadError && <TableSkeleton rows={6} label="Загрузка участков" />}
      {/* Планшет и телефон: карточки вместо таблицы из девяти колонок —
          колонка действия стояла последней и уезжала за край экрана */}
      {loaded && visible.length > 0 && compact && (
        <div className={styles.dataCardList}>
          {visible.map((d) => (
            <DeptCard
              key={d.id}
              dept={d}
              headCandidates={headCandidates(d.id)}
              onRename={(name) => updateDepartment(d.id, { name })}
              onSortOrder={(v) => updateDepartment(d.id, { sort_order: v })}
              onToggleProduction={(next) => toggleProduction(d, next)}
              onToggleBranding={(next) => updateDepartment(d.id, { is_branding: next })}
              onToggleGateKind={(kind, on) => toggleGateKind(d, kind, on)}
              onSaveResultFields={(fields) => updateDepartment(d.id, { result_fields: fields })}
              onHead={(id) => updateDepartment(d.id, { head_employee_id: id })}
              onNormDays={(v) => updateDepartment(d.id, { norm_days: v })}
              onToggleActive={() => toggleActive(d)}
            />
          ))}
        </div>
      )}

      {loaded && visible.length > 0 && !compact && (
      <ScrollHintBox className={styles.tableWrap} label="Участки производства">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Участок</th><th>Код</th><th>Порядок</th><th>Признаки</th>
              <th>Ждёт материалы</th>
              <th>Отчёт участка</th>
              <th>Руководитель</th><th>Норматив, дн</th><th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.id} style={d.active ? undefined : { opacity: 0.5 }}>
                <td>
                  <DeptName
                    dept={d}
                    onRename={(name) => updateDepartment(d.id, { name })}
                  />
                </td>
                <td className={styles.subText}>{d.code}</td>
                <td>
                  <SortOrderInput
                    dept={d}
                    onChange={(v) => updateDepartment(d.id, { sort_order: v })}
                  />
                </td>
                <td>
                  <DeptFlags
                    dept={d}
                    onToggleProduction={(next) => toggleProduction(d, next)}
                    onToggleBranding={(next) => updateDepartment(d.id, { is_branding: next })}
                  />
                </td>
                <td>
                  <GateKinds dept={d} onToggle={(kind, on) => toggleGateKind(d, kind, on)} />
                </td>
                <td>
                  {/*
                    Какие числа участок вносит по завершении работы (правки 10.08).
                    Схема живёт в данных ровно по той же причине, что материальный
                    гейт слева: константа в коде не дала бы отчёта участку,
                    заведённому здесь. Пусто — отчёт не требуется, и цех сдаёт
                    работу прежним полем «сколько сделано».
                  */}
                  <ResultFieldsCell
                    dept={d}
                    onSave={(fields) => updateDepartment(d.id, { result_fields: fields })}
                  />
                </td>
                <td>
                  <HeadSelect
                    dept={d}
                    candidates={headCandidates(d.id)}
                    onChange={(id) => updateDepartment(d.id, { head_employee_id: id })}
                  />
                </td>
                <td>
                  <NormDaysInput
                    dept={d}
                    onChange={(v) => updateDepartment(d.id, { norm_days: v })}
                  />
                </td>
                <td>
                  <Button variant="ghost" onClick={() => toggleActive(d)}>
                    {d.active ? (
                      <span className={styles.cellWithIcon}><Icon name="x" size={14} /> Отключить</span>
                    ) : 'Вернуть'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollHintBox>
      )}
      {loaded && visible.length === 0 && (
        <EmptyState
          icon="settings"
          title={showHidden ? 'Участков нет' : 'Все участки отключены'}
          text={showHidden
            ? 'Заведите первый участок полем выше — он появится в меню, очередях и конструкторе маршрута.'
            : 'Включите показ отключённых, чтобы вернуть нужный: участки не удаляются, на них ссылаются этапы заказов.'}
        />
      )}
    </>
  );
}
