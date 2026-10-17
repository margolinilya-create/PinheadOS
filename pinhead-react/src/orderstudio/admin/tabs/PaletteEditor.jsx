import { useId, useState } from 'react';
import { sanitizeHex } from '../../../utils/sanitizeHex';
import { addColor, addGroup, isValidHex, updateColorAt, updateGroup } from '../../catalog/suppliers';
import styles from './SuppliersTab.module.css';

/** Цвет нового образца — нейтральный серый, правится сразу */
const NEW_HEX = '#CCCCCC';

/** Ошибки строки цвета для полей: код (пуст, повтор по всем палитрам) и hex */
function rowErrors(list, supplier, index) {
  const c = supplier.palette.colors[index];
  const code = c.code.trim();
  let codeErr = '';
  if (!code) codeErr = 'Впишите код цвета';
  else {
    const owner = list.find((s) => s.palette.colors.some((x, i) => x.code.trim() === code && !(s.id === supplier.id && i === index)));
    if (owner) codeErr = `Код уже есть в палитре «${owner.name}»`;
  }
  const hexErr = isValidHex(c.hex) ? '' : 'Hex — в виде #RRGGBB, например #1A2B3C';
  return { codeErr, hexErr };
}

function groupLabel(supplier, id) {
  return supplier.palette.groups.find((g) => g.id === id)?.label ?? 'Без группы';
}

/** Строка цвета в правке: поля с ошибками у полей (`aria-invalid` + `aria-describedby`) */
function EditRow({ list, supplier, index, savedCodes, onChange, onDone }) {
  const uid = useId();
  const c = supplier.palette.colors[index];
  const { codeErr, hexErr } = rowErrors(list, supplier, index);
  const set = (patch) => onChange(updateColorAt(list, supplier.id, index, patch));
  const codeLocked = savedCodes.has(c.code);
  return (
    <tr className={styles.editRow}>
      <td>
        <span className={styles.sample} data-testid="hex-sample" style={{ backgroundColor: sanitizeHex(c.hex) }} aria-hidden="true" />
      </td>
      <td>
        <input
          className={styles.cellInput}
          aria-label="Код цвета"
          value={c.code}
          readOnly={codeLocked}
          title={codeLocked ? 'Код сохранённого цвета не меняется — он уже может стоять в заказах' : undefined}
          aria-invalid={codeErr ? 'true' : undefined}
          aria-describedby={codeErr ? `${uid}-code` : undefined}
          onChange={(e) => set({ code: e.target.value })}
          autoFocus={!codeLocked}
        />
        {codeErr && <span id={`${uid}-code`} className={styles.fieldError}>{codeErr}</span>}
      </td>
      <td>
        <input className={styles.cellInput} aria-label="Название цвета" value={c.name} onChange={(e) => set({ name: e.target.value })} autoFocus={codeLocked} />
      </td>
      <td>
        <input
          className={styles.cellInput}
          aria-label="Hex цвета"
          value={c.hex}
          aria-invalid={hexErr ? 'true' : undefined}
          aria-describedby={hexErr ? `${uid}-hex` : undefined}
          onChange={(e) => set({ hex: e.target.value.trim() })}
        />
        {hexErr && <span id={`${uid}-hex`} className={styles.fieldError}>{hexErr}</span>}
      </td>
      <td>
        <select className={styles.cellInput} aria-label="Группа цвета" value={c.group} onChange={(e) => set({ group: e.target.value })}>
          <option value="">Без группы</option>
          {supplier.palette.groups.map((g) => <option key={g.id} value={g.id}>{g.label || g.id}</option>)}
        </select>
      </td>
      <td>{c.active ? 'в продаже' : 'снят с продажи'}</td>
      <td>
        <button type="button" className="btn" onClick={onDone}>Готово</button>
      </td>
    </tr>
  );
}

/** Строка цвета в просмотре: клик по строке — правка; снятие — кнопкой */
function ViewRow({ supplier, index, editable, onEdit, onToggle }) {
  const c = supplier.palette.colors[index];
  const edit = (e) => {
    if (!editable || e.target.closest('button')) return;
    onEdit();
  };
  return (
    <tr className={`${c.active ? '' : styles.off} ${editable ? styles.clickable : ''}`} onClick={edit}>
      <td><span className={styles.sample} style={{ backgroundColor: sanitizeHex(c.hex) }} aria-hidden="true" /></td>
      <td className={styles.code}>{c.code}</td>
      <td>{c.name}</td>
      <td className={styles.code}>{c.hex}</td>
      <td>{groupLabel(supplier, c.group)}</td>
      <td>{c.active ? 'в продаже' : 'снят с продажи'}</td>
      <td className={styles.actions}>
        {editable && (
          <>
            <button type="button" className="btn" aria-label={`Изменить цвет ${c.code}`} onClick={onEdit}>Изменить</button>
            <button type="button" className="btn" onClick={onToggle}>{c.active ? 'Снять с продажи' : 'Вернуть'}</button>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * Палитра поставщика: группы и цвета. Цвета списком — поиск, «Показать снятые»,
 * правка строки по клику, «Снять с продажи / Вернуть» (не удаляются — цвет
 * может стоять в заказах). Код сохранённого цвета не меняется; уникальность
 * кода — по ВСЕМ палитрам (сервер отклонит повтор).
 *
 * `list` — весь справочник (правка возвращает новый список), `savedCodes` —
 * коды из прочитанной версии.
 */
export default function PaletteEditor({ list, supplier, savedCodes, editable, onChange }) {
  const [search, setSearch] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState(-1);
  const colors = supplier.palette.colors;

  const q = search.trim().toLowerCase();
  const rows = colors
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => i === editing || (
      (showOff || c.active)
      && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    ));
  const offCount = colors.filter((c) => !c.active).length;

  const add = () => {
    setSearch('');
    onChange(addColor(list, supplier.id, { code: '', name: '', hex: NEW_HEX, group: '' }));
    setEditing(colors.length);
  };

  return (
    <div className={styles.palette}>
      <fieldset className={styles.groups} disabled={!editable}>
        <legend className={styles.legend}>Группы палитры</legend>
        {supplier.palette.groups.length === 0 && <p className={styles.muted}>Групп нет — цвета идут одним списком.</p>}
        <div className={styles.groupList}>
          {supplier.palette.groups.map((g, i) => (
            <input
              key={g.id}
              className={styles.input}
              aria-label={`Группа ${i + 1}`}
              value={g.label}
              onChange={(e) => onChange(updateGroup(list, supplier.id, g.id, e.target.value))}
            />
          ))}
        </div>
        {editable && (
          <button type="button" className="btn" onClick={() => onChange(addGroup(list, supplier.id, 'Новая группа'))}>
            Добавить группу
          </button>
        )}
      </fieldset>

      <h3 className={styles.legend}>Цвета палитры</h3>
      <div className={styles.toolbar}>
        <input
          className={styles.input}
          type="search"
          aria-label="Поиск цвета в палитре"
          placeholder="Код или название"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
          Показать снятые
        </label>
        {offCount > 0 && <span className={styles.muted}>снято: {offCount}</span>}
        {editable && <button type="button" className="btn btn-primary" onClick={add}>Добавить цвет</button>}
      </div>

      {colors.length === 0 ? (
        <p className={styles.muted}>В палитре нет цветов — в заказе менеджер впишет свой цвет текстом, как в накладной.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Образец</th>
                <th scope="col">Код</th>
                <th scope="col">Название</th>
                <th scope="col">Hex</th>
                <th scope="col">Группа</th>
                <th scope="col">Статус</th>
                <th scope="col"><span className={styles.srOnly}>Действия</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, i }) => (i === editing && editable ? (
                <EditRow
                  key={i}
                  list={list}
                  supplier={supplier}
                  index={i}
                  savedCodes={savedCodes}
                  onChange={onChange}
                  onDone={() => setEditing(-1)}
                />
              ) : (
                <ViewRow
                  key={i}
                  supplier={supplier}
                  index={i}
                  editable={editable}
                  onEdit={() => setEditing(i)}
                  onToggle={() => onChange(updateColorAt(list, supplier.id, i, { active: !c.active }))}
                />
              )))}
            </tbody>
          </table>
          {rows.length === 0 && <p className={styles.muted}>Ничего не найдено.</p>}
        </div>
      )}
    </div>
  );
}
