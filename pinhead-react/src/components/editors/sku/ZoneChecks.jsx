import m from './SkuModal.module.css';

/** Флажки зон нанесения модели (окно «Зоны нанесения» и карточка модели) */
export default function ZoneChecks({ zones, selected, onToggle, label }) {
  return (
    <div className={m.checks} role="group" aria-label={label}>
      {zones.map((z) => (
        <label key={z.id} className={m.check}>
          <input type="checkbox" checked={selected.includes(z.id)} onChange={() => onToggle(z.id)} />
          <span>{z.name}</span>
        </label>
      ))}
    </div>
  );
}
