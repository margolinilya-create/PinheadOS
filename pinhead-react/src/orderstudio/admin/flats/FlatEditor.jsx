import { useMemo, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { isAccessoryType } from '../../design/catalog/categoryMap';
import { validateFlat } from '../../design/edit/validateFlat';
import AreasSection from './AreasSection';
import FlatCanvasPane from './FlatCanvasPane';
import { FlatEditorEmpty, FlatNotice } from './FlatEditorStates';
import FlatHistory from './FlatHistory';
import FlatModelSection from './FlatModelSection';
import FlatSaveBar from './FlatSaveBar';
import FlatViewsSection from './FlatViewsSection';
import NewFlatForm from './NewFlatForm';
import { issueTarget, PANEL_LABELS, READ_ONLY_TEXT, viewOrder } from './flatEditorView';
import { useFlatEditor } from './useFlatEditor';
import { useFlatViewActions } from './useFlatViewActions';
import { useFocusSoon } from './useFocusSoon';
import { useViewMarkup } from './useViewMarkup';
import styles from './FlatEditor.module.css';

const NO_CHECK = { errors: [], warnings: [] };
const PANELS = Object.keys(PANEL_LABELS);

/**
 * Редактор флэта (веха 5б, задача 6б) — `/order-settings?tab=flats&flat=<id>`
 * (`flat=new` — новый). Лениво из `FlatsTab`; холст konva — статически внутри.
 * Шапка («← Все флэты», имя, «Версия N», несохранённое), слева холст с видами
 * и режимами, справа вкладки «Зоны», «Вид», «Модель и подбор», «История»,
 * внизу — замечания и кнопка, называющая результат. rop — без правки.
 */
export default function FlatEditor({ flatId, view: viewParam, onView, onBack, readOnly, copyFrom, onMakeExact }) {
  const ed = useFlatEditor(flatId);
  const skus = useStore((s) => s.skuCatalog);
  const focusSoon = useFocusSoon();
  const [areaId, setAreaId] = useState(null);
  const [panel, setPanel] = useState('zones');
  const [mode, setMode] = useState('select');
  const [removed, setRemovedMap] = useState({});
  const { draft, base } = ed;
  const kinds = draft ? viewOrder(draft) : [];
  const kind = kinds.includes(viewParam) ? viewParam : kinds[0];
  const view = draft?.views.find((v) => v.kind === kind) ?? null;
  const markup = useViewMarkup(view?.svg_path, kind ? ed.files[kind] : undefined);
  const accessory = draft ? isAccessoryType(draft.garment_type) : false;
  const isNew = !base;
  const vb = markup.vb;
  const mmW = vb && view ? vb.w * view.scale_mm_per_unit : null;
  const mmH = vb && view ? vb.h * view.scale_mm_per_unit : null;
  const setRemoved = (k, items) => setRemovedMap((m) => ({ ...m, [k]: items ?? undefined }));
  const actions = useFlatViewActions({
    draft, base, files: ed.files, setDraft: ed.setDraft, setFile: ed.setFile, zones: ed.zonesCatalog,
    accessory, setKind: onView, setRemoved, focusSoon,
  });

  const check = useMemo(() => (draft ? validateFlat(draft, {
    reservedIds: ed.reservedIds, isNew, base, activeFlats: ed.allFlats, zonesCatalog: ed.zonesCatalog,
    skuCodes: new Set(skus.map((s) => s.code)), flatMm: mmW && kind ? { [kind]: { w: mmW, h: mmH } } : {}, catalogBytes: ed.catalogBytes,
  }) : NO_CHECK), [draft, ed.reservedIds, isNew, base, ed.allFlats, ed.zonesCatalog, skus, mmW, mmH, kind, ed.catalogBytes]);
  const flatMm = mmW ? { w: mmW, h: mmH } : null;

  if (!draft) {
    if (flatId === 'new' && (ed.state === 'ready' || ed.state === 'error') && !readOnly) {
      const ready = (d, files, rem) => {
        ed.setDraft(() => d);
        for (const [k, svg] of Object.entries(files)) ed.setFile(k, svg);
        setRemovedMap(rem);
        onView(viewOrder(d)[0]);
      };
      return <NewFlatForm reservedIds={ed.reservedIds} zones={ed.zonesCatalog} skus={skus} copyFrom={copyFrom} onReady={ready} />;
    }
    return <FlatEditorEmpty ed={ed} flatId={flatId} onBack={onBack} canRepair={!readOnly} />;
  }

  const ctx = {
    draft, base, kind, areaId: view?.print_areas.some((a) => a.id === areaId) ? areaId : view?.print_areas[0]?.id ?? null,
    selectArea: setAreaId, edit: ed.setDraft, zones: ed.zonesCatalog, errors: check.errors, focusSoon, flatMm,
    vb, markup, removed, mode, setMode, setKind: onView, accessory, readOnly, skus, actions,
    onMakeExact: base && !readOnly ? () => onMakeExact(base) : null,
  };
  const go = (i) => {
    const t = issueTarget(i);
    setPanel(t.panel);
    if (t.view) onView(t.view);
    if (t.areaId) setAreaId(t.areaId);
    focusSoon(t.fieldId);
  };

  return (
    <div className={styles.editor}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={onBack}>← Все флэты</button>
        <h2 id="flat-editor-title" className={styles.title} tabIndex={-1}>{draft.name || 'Новый флэт'}</h2>
        <span id="flat-version-badge" className={styles.badge} tabIndex={-1} role="status">
          {isNew ? 'Новый, ещё не сохранён' : `Версия ${base.version}`}
        </span>
        {ed.dirty && <span className={styles.unsaved}>Есть несохранённые правки</span>}
      </header>
      {readOnly && <p className={styles.hint}>{READ_ONLY_TEXT}</p>}
      <FlatNotice ed={ed} />

      <div className={styles.columns}>
        <div className={styles.sticky}>
          {view && <FlatCanvasPane ctx={ctx} view={view} />}
        </div>
        <div className={styles.side}>
          <div className={styles.tabs} role="tablist" aria-label="Панель флэта">
            {PANELS.map((p) => (
              <button key={p} type="button" role="tab" id={`flat-panel-tab-${p}`} className={styles.tab}
                aria-selected={panel === p} aria-controls="flat-panel" onClick={() => setPanel(p)}>
                {PANEL_LABELS[p]}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="flat-panel" aria-labelledby={`flat-panel-tab-${panel}`}>
            <fieldset className={styles.plain} disabled={readOnly}>
              <legend className={styles.srOnly}>{PANEL_LABELS[panel]}</legend>
              {panel === 'zones' && view && <AreasSection ctx={ctx} view={view} />}
              {panel === 'view' && view && <FlatViewsSection ctx={ctx} view={view} />}
              {panel === 'model' && <FlatModelSection ctx={ctx} />}
            </fieldset>
            {panel === 'history' && <FlatHistory flat={draft} />}
          </div>
        </div>
      </div>

      {!readOnly && <FlatSaveBar ed={ed} check={check} isNew={isNew} readOnly={readOnly} onGo={go} focusSoon={focusSoon} />}
    </div>
  );
}
