import t from './skuTable.module.css';

/** Метка поставщика: цвет — подсказка, имя — всегда текстом (цвет не единственный носитель) */
const DOT = { 'Медас': t.dotMedas, 'ТД Коттон': t.dotCotton, 'ТониТекс': t.dotToni };

export default function SupplierName({ name }) {
  return (
    <span className={t.supplier}>
      <span className={`${t.dot} ${DOT[name] ?? ''}`} aria-hidden="true" />
      {name || '—'}
    </span>
  );
}
