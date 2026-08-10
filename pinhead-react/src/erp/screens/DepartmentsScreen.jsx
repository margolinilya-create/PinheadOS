import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { PageHead } from '../components/PageHead';
import InlineEdit from '../components/InlineEdit';
import { Icon } from '../components/Icon';
import { toast } from '../../store/useToastStore';
import {
  EMPLOYEE_ROLE_LABELS, MATERIAL_KIND_LABELS, RESULT_FIELD_TARGET_LABELS,
} from '../types';
import { confirm } from '../../store/useConfirmStore';
import { pluralize } from '../../utils/i18n';
import styles from '../erp.module.css';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Button } from '../components/Button';

/** Виды материалов для настройки «участок ждёт материал» (порядок = порядок чекбоксов) */
const GATE_KINDS = Object.entries(MATERIAL_KIND_LABELS);

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
    departments, orders, loaded, loadAll,
    employees, employeesLoaded, loadEmployees,
    createDepartment, updateDepartment,
  } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      orders: s.orders,
      loaded: s.loaded,
      loadAll: s.loadAll,
      employees: s.employees,
      employeesLoaded: s.employeesLoaded,
      loadEmployees: s.loadEmployees,
      createDepartment: s.createDepartment,
      updateDepartment: s.updateDepartment,
    })),
  );
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
                  <InlineEdit
                    value={d.name}
                    ariaLabel={`Название участка ${d.name}`}
                    onSave={(v) => updateDepartment(d.id, { name: (v || '').trim() || d.name })}
                  />
                  {!d.active && <span className={styles.subText}> · отключён</span>}
                </td>
                <td className={styles.subText}>{d.code}</td>
                <td>
                  <input
                    type="number"
                    step="10"
                    className={`${styles.input} ${styles.inputSm}`}
                    defaultValue={d.sort_order}
                    aria-label={`Порядок участка ${d.name}`}
                    style={{ maxWidth: 80 }}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== d.sort_order) updateDepartment(d.id, { sort_order: v });
                    }}
                  />
                </td>
                <td>
                  {/* Производственный участок: своя очередь, колонка в канбане, требует ТЗ.
                      Раньше набор был захардкожен, и новый цех не появлялся нигде. */}
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={Boolean(d.is_production)}
                      aria-label={`Участок ${d.name} — производственный (своя очередь и канбан)`}
                      onChange={(e) => toggleProduction(d, e.target.checked)}
                    />
                    производственный
                  </label>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={Boolean(d.is_branding)}
                      aria-label={`Участок ${d.name} — этап брендирования`}
                      onChange={(e) => updateDepartment(d.id, { is_branding: e.target.checked })}
                    />
                    нанесение
                  </label>
                </td>
                <td>
                  {/* Какие материалы блокируют запуск этапа этого участка.
                      Раньше карта была константой в коде (ткань → закрой,
                      фурнитура и бирки → швейка), и участок, заведённый здесь,
                      под материальный гейт не попадал вовсе. Пусто = не гейтится. */}
                  {GATE_KINDS.map(([kind, label]) => (
                    <label key={kind} className={styles.checkLabel}>
                      <input
                        type="checkbox"
                        checked={(d.gate_material_kinds ?? []).includes(kind)}
                        aria-label={`Участок ${d.name} ждёт материал: ${label}`}
                        onChange={(e) => toggleGateKind(d, kind, e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                  {(d.gate_material_kinds ?? []).length === 0 && (
                    <div className={styles.subText}>не гейтится</div>
                  )}
                </td>
                <td>
                  {/*
                    Какие числа участок вносит по завершении работы (правки 10.08).
                    Схема живёт в данных ровно по той же причине, что материальный
                    гейт слева: константа в коде не дала бы отчёта участку,
                    заведённому здесь. Пусто — отчёт не требуется, и цех сдаёт
                    работу прежним полем «сколько сделано».
                  */}
                  <ResultFieldsCell dept={d} onSave={(fields) => updateDepartment(d.id, { result_fields: fields })} />
                </td>
                <td>
                  <select
                    className={styles.select}
                    value={d.head_employee_id || ''}
                    aria-label={`Руководитель участка ${d.name}`}
                    onChange={(e) => updateDepartment(d.id, { head_employee_id: e.target.value || null })}
                  >
                    <option value="">Не назначен</option>
                    {headCandidates(d.id).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name} · {EMPLOYEE_ROLE_LABELS[e.role] || e.role}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    className={`${styles.input} ${styles.inputSm}`}
                    defaultValue={d.norm_days ?? ''}
                    placeholder="—"
                    aria-label={`Норматив участка ${d.name}, дней`}
                    style={{ maxWidth: 70 }}
                    onBlur={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      if (v !== (d.norm_days ?? null)) updateDepartment(d.id, { norm_days: v });
                    }}
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
    </>
  );
}

/**
 * Схема отчёта участка (правки заказчика 10.08, P2).
 *
 * Правится текстом, по строке на поле: `код | подпись | единица | назначение | *`.
 * Формы с восемью инпутами на строку таблицы здесь быть не может — колонок и так
 * восемь, — а JSON руками в проде набирают с опечатками, которые тихо ломают
 * форму цеха. Текстовый формат читается глазами и проверяется при сохранении.
 */
function ResultFieldsCell({ dept, onSave }) {
  const fields = Array.isArray(dept.result_fields) ? dept.result_fields : [];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const toText = (list) => list
    .map((f) => [f.code, f.label, f.unit || '', f.target, f.required ? '*' : ''].join(' | '))
    .join('\n');

  const open = () => { setText(toText(fields)); setError(''); setEditing(true); };

  const save = () => {
    const parsed = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const [code, label, unit, target, req] = line.split('|').map((p) => p.trim());
      if (!code || !label || !target) {
        setError(`Строка «${line}»: нужны код, подпись и назначение`);
        return;
      }
      if (!RESULT_FIELD_TARGET_LABELS[target]) {
        setError(`Назначение «${target}» неизвестно. Допустимые: ${Object.keys(RESULT_FIELD_TARGET_LABELS).join(', ')}`);
        return;
      }
      parsed.push({ code, label, unit: unit || null, target, required: req === '*' });
    }
    onSave(parsed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <>
        {fields.length === 0
          ? <div className={styles.subText}>отчёт не требуется</div>
          : (
            <div className={styles.subText}>
              {fields.map((f) => f.label + (f.required ? ' *' : '')).join(', ')}
            </div>
          )}
        <Button variant="ghost" onClick={open} aria-label={`Настроить отчёт участка ${dept.name}`}>
          Настроить
        </Button>
      </>
    );
  }

  return (
    <div className={styles.stack}>
      <textarea
        className={styles.input}
        rows={Math.max(3, fields.length + 1)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={`Поля отчёта участка ${dept.name}`}
        placeholder="cut | Скроено | шт | qty_good | *"
      />
      <span className={styles.queueReason}>
        Формат строки: код | подпись | единица | назначение | * (обязательное).
        Назначения: {Object.entries(RESULT_FIELD_TARGET_LABELS)
          .map(([k, v]) => `${k} — ${v}`).join('; ')}.
      </span>
      {error && <span className={styles.overdue}>{error}</span>}
      <div className={styles.queueActions}>
        <Button variant="primary" onClick={save}>Сохранить</Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
      </div>
    </div>
  );
}
