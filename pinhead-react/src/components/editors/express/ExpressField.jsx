import { useId } from 'react';
import base from '../../../orderstudio/screens/Sales.module.css';
import s from '../ExpressCalc.module.css';

/**
 * Поле экспресса: подпись, связанная с контролом по id, и подсказка через
 * `aria-describedby` — то же, что делает примитив ERP `Field`.
 *
 * Почему не сам `Field` (веха 8, задача 4, замер `bundle:budget`): второй потребитель
 * вне оболочки ERP заставил Rollup вынести `Field` и `PageHead` в свои чанки, и оболочка
 * ERP изменилась (+579 Б gzip, правка ERP запрещена — К11). Вид поля — общий для
 * раздела `Sales.module.css` (`.field`/`.select`/`.input`), он уже в оболочке Order.
 */
export default function ExpressField({ label, hint, as = 'input', children, ...rest }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const Control = as;
  const control = { id, className: as === 'select' ? base.select : base.input, 'aria-describedby': hintId, ...rest };
  return (
    <div className={base.field}>
      <label htmlFor={id}>{label}</label>
      {as === 'input' ? <input {...control} /> : <Control {...control}>{children}</Control>}
      {hint && <span id={hintId} className={s.hint}>{hint}</span>}
    </div>
  );
}
