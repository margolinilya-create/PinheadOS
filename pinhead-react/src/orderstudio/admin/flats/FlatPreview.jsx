import { useState } from 'react';
import { useStore } from '../../../store/useStore';
import { TZ_ROW_LABELS, tzRowOfArea } from '../../catalog/tzRows';
import { VIEW_LABELS } from '../../design/catalog/flatLabels';
import { areaRect } from '../../design/edit/flatEdit';
import { svgToDataUrl } from '../../design/export/flatMarkup';
import { missingText, OFF_TEXT, PHONE_TEXT, viewOrder } from './flatEditorView';
import { useViewMarkup } from './useViewMarkup';
import styles from './FlatEditor.module.css';

const mm = (v) => String(Math.round(v)).replace('.', ',');

/**
 * Флэт на телефоне (≤ 760 px, веха 5б, задача 6б): только просмотр, без konva —
 * вкладки видов, картинка `<img>` очищенной разметки, список зон «Зона — размер —
 * строка ТЗ» и подпись «Править — с компьютера». Флэта нет в справочнике —
 * текст «ссылка устарела» и «К списку флэтов».
 */
export default function FlatPreview({ flat, flatId, onBack }) {
  const zones = useStore((s) => s.zonesCatalog);
  const kinds = flat ? viewOrder(flat) : [];
  const [chosen, setKind] = useState(null);
  const kind = kinds.includes(chosen) ? chosen : kinds[0];
  const view = flat?.views.find((v) => v.kind === kind) ?? null;
  const markup = useViewMarkup(view?.svg_path, undefined);
  const areas = view?.print_areas ?? [];

  if (!flat) {
    return (
      <div className={styles.notice} role="status">
        <p>{missingText(flatId)}</p>
        <button type="button" className="btn" onClick={onBack}>К списку флэтов</button>
      </div>
    );
  }

  return (
    <div className={styles.preview}>
      <button type="button" className={styles.back} onClick={onBack}>← Все флэты</button>
      <h2 className={styles.title}>{flat.name}</h2>
      <p className={styles.hint}>{`Версия ${flat.version}`}</p>
      {!flat.active && <p className={styles.hint}>{OFF_TEXT}</p>}
      <div className={styles.tabs} role="tablist" aria-label="Виды флэта">
        {kinds.map((k) => (
          <button key={k} type="button" role="tab" id={`flat-preview-tab-${k}`} className={styles.tab}
            aria-selected={k === kind} aria-controls="flat-preview-panel" onClick={() => setKind(k)}>
            {VIEW_LABELS[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="flat-preview-panel" aria-labelledby={`flat-preview-tab-${kind}`}>
        {markup.state === 'ready' && (
          <img className={styles.previewImg} src={svgToDataUrl(markup.markup)}
            alt={`Силуэт «${flat.name}», вид ${VIEW_LABELS[kind]}, зон: ${areas.length}`} />
        )}
        {markup.state === 'loading' && <p className={styles.hint} role="status">Загружаю силуэт…</p>}
        {markup.state === 'error' && (
          <div className={styles.inlineNotice} role="alert">
            <p>Силуэт вида не загрузился.</p>
            <button type="button" className="btn" onClick={markup.retry}>Загрузить снова</button>
          </div>
        )}
        <ul className={styles.previewZones} aria-label="Зоны вида">
          {areas.map((a) => {
            const r = areaRect(a);
            return <li key={a.id}>{`${a.name} — ${mm(r.w)} × ${mm(r.h)} мм — ${TZ_ROW_LABELS[tzRowOfArea(a, zones ?? [])]}`}</li>;
          })}
        </ul>
      </div>
      <p className={styles.hint}>{PHONE_TEXT}</p>
    </div>
  );
}
