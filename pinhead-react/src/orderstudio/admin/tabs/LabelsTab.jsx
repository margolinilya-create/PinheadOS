/**
 * Вкладка «Бирки и схемы» экрана «Справочники заказа» (веха 4, задача 4).
 *
 * Правит библиотеку бирок `app_config.labelLibrary` через `useCatalogEditor`
 * (свежее чтение, запись `catalog_put` со сверкой базы, конфликт и запасной
 * путь — `CatalogNotice`):
 *   · виды — «в продаже» (код и имя вида связаны со справочником ERP);
 *   · варианты — название, цена за штуку, «с материалом», «в продаже»;
 *   · материалы — название, надбавка (может быть отрицательной), «в продаже»;
 *   · схемы притачивания — название, «в продаже».
 * Ничего не удаляется: снятое с продажи остаётся в старых заказах с пометкой.
 * На телефоне (`readOnly`) — только просмотр.
 */
import { toast } from '../../../store/useToastStore';
import BufferedInput from '../../screens/BufferedInput';
import {
  patchKind, patchVariant, patchMaterial, patchScheme, addVariant, addMaterial, addScheme,
  parsePrice, parseDelta, formatNumber, labelLibraryProblems,
} from '../../catalog/labels';
import { useCatalogEditor } from '../useCatalogEditor';
import CatalogNotice from '../CatalogNotice';
import base from '../../screens/Sales.module.css';
import styles from './LabelsTab.module.css';

const NAME = 'Бирки и схемы';

function ActiveToggle({ checked, onChange, label }) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span aria-hidden="true">{checked ? 'В продаже' : 'Снят с продажи'}</span>
    </label>
  );
}

function VariantRow({ kind, v, i, edit }) {
  const what = `${kind.name}, вариант ${i + 1}`;
  return (
    <li className={`${styles.row} ${v.active ? '' : styles.off}`}>
      <input
        className={base.input}
        value={v.name}
        onChange={(e) => edit((l) => patchVariant(l, kind.type, v.id, { name: e.target.value }))}
        aria-label={`Название: ${what}`}
        placeholder="Название варианта"
      />
      <BufferedInput
        className={`${base.input} ${styles.num}`}
        inputMode="decimal"
        value={v.price}
        parse={parsePrice}
        format={formatNumber}
        onCommit={(price) => edit((l) => patchVariant(l, kind.type, v.id, { price }))}
        aria-label={`Цена, ₽/шт: ${what}`}
      />
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={v.withMaterial}
          onChange={(e) => edit((l) => patchVariant(l, kind.type, v.id, { withMaterial: e.target.checked }))}
        />
        С материалом
      </label>
      <ActiveToggle
        checked={v.active}
        onChange={(active) => edit((l) => patchVariant(l, kind.type, v.id, { active }))}
        label={`В продаже: ${what}`}
      />
    </li>
  );
}

function MaterialRow({ kind, m, i, edit }) {
  const what = `${kind.name}, материал ${i + 1}`;
  return (
    <li className={`${styles.row} ${m.active ? '' : styles.off}`}>
      <input
        className={base.input}
        value={m.name}
        onChange={(e) => edit((l) => patchMaterial(l, kind.type, m.key, { name: e.target.value }))}
        aria-label={`Название: ${what}`}
        placeholder="Название материала"
      />
      <BufferedInput
        className={`${base.input} ${styles.num}`}
        inputMode="decimal"
        value={m.priceDelta}
        parse={parseDelta}
        format={formatNumber}
        onCommit={(priceDelta) => edit((l) => patchMaterial(l, kind.type, m.key, { priceDelta }))}
        aria-label={`Надбавка, ₽/шт: ${what}`}
      />
      <span />
      <ActiveToggle
        checked={m.active}
        onChange={(active) => edit((l) => patchMaterial(l, kind.type, m.key, { active }))}
        label={`В продаже: ${what}`}
      />
    </li>
  );
}

function KindSection({ kind, edit }) {
  const headId = `labels-kind-${kind.type}`;
  return (
    <section className={`${styles.kind} ${kind.active ? '' : styles.off}`} aria-labelledby={headId}>
      <div className={styles.kindHead}>
        <h3 id={headId} className={styles.kindTitle}>{kind.name}</h3>
        <ActiveToggle
          checked={kind.active}
          onChange={(active) => edit((l) => patchKind(l, kind.type, { active }))}
          label={`В продаже: ${kind.name}`}
        />
      </div>

      <h4 className={styles.subTitle}>Варианты <span className={base.muted}>· цена за штуку, ₽</span></h4>
      {kind.variants.length === 0 && <p className={base.muted}>Вариантов нет — бирка этого вида стоит 0 ₽.</p>}
      <ul className={styles.list}>
        {kind.variants.map((v, i) => <VariantRow key={v.id} kind={kind} v={v} i={i} edit={edit} />)}
      </ul>
      <button type="button" className={`${base.add} ${styles.addBtn}`} onClick={() => edit((l) => addVariant(l, kind.type))}>
        + Вариант: {kind.name}
      </button>

      <h4 className={styles.subTitle}>Материалы <span className={base.muted}>· надбавка к цене варианта «с материалом», ₽</span></h4>
      <ul className={styles.list}>
        {kind.materials.map((m, i) => <MaterialRow key={m.key} kind={kind} m={m} i={i} edit={edit} />)}
      </ul>
      <button type="button" className={`${base.add} ${styles.addBtn}`} onClick={() => edit((l) => addMaterial(l, kind.type))}>
        + Материал: {kind.name}
      </button>
    </section>
  );
}

function SchemesSection({ schemes, edit }) {
  return (
    <section className={styles.kind} aria-labelledby="labels-schemes">
      <div className={styles.kindHead}>
        <h3 id="labels-schemes" className={styles.kindTitle}>Схемы притачивания</h3>
      </div>
      <ul className={styles.list}>
        {schemes.map((s, i) => (
          <li key={s.id} className={`${styles.row} ${styles.schemeRow} ${s.active ? '' : styles.off}`}>
            <input
              className={base.input}
              value={s.name}
              onChange={(e) => edit((l) => patchScheme(l, s.id, { name: e.target.value }))}
              aria-label={`Название: схема ${i + 1}`}
              placeholder="Название схемы"
            />
            <ActiveToggle
              checked={s.active}
              onChange={(active) => edit((l) => patchScheme(l, s.id, { active }))}
              label={`В продаже: схема ${i + 1}`}
            />
          </li>
        ))}
      </ul>
      <button type="button" className={`${base.add} ${styles.addBtn}`} onClick={() => edit(addScheme)}>+ Схема притачивания</button>
    </section>
  );
}

export default function LabelsTab({ readOnly }) {
  const editor = useCatalogEditor('app_config', 'labelLibrary');
  const lib = editor.value;
  const ready = editor.state !== 'loading' && lib && Array.isArray(lib.kinds);
  const problems = ready ? labelLibraryProblems(lib) : [];
  const canSave = !readOnly && editor.dirty && problems.length === 0
    && (editor.state === 'ready' || editor.state === 'error');

  const save = async () => {
    if (await editor.save()) toast.success('Бирки и схемы сохранены');
  };

  return (
    <div data-readonly={readOnly ? 'true' : undefined}>
      <p className={styles.intro}>
        Справочник «{NAME}»: виды бирок, их варианты с ценой и материалы с надбавкой, схемы притачивания.
        Значение не удаляется, а снимается с продажи — в заказах, где оно уже стоит, остаётся с пометкой.
      </p>
      <CatalogNotice editor={editor} name={NAME} />
      {ready && (
        <>
          <fieldset className={styles.fieldset} disabled={readOnly || editor.state === 'saving'}>
            <legend className={styles.legend}>{NAME}</legend>
            {lib.kinds.map((k) => <KindSection key={k.type} kind={k} edit={editor.setValue} />)}
            <SchemesSection schemes={lib.schemes} edit={editor.setValue} />
          </fieldset>
          {!readOnly && (
            <div className={styles.footer}>
              {problems.length > 0 && (
                <ul className={styles.problems} role="status">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
              <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
                {editor.state === 'saving' ? 'Сохраняю…' : 'Сохранить бирки и схемы'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
