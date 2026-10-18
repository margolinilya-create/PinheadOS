/**
 * ЗАГЛУШКА холста редактора флэта — только чтобы ветка задачи 6б собиралась
 * до слияния с задачей 6а (владелец `admin/flats/canvas/**` — задача 6а).
 * При слиянии берётся версия задачи 6а целиком.
 *
 * Контракт (план 5б, задача 6а): markup, flatMm, view, accessory,
 * selectedAreaId, readOnly, mode, onSelectArea, onAreaRect, onAreaPoint,
 * onAnchors, onMeasured, label; `data-ready` после первой отрисовки.
 */
export default function FlatCanvas({ markup, label }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- заглушка контракта холста (role="application")
    <div role="application" tabIndex={0} aria-label={label} data-ready={markup ? 'true' : undefined} />
  );
}
