import { useId, useState } from 'react';
import { VIEW_LABELS } from '../../design/catalog/flatLabels';
import { pieceSizeText, toPatternPieces, UNIT_TO_MM } from '../../design/edit/pattern/importPattern';
import { MmField } from './flatFields';
import { GEOMETRY_HINT } from './flatEditorView';
import { alignToView, shiftPattern, unfold } from './patternAlign';
import base from '../../screens/Sales.module.css';
import styles from './FlatEditor.module.css';

/** Файл лекал — до 2 МБ (DXF детали футболки — десятки кБ) */
export const PATTERN_FILE_MAX = 2 * 1024 * 1024;
const UNIT_LABELS = { mm: 'мм', cm: 'см', in: 'дюймы' };
const SKIP = '';

/** Роль по имени детали из файла: перед / спина / рукав — подсказка, человек поправит */
function guessRole(name, kinds, taken) {
  const n = name.toLowerCase();
  const want = /front|перед|полоч/.test(n) ? ['front']
    : /back|спин/.test(n) ? ['back']
      : /sleeve|рукав/.test(n) ? ['sleeve_left', 'sleeve_right'] : [];
  return want.find((k) => kinds.includes(k) && !taken.has(k)) ?? SKIP;
}

/** Контур детали маленькой картинкой (только глазам) */
function PiecePreview({ contour }) {
  const xs = contour.map((p) => p[0]);
  const ys = contour.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x || 1;
  const h = Math.max(...ys) - y || 1;
  return (
    <svg className={styles.piecePreview} viewBox={`${x} ${y} ${w} ${h}`} aria-hidden="true" focusable="false">
      <polygon points={contour.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth={Math.max(w, h) / 60} />
    </svg>
  );
}

/** Разбор файла: разборщики DXF и SVG — по `import()` при выборе файла (не в чанке редактора) */
async function readPattern(file) {
  if (file.size > PATTERN_FILE_MAX) return { error: 'Файл больше 2 МБ — сохраните лекала без лишних слоёв' };
  const text = await file.text();
  const isDxf = /\.dxf$/i.test(file.name) || /^\s*0\s*\r?\n\s*SECTION/.test(text);
  if (isDxf) {
    const { parseDxf } = await import('../../design/edit/pattern/dxf');
    const r = parseDxf(text);
    return { raw: r.pieces, unit: r.units === 'm' ? null : r.units, known: r.units !== null, mmPerUnit: r.units ? UNIT_TO_MM[r.units] : null, notes: r.notes };
  }
  if (/\.svg$/i.test(file.name) || /<svg[\s>]/i.test(text)) {
    const { parseSvgContours } = await import('../../design/edit/pattern/svgContours');
    const r = parseSvgContours(text);
    return { raw: r.pieces, unit: null, known: r.unitMm !== null, mmPerUnit: r.unitMm, notes: r.notes };
  }
  return { error: 'Нужен файл DXF или SVG от программы конструктора' };
}

/**
 * Вкладка «Лекала» редактора флэта (веха 5в, Э2б): файл конструктора DXF/SVG →
 * детали → роль у каждой (вид флэта), «половина со сгибом», кол-во в крое →
 * лекала выравниваются по якорям вида (приблизительно — дальше сдвиг вручную,
 * контур виден поверх флэта на холсте). Лекало — геометрия: сохранение выпускает
 * новую версию флэта.
 */
export default function PatternSection({ ctx }) {
  const id = useId();
  const { draft } = ctx;
  const kinds = draft.views.map((v) => v.kind);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [unit, setUnit] = useState('mm');
  const [rows, setRows] = useState([]);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const res = await readPattern(f);
    if (res.error) { setError(res.error); setFile(null); return; }
    if (!res.raw.length) { setError(['В файле нет замкнутых контуров деталей', ...res.notes].join('. ')); setFile(null); return; }
    setError(null);
    setFile(res);
    if (res.unit) setUnit(res.unit);
    const taken = new Set();
    setRows(res.raw.map((p) => {
      const role = guessRole(p.name, kinds, taken);
      if (role) taken.add(role);
      return { role, fold: 'none', count: 1 };
    }));
  };

  const mmPerUnit = file ? (file.known ? file.mmPerUnit : UNIT_TO_MM[unit]) : 1;
  const pieces = file ? toPatternPieces(file.raw, mmPerUnit) : [];
  const roles = rows.map((r) => r.role).filter(Boolean);
  const dup = roles.find((r, i) => roles.indexOf(r) !== i);
  const blocked = dup ? `Две детали на «${VIEW_LABELS[dup]}» — оставьте одну` : roles.length === 0 ? 'Выберите вид хотя бы у одной детали' : null;
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const apply = () => {
    if (blocked) return;
    const byKind = new Map();
    pieces.forEach((p, i) => {
      const r = rows[i];
      if (!r?.role) return;
      const contour = r.fold === 'none' ? p.contour_mm : unfold(p.contour_mm, r.fold);
      byKind.set(r.role, { contour, count: r.count });
    });
    ctx.edit((f) => ({
      ...f,
      views: f.views.map((v) => (byKind.has(v.kind) ? { ...v, pattern: alignToView(byKind.get(v.kind).contour, v, byKind.get(v.kind).count) } : v)),
    }));
    setFile(null);
    setRows([]);
  };
  const editView = (kind, fn) => ctx.edit((f) => ({ ...f, views: f.views.map((v) => (v.kind === kind ? fn(v) : v)) }));
  const withPattern = draft.views.filter((v) => v.pattern);

  return (
    <section className={styles.section} aria-labelledby={`${id}-head`}>
      <h3 id={`${id}-head`} className={styles.sectionHead}>Лекала деталей</h3>
      <p className={styles.geoHint}>{GEOMETRY_HINT}</p>
      <p className={styles.hint}>
        Файл конструктора DXF (AAMA/ASTM) или SVG. Деталь ставится по оси и опорам вида приблизительно —
        проверьте контур поверх флэта на холсте и сдвиньте при необходимости.
      </p>

      {withPattern.length > 0 && (
        <ul className={styles.patternList} aria-label="Лекала видов">
          {withPattern.map((v) => {
            const xs = v.pattern.contour_mm.map((p) => p[0]);
            const ys = v.pattern.contour_mm.map((p) => p[1]);
            const size = pieceSizeText({ width_mm: Math.max(...xs) - Math.min(...xs), height_mm: Math.max(...ys) - Math.min(...ys) });
            return (
              <li key={v.kind} className={styles.patternRow}>
                <PiecePreview contour={v.pattern.contour_mm} />
                <span>{`${VIEW_LABELS[v.kind]} · ${size} · крой: ${v.pattern.count}`}</span>
                <div className={styles.inline}>
                  <MmField id={`${id}-${v.kind}-dx`} label="Сдвинуть по X, мм" value={0} min={-500} max={500}
                    onCommit={(dx) => dx && editView(v.kind, (w) => ({ ...w, pattern: shiftPattern(w.pattern, dx, 0) }))} />
                  <MmField id={`${id}-${v.kind}-dy`} label="Сдвинуть по Y, мм" value={0} min={-500} max={500}
                    onCommit={(dy) => dy && editView(v.kind, (w) => ({ ...w, pattern: shiftPattern(w.pattern, 0, dy) }))} />
                  <button type="button" className="btn" onClick={() => editView(v.kind, ({ pattern: _drop, ...w }) => w)}>
                    {`Убрать лекало «${VIEW_LABELS[v.kind]}»`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={base.field}>
        <label htmlFor={`${id}-file`}>Загрузить лекала (DXF или SVG)</label>
        <input id={`${id}-file`} type="file" accept=".dxf,.svg,image/svg+xml" onChange={pick}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} />
        {error && <span id={`${id}-err`} className={styles.fieldError} role="alert">{error}</span>}
      </div>

      {file && (
        <>
          {file.notes.map((n) => <p key={n} className={styles.warnText}>{n}</p>)}
          {!file.known && (
            <div className={base.field}>
              <label htmlFor={`${id}-unit`}>Единицы файла (в файле не указаны)</label>
              <select id={`${id}-unit`} className={base.select} value={unit} onChange={(e) => setUnit(e.target.value)}>
                {Object.entries(UNIT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          )}
          <ul className={styles.patternList} aria-label="Детали из файла">
            {pieces.map((p, i) => (
              <li key={`${p.name}-${i}`} className={styles.patternRow}>
                <PiecePreview contour={p.contour_mm} />
                <span>{`${p.name} · ${pieceSizeText(p)}`}</span>
                <div className={styles.inline}>
                  <div className={base.field}>
                    <label htmlFor={`${id}-role-${i}`}>Деталь</label>
                    <select id={`${id}-role-${i}`} className={base.select} value={rows[i]?.role ?? SKIP} onChange={(e) => setRow(i, { role: e.target.value })}>
                      <option value={SKIP}>Не брать</option>
                      {kinds.map((k) => <option key={k} value={k}>{VIEW_LABELS[k]}</option>)}
                    </select>
                  </div>
                  <div className={base.field}>
                    <label htmlFor={`${id}-fold-${i}`}>Форма</label>
                    <select id={`${id}-fold-${i}`} className={base.select} value={rows[i]?.fold ?? 'none'} onChange={(e) => setRow(i, { fold: e.target.value })}>
                      <option value="none">Целая деталь</option>
                      <option value="right">Половина, сгиб справа</option>
                      <option value="left">Половина, сгиб слева</option>
                    </select>
                  </div>
                  <div className={base.field}>
                    <label htmlFor={`${id}-count-${i}`}>В крое, шт</label>
                    <input id={`${id}-count-${i}`} className={base.input} type="number" min="1" max="8" value={rows[i]?.count ?? 1}
                      onChange={(e) => setRow(i, { count: Math.min(8, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.inline}>
            <button type="button" className="btn btn-primary" aria-disabled={blocked ? 'true' : undefined}
              aria-describedby={blocked ? `${id}-why` : undefined} onClick={apply}>
              Поставить лекала на виды
            </button>
            <button type="button" className="btn" onClick={() => { setFile(null); setRows([]); }}>Отмена</button>
          </div>
          {blocked && <p id={`${id}-why`} className={styles.hint}>{blocked}</p>}
        </>
      )}
    </section>
  );
}
