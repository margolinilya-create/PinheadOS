import { useId } from 'react';
import { FilterChip } from '../../components/FilterChip';
import styles from '../../styles';

/**
 * ЖИВЫЕ РУЧКИ — приём с bencho.dev, где каждый блок объявляет свои параметры
 * декларативно:
 *
 *   params: [{ id, label, hint, kind: 'range' | 'choice' | 'toggle', … }]
 *
 * ЗАЧЕМ ОНИ ЗДЕСЬ, ЕСЛИ МАТРИЦЫ ЛУЧШЕ. Витрина отвечает на вопрос
 * «различимы ли элементы РЯДОМ друг с другом», и для `Button` или `Badge`
 * матрица вариантов отвечает на него лучше любой ручки: всё видно сразу.
 * Ручки нужны другому — МЕХАНИЗМАМ. У степпера есть шаг, границы и кривая
 * разгона, у протяжки — порог; их нельзя «посмотреть рядом», их надо
 * покрутить. Поэтому матрицы остались матрицами, а ручки получили ровно
 * те разделы, где есть что крутить.
 *
 * СОСТОЯНИЕ ЖИВЁТ В `useKnobs` (соседний файл — правило
 * `react-refresh/only-export-components`), а не в каждом разделе: иначе
 * каждый новый механизм заводил бы свой `useState` со своим способом
 * читать `default`.
 */

function Knob({ param, value, onChange }) {
  const id = useId();

  if (param.kind === 'toggle') {
    return (
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{param.label}</span>
        {param.hint && <span className={styles.subText}>{param.hint}</span>}
      </label>
    );
  }

  if (param.kind === 'choice') {
    return (
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{param.label}</span>
        {/*
          Выбор — переключатели `aria-pressed`, а НЕ `role="tab"`: панелей
          у них нет, и половина таб-паттерна в этом проекте прямо запрещена.
          Примитив `FilterChip` уже несёт и состояние, и тач-размер.
        */}
        <div className={styles.checkRow}>
          {param.options.map((opt) => (
            <FilterChip
              key={String(opt)}
              active={value === opt}
              onClick={() => onChange(opt)}
            >
              {String(opt)}
            </FilterChip>
          ))}
        </div>
        {param.hint && <span className={styles.subText}>{param.hint}</span>}
      </div>
    );
  }

  // range
  return (
    <div className={styles.field}>
      {/*
        Подпись через htmlFor и с ЧИСЛОМ в тексте: у ползунка нет видимого
        значения, и «Шаг» без числа не отвечает на вопрос, что выставлено.
      */}
      <label className={styles.fieldLabel} htmlFor={id}>
        {param.label}: <b>{value}{param.unit || ''}</b>
      </label>
      <input
        id={id}
        type="range"
        className={styles.sgRange}
        min={param.min}
        max={param.max}
        step={param.step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {param.hint && <span className={styles.subText}>{param.hint}</span>}
    </div>
  );
}

export function Knobs({ params, state, onChange }) {
  if (!params?.length) return null;
  return (
    <div className={styles.sgKnobs}>
      {params.map((p) => (
        <Knob key={p.id} param={p} value={state[p.id]} onChange={(v) => onChange(p.id, v)} />
      ))}
    </div>
  );
}
