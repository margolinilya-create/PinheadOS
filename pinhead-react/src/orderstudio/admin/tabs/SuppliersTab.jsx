import { useMemo, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { toast } from '../../../store/useToastStore';
import { useCatalogEditor } from '../useCatalogEditor';
import CatalogNotice from '../CatalogNotice';
import {
  addSupplier, bindFabricName, defaultSupplier, fabricSupplierNamesOf, offeredColors,
  setDefaultSupplier, updateSupplier, validateSuppliers,
} from '../../catalog/suppliers';
import PaletteEditor from './PaletteEditor';
import styles from './SuppliersTab.module.css';

const NAME = 'Поставщики и палитры';

const codesOf = (list) => new Set((list ?? []).flatMap((s) => s.palette.colors.map((c) => c.code)));

/** Имена тканей для привязки: из каталога тканей и уже привязанные (вдруг ткани больше нет) */
function bindableNames(fabricNames, list) {
  const all = new Set([...fabricNames, ...list.flatMap((s) => s.fabricSupplierNames)]);
  return [...all].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Поставщик: название, палитра по умолчанию, снятие, привязка имён тканей */
function SupplierCard({ list, supplier, names, editable, onChange }) {
  const ownerOf = (name) => list.find((s) => s.id !== supplier.id && s.fabricSupplierNames.includes(name));
  return (
    <fieldset className={styles.card} disabled={!editable}>
      <legend className={styles.srOnly}>Поставщик {supplier.name}</legend>
      <div className={styles.cardRow}>
        <label className={styles.field} htmlFor={`supplier-name-${supplier.id}`}>Название поставщика</label>
        <input
          id={`supplier-name-${supplier.id}`}
          className={styles.input}
          value={supplier.name}
          onChange={(e) => onChange(updateSupplier(list, supplier.id, { name: e.target.value }))}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={supplier.isDefault}
            disabled={supplier.isDefault}
            aria-describedby="supplier-default-hint"
            onChange={() => onChange(setDefaultSupplier(list, supplier.id))}
          />
          Палитра по умолчанию
        </label>
        {editable && !supplier.isDefault && (
          <button
            type="button"
            className="btn"
            onClick={() => onChange(updateSupplier(list, supplier.id, { active: !supplier.active }))}
          >
            {supplier.active ? 'Снять поставщика с продажи' : 'Вернуть поставщика'}
          </button>
        )}
      </div>
      <p id="supplier-default-hint" className={styles.muted}>
        Палитру по умолчанию получают ткани без привязки. Она ровно одна — отметьте другую, чтобы сменить.
      </p>

      <fieldset className={styles.binding}>
        <legend className={styles.legend}>Ткани каких поставщиков получают эту палитру</legend>
        {names.length === 0 && <p className={styles.muted}>В каталоге тканей нет поставщиков.</p>}
        <div className={styles.bindList}>
          {names.map((n) => {
            const owner = ownerOf(n);
            return (
              <label key={n} className={styles.check}>
                <input
                  type="checkbox"
                  checked={supplier.fabricSupplierNames.includes(n)}
                  onChange={(e) => onChange(bindFabricName(list, supplier.id, n, e.target.checked))}
                />
                {n}
                {owner && <span className={styles.muted}> (сейчас — {owner.name})</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
    </fieldset>
  );
}

/**
 * Вкладка «Поставщики и палитры» (веха 4, задача 3): `catalog_config.suppliers`.
 * Поставщик — палитра (группы и цвета), отметка «по умолчанию» (ровно одна)
 * и привязка имён поставщиков тканей (одно имя — одна палитра). Цвета
 * снимаются с продажи, а не удаляются. Сохранение — справочником целиком
 * через `useCatalogEditor` (конфликт, запасной путь — там же).
 */
export default function SuppliersTab({ readOnly }) {
  const editor = useCatalogEditor('catalog_config', 'suppliers');
  const fabricsCatalog = useStore((s) => s.fabricsCatalog);
  const fabricNames = useMemo(() => fabricSupplierNamesOf(fabricsCatalog ?? []), [fabricsCatalog]);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  // Коды прочитанной версии: код сохранённого цвета не правится
  const [saved, setSaved] = useState({ state: '', codes: new Set() });

  const list = Array.isArray(editor.value) ? editor.value : null;
  if (editor.state !== saved.state) {
    const fresh = editor.state === 'ready' || editor.state === 'fallback';
    setSaved({ state: editor.state, codes: fresh ? codesOf(list) : saved.codes });
  }

  const mark = readOnly ? 'true' : undefined;
  if (!list) {
    return <div className={styles.tab} data-readonly={mark}><CatalogNotice editor={editor} name={NAME} /></div>;
  }

  const editable = !readOnly && (editor.state === 'ready' || editor.state === 'error');
  const supplier = list.find((s) => s.id === selectedId) ?? list[0] ?? null;
  const names = bindableNames(fabricNames, list);
  const check = validateSuppliers(list, fabricNames);
  const fallbackPalette = defaultSupplier(list);
  const canSave = editable && editor.dirty && check.errors.length === 0;

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const next = addSupplier(list, name);
    editor.setValue(next);
    setSelectedId(next[next.length - 1].id);
    setNewName('');
  };
  const save = async () => {
    if (await editor.save()) toast.success('Поставщики сохранены');
  };

  return (
    <div className={styles.tab} data-readonly={mark}>
      <CatalogNotice editor={editor} name={NAME} />

      <div className={styles.suppliers} role="group" aria-label="Поставщики">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.supplierBtn}
            aria-pressed={supplier?.id === s.id}
            onClick={() => setSelectedId(s.id)}
          >
            {s.name || 'Без названия'}
            <span className={styles.badges}>
              {' '}· {offeredColors(s).length} цв.
              {s.isDefault && ' · по умолчанию'}
              {!s.active && ' · снят с продажи'}
            </span>
          </button>
        ))}
      </div>

      {editable && (
        <div className={styles.addSupplier}>
          <label className={styles.field} htmlFor="supplier-new">Новый поставщик</label>
          <input
            id="supplier-new"
            className={styles.input}
            value={newName}
            placeholder="Название"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
          <button type="button" className="btn" disabled={!newName.trim()} onClick={add}>Добавить поставщика</button>
        </div>
      )}

      {check.unbound.length > 0 && (
        <p className={styles.warn} role="note">
          Без привязки — получают палитру по умолчанию{fallbackPalette ? ` «${fallbackPalette.name}»` : ''}: {check.unbound.join(', ')}
        </p>
      )}

      {supplier && (
        <>
          <SupplierCard list={list} supplier={supplier} names={names} editable={editable} onChange={editor.setValue} />
          <PaletteEditor
            key={supplier.id}
            list={list}
            supplier={supplier}
            savedCodes={saved.codes}
            editable={editable}
            onChange={editor.setValue}
          />
        </>
      )}

      {check.errors.length > 0 && (
        <ul id="suppliers-errors" className={styles.errors}>
          {check.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {!readOnly && (
        <div className={styles.saveBar}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            aria-describedby={check.errors.length ? 'suppliers-errors' : undefined}
            onClick={save}
          >
            Сохранить поставщиков
          </button>
          {editor.state === 'saving' && <span className={styles.muted} role="status">Сохраняем…</span>}
        </div>
      )}
    </div>
  );
}
