import { useState } from 'react';
import InlineEdit from '../../components/InlineEdit';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
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
 * Схема отчёта участка (правки заказчика 10.08, P2; форма — §5 обхода 04.09).
 *
 * БЫЛО DSL В `textarea`: строка на поле, `код | подпись | единица | назначение | *`.
 * Синтаксис ничего не экономит — человек обязан помнить порядок пяти позиций
 * и коды назначений, а ошибку узнаёт только из красной строки после
 * «Сохранить».
 *
 * НО ДОВОД «ФОРМЫ С ВОСЕМЬЮ ИНПУТАМИ НА СТРОКУ ТАБЛИЦЫ ЗДЕСЬ БЫТЬ НЕ МОЖЕТ»
 * ОКАЗАЛСЯ ВЕРНЫМ БУКВАЛЬНО. Первая редакция правки 04.09 раскрывала поля
 * прямо в ячейке — та узкая (колонок девять), и шесть полей строки вставали
 * СТОЛБИКОМ: три поля дали бы восемнадцать строк вертикали внутри одной
 * ячейки. Это хуже `textarea`, которую заменяли. Проверено снимком экрана,
 * а не рассуждением — рассуждение как раз и ошиблось.
 *
 * Поэтому редактор уехал в `Modal`: настройка схемы отчёта — отдельная
 * задача, а не инлайн-правка ячейки, и ширину она берёт свою.
 *
 * Теперь строка поля — это строка полей: подпись, код, единица, назначение
 * селектом (коды больше не надо помнить) и галочка «обязательное». Проверка
 * осталась ТА ЖЕ и на том же месте — при сохранении: пустая подпись или код
 * не должны уезжать в форму цеха.
 */
export function ResultFieldsCell({ dept, onSave }) {
  const fields = Array.isArray(dept.result_fields) ? dept.result_fields : [];
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  const open = () => {
    setRows(fields.map((f) => ({
      code: f.code ?? '', label: f.label ?? '', unit: f.unit ?? '',
      target: f.target ?? '', required: Boolean(f.required),
    })));
    setError('');
    setEditing(true);
  };

  const patch = (i, key, value) => setRows(
    (list) => list.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)),
  );

  const save = () => {
    const parsed = [];
    for (const r of rows) {
      const code = r.code.trim();
      const label = r.label.trim();
      // Совсем пустая строка — не ошибка, а недозаполненный черновик: её
      // отбрасываем, как отбрасывает пустые строки лист закупки
      if (!code && !label && !r.target) continue;
      if (!code || !label || !r.target) {
        setError(`Поле «${label || code || 'без названия'}»: нужны код, подпись и назначение`);
        return;
      }
      if (!RESULT_FIELD_TARGET_LABELS[r.target]) {
        setError(`Назначение «${r.target}» неизвестно`);
        return;
      }
      parsed.push({
        code, label, unit: r.unit.trim() || null, target: r.target, required: r.required,
      });
    }
    onSave(parsed);
    setEditing(false);
  };

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
      {editing && (
        <Modal title={`Отчёт участка «${dept.name}»`} onClose={() => setEditing(false)}>
          <p className={styles.queueReason}>
            Какие числа участок вносит, сдавая работу. Пусто — участок сдаёт одним
            числом «сколько сделано»: схема не обязательна.
          </p>
          <div className={styles.stack}>
            {rows.length === 0 && (
              <span className={styles.subText}>
                Полей нет — участок сдаёт работу одним числом «сколько сделано».
              </span>
            )}
            {rows.map((r, i) => (
              /* Ключ по индексу тут верен: строки не переупорядочиваются, а удаление
                 переписывает весь список — стабильного идентификатора у поля нет */
              <div key={i} className={styles.resultFieldRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Подпись</span>
                  <input
                    className={`${styles.input} ${styles.inputSm}`} value={r.label}
                    onChange={(e) => patch(i, 'label', e.target.value)}
                    aria-label={`Подпись поля ${i + 1}`} placeholder="Скроено" />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Код</span>
                  <input
                    className={`${styles.input} ${styles.inputSm}`} value={r.code}
                    onChange={(e) => patch(i, 'code', e.target.value)}
                    aria-label={`Код поля ${i + 1}`} placeholder="cut" />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Единица</span>
                  <input
                    className={`${styles.input} ${styles.inputSm}`} value={r.unit}
                    onChange={(e) => patch(i, 'unit', e.target.value)}
                    aria-label={`Единица поля ${i + 1}`} placeholder="шт" />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Назначение</span>
                  {/* Селект, а не набранный код: помнить перечисление наизусть
                      человек не обязан, и опечатка тут ломала форму цеха */}
                  <select
                    className={styles.select} value={r.target}
                    onChange={(e) => patch(i, 'target', e.target.value)}
                    aria-label={`Назначение поля ${i + 1}`}>
                    <option value="">— выберите —</option>
                    {Object.entries(RESULT_FIELD_TARGET_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>
                {/* Инлайновая подпись, а не колонка `.field`: у флажка подпись
                    стоит РЯДОМ, иначе она висит над пустым местом и читается
                    как заголовок соседнего поля */}
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox" checked={r.required}
                    onChange={(e) => patch(i, 'required', e.target.checked)}
                    aria-label={`Поле ${i + 1} обязательное`} />
                  обязательное
                </label>
                <Button
                  variant="ghost"
                  onClick={() => setRows((list) => list.filter((_, idx) => idx !== i))}
                  aria-label={`Удалить поле ${i + 1}`}>
                  <Icon name="trash" size={14} />
                </Button>
              </div>
            ))}
            <div className={styles.queueActions}>
              <Button
                variant="secondary"
                onClick={() => setRows((list) => [
                  ...list, { code: '', label: '', unit: '', target: '', required: false },
                ])}>
                <Icon name="plus" size={14} /> Поле
              </Button>
            </div>
            {error && <span className={styles.overdue}>{error}</span>}
            <div className={styles.queueActions}>
              <Button variant="primary" onClick={save}>Сохранить</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
