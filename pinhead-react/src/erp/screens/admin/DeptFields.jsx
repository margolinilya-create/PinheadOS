import { useState } from 'react';
import InlineEdit from '../../components/InlineEdit';
import { Button } from '../../components/Button';
import {
  EMPLOYEE_ROLE_LABELS, MATERIAL_KIND_LABELS, RESULT_FIELD_TARGET_LABELS,
} from '../../types';
import styles from '../../styles';

/**
 * Поля участка — ПО ОДНОЙ реализации на элемент.
 *
 * Зачем модуль. Таблица участков — ДЕВЯТЬ колонок, и семь из них не подписи,
 * а правки: имя, порядок, два признака, набор гейтовых материалов, схема
 * отчёта, руководитель, норматив. Ниже 1024px это уезжало за край вместе
 * с колонкой «Действие», а участок заводят и настраивают с того же планшета,
 * с которого смотрят производство.
 *
 * Копия под карточку разошлась бы молча: у половины полей своё условие записи
 * («пиши, только если значение изменилось» у порядка и норматива), и вторая
 * реализация писала бы иначе, оставаясь на вид рабочей. Тот же приём,
 * что у закупки (`purchasing/PurchaseFields`), подряда
 * (`subcontracting/StageFields`) и сотрудников (`admin/EmployeeFields`).
 */

/** Виды материалов для настройки «участок ждёт материал» (порядок = порядок чекбоксов) */
const GATE_KINDS = Object.entries(MATERIAL_KIND_LABELS);

export function DeptName({ dept, onRename }) {
  return (
    <>
      <InlineEdit
        value={dept.name}
        ariaLabel={`Название участка ${dept.name}`}
        onSave={(v) => onRename((v || '').trim() || dept.name)}
      />
      {!dept.active && <span className={styles.subText}> · отключён</span>}
    </>
  );
}

/**
 * Порядок в потоке. Значение пишется по `blur` и только если изменилось —
 * иначе каждый уход фокуса шёл бы запросом.
 */
export function SortOrderInput({ dept, onChange }) {
  return (
    <input
      type="number"
      step="10"
      className={`${styles.input} ${styles.inputSm}`}
      defaultValue={dept.sort_order}
      aria-label={`Порядок участка ${dept.name}`}
      style={{ maxWidth: 80 }}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== dept.sort_order) onChange(v);
      }}
    />
  );
}

/**
 * Признаки участка: производственный (своя очередь, колонка канбана, гейт ТЗ)
 * и нанесение. Раньше набор был захардкожен, и новый цех не появлялся нигде.
 */
export function DeptFlags({ dept, onToggleProduction, onToggleBranding }) {
  return (
    <>
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          checked={Boolean(dept.is_production)}
          aria-label={`Участок ${dept.name} — производственный (своя очередь и канбан)`}
          onChange={(e) => onToggleProduction(e.target.checked)}
        />
        производственный
      </label>
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          checked={Boolean(dept.is_branding)}
          aria-label={`Участок ${dept.name} — этап брендирования`}
          onChange={(e) => onToggleBranding(e.target.checked)}
        />
        нанесение
      </label>
    </>
  );
}

/**
 * Какие материалы блокируют запуск этапа участка. Раньше карта была константой
 * в коде (ткань → закрой, фурнитура и бирки → швейка), и участок, заведённый
 * в админке, под материальный гейт не попадал вовсе. Пусто = не гейтится.
 */
export function GateKinds({ dept, onToggle }) {
  return (
    <>
      {GATE_KINDS.map(([kind, label]) => (
        <label key={kind} className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={(dept.gate_material_kinds ?? []).includes(kind)}
            aria-label={`Участок ${dept.name} ждёт материал: ${label}`}
            onChange={(e) => onToggle(kind, e.target.checked)}
          />
          {label}
        </label>
      ))}
      {(dept.gate_material_kinds ?? []).length === 0 && (
        <div className={styles.subText}>не гейтится</div>
      )}
    </>
  );
}

export function HeadSelect({ dept, candidates, onChange }) {
  return (
    <select
      className={styles.select}
      value={dept.head_employee_id || ''}
      aria-label={`Руководитель участка ${dept.name}`}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Не назначен</option>
      {candidates.map((e) => (
        <option key={e.id} value={e.id}>
          {e.full_name} · {EMPLOYEE_ROLE_LABELS[e.role] || e.role}
        </option>
      ))}
    </select>
  );
}

/** Норматив этапа в днях: подставляется планом завершения при «Взять в работу» */
export function NormDaysInput({ dept, onChange }) {
  return (
    <input
      type="number"
      min="0"
      className={`${styles.input} ${styles.inputSm}`}
      defaultValue={dept.norm_days ?? ''}
      placeholder="—"
      aria-label={`Норматив участка ${dept.name}, дней`}
      style={{ maxWidth: 70 }}
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        if (v !== (dept.norm_days ?? null)) onChange(v);
      }}
    />
  );
}

/**
 * Схема отчёта участка (правки заказчика 10.08, P2).
 *
 * Правится текстом, по строке на поле: `код | подпись | единица | назначение | *`.
 * Формы с восемью инпутами на строку таблицы здесь быть не может — колонок и так
 * девять, — а JSON руками в проде набирают с опечатками, которые тихо ломают
 * форму цеха. Текстовый формат читается глазами и проверяется при сохранении.
 */
export function ResultFieldsCell({ dept, onSave }) {
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
