import { useCallback, useMemo, useRef, useState } from 'react';
import { confirm } from '../../../store/useConfirmStore';
import { pluralize } from '../../../utils/i18n';
import {
  markAllFull, rollUsageErrors, rollUsedM, usagePayload, usageTotals,
} from '../../utils/cutUsage';
import { cutExtras } from '../../utils/cutExtras';
import { cellKey } from '../../utils/cellKey';
import { NO_COLOR } from '../../utils/sizeGrid';
import { normalizeSize, sizeChoicesFor } from '../../utils/sizeChoices';
import {
  METRES_MISSING_TEXT, rollAvailableM, rollWorkingLength, roundM,
} from '../../utils/fabricMetres';

const NONE = Object.freeze({});
const EMPTY = Object.freeze([]);

/** «100 м», «38,5 м» — без хвостовых нулей, как в тексте спеки */
export function metres(n) {
  return `${String(roundM(Number(n) || 0)).replace('.', ',')} м`;
}

/** «рулон №12» — подпись рулона внутри фразы */
export function rollName(option) {
  const label = option?.roll?.label || `Рулон №${option?.roll?.seq ?? ''}`;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Группа «<материал> · <цвет>»: рулоны одного материала и их итоги */
export function materialLabel(material) {
  const name = material?.fact_name || material?.name || 'Материал';
  const color = material?.fact_color || material?.color;
  return color ? `${name} · ${color}` : name;
}

/** «Средний 0,88 м/шт», «(по всей позиции)» или почему его ещё нет (Р6) */
export function avgText(total) {
  if (!total || total.avgPerGood === null) return 'Средний — введите годные в «Результат кроя»';
  const avg = total.avgPerGood.toFixed(2).replace('.', ',');
  return `Средний ${avg} м/шт${total.avgScope === 'item' ? ' (по всей позиции)' : ''}`;
}

function parseLeftover(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toRow(option, state) {
  return {
    rollId: option.roll.id,
    materialId: option.material.id,
    use: state?.use ?? 'unused',
    leftoverM: parseLeftover(state?.leftoverRaw),
    fate: state?.fate ?? null,
  };
}

function rowsOf(options, byRoll) {
  return options.map((o) => toRow(o, byRoll[o.roll.id]));
}

/** Почему строку рулона нельзя сдать: модель + рулон без метража */
function errorsOf(option, row) {
  if (row.use === 'unused') return EMPTY;
  const available = rollAvailableM(option.roll, option.material);
  // Расчёт по параметрам виден, но записать расход можно только по метражу сервера (27.09, п. 4)
  if (available === null || !rollWorkingLength(option.roll, option.material)?.stored) {
    return [`${METRES_MISSING_TEXT} — укажите ширину и плотность полотна или метраж рулона`];
  }
  return rollUsageErrors(available, row);
}

/** Какое поле строки ошибочно первым: остаток, судьба или сам режим */
function errorField(errors) {
  if (errors.some((e) => e.startsWith(METRES_MISSING_TEXT))) return 'use';
  if (errors.some((e) => e.startsWith('Введите остаток') || e.startsWith('Остаток '))) return 'leftover';
  return 'fate';
}

function goodOf(sizesRows, cells) {
  const byColor = new Map();
  let total = 0;
  const sizes = [];
  for (const row of sizesRows) {
    const qty = Math.max(Math.round(Number(cells[row.key]) || 0), 0);
    if (qty <= 0) continue;
    total += qty;
    byColor.set(row.color, (byColor.get(row.color) ?? 0) + qty);
    sizes.push({ color: row.color, size: row.size, qty_good: qty });
  }
  return { byColor, total, sizes };
}

/**
 * СОСТОЯНИЕ ФОРМЫ ЗАКРОЯ (правки 19.10, «Закрой»): таблица «Результат кроя»
 * (выпуск один раз, Р5), режимы рулонов «Расхода ткани», выбор для
 * массового «Использованы полностью», ошибки и строки для сервера.
 *
 * Итоги для липкой полосы (`barTotals`) — СНИМОК: обновляется по `blur`
 * и смене режима (`commit`), а не по каждой цифре — полоса с `role="status"`
 * иначе зачитывала бы каждое нажатие.
 */
export function useCutReport({ stage, order, item = null, options = EMPTY, reported = NONE }) {
  const theItem = item ?? (order?.items ?? []).find((it) => it.id === stage?.item_id) ?? null;
  const grid = theItem?.size_grid;
  const [form, setForm] = useState(() => ({
    byRoll: {}, cells: {}, extra: [], shown: { byRoll: {}, cells: {} },
  }));
  const [selected, setSelected] = useState(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState('');
  const firstErrorRef = useRef(null);
  /** Флажок «Выбрать все» первой группы — сюда фокус по «Отметить рулоны» (Р7) */
  const firstGroupRef = useRef(null);
  const bindFirstGroup = useCallback((el) => { firstGroupRef.current = el; }, []);

  const sizesRows = useMemo(() => {
    const choices = sizeChoicesFor(grid);
    // Цвет в подписи — только когда их у позиции несколько: «S», а не «S · чёрный»
    const manyColors = new Set(choices.map((c) => c.color)).size > 1;
    const planned = choices.map((c) => ({
      key: cellKey(c.color, c.size), color: c.color, size: c.size, label: manyColors ? c.label : c.size,
      planned: c.planned, extra: false,
    }));
    const taken = new Set(planned.map((r) => r.key));
    const extra = form.extra
      .map((x) => ({ key: cellKey(x.color, x.size), color: x.color, size: x.size, label: x.size, planned: null, extra: true }))
      .filter((r) => !taken.has(r.key));
    return [...planned, ...extra].map((r) => ({ ...r, reported: reported[r.key] ?? 0 }));
  }, [grid, form.extra, reported]);

  const usageRows = useMemo(() => rowsOf(options, form.byRoll), [options, form.byRoll]);
  const good = useMemo(() => goodOf(sizesRows, form.cells), [sizesRows, form.cells]);
  const shownGood = useMemo(() => goodOf(sizesRows, form.shown.cells), [sizesRows, form.shown.cells]);
  const totals = useMemo(
    () => usageTotals(options, usageRows, good.byColor, good.total),
    [options, usageRows, good],
  );
  const barTotals = useMemo(
    () => usageTotals(options, rowsOf(options, form.shown.byRoll), shownGood.byColor, shownGood.total),
    [options, form.shown.byRoll, shownGood],
  );

  const errors = useMemo(() => {
    const out = {};
    options.forEach((o, i) => {
      const list = errorsOf(o, usageRows[i]);
      if (list.length > 0) out[o.roll.id] = list;
    });
    return out;
  }, [options, usageRows]);
  const errorIds = options.map((o) => o.roll.id).filter((id) => errors[id]);
  const firstError = errorIds.length > 0
    ? { rollId: errorIds[0], field: errorField(errors[errorIds[0]]) } : null;

  /**
   * Видимые ошибки строки: после попытки сдать — все; до неё — «нет метража»
   * сразу (выбор режима ничего не даст) и прочие, когда остаток уже введён.
   */
  const visibleErrors = useCallback((rollId) => {
    const list = errors[rollId] ?? EMPTY;
    if (attempted) return list;
    const row = form.byRoll[rollId];
    const typed = row?.use === 'partial' && parseLeftover(row.leftoverRaw) !== null;
    return typed ? list : list.filter((e) => e.startsWith(METRES_MISSING_TEXT));
  }, [errors, attempted, form.byRoll]);

  const patchRoll = (rollId, patch, commit) => {
    // Объявление массового действия устарело, как только строку поменяли руками
    if (commit) setMessage('');
    setForm((f) => {
      const byRoll = { ...f.byRoll, [rollId]: { ...f.byRoll[rollId], ...patch } };
      return { ...f, byRoll, shown: commit ? { byRoll, cells: f.cells } : f.shown };
    });
  };
  const setUse = (rollId, use) => patchRoll(rollId, { use }, true);
  const setLeftover = (rollId, raw) => patchRoll(rollId, { leftoverRaw: raw }, false);
  const setFate = (rollId, fate) => patchRoll(rollId, { fate }, true);
  const setCell = (key, value) => setForm((f) => ({ ...f, cells: { ...f.cells, [key]: value } }));
  const commit = () => setForm((f) => ({ ...f, shown: { byRoll: f.byRoll, cells: f.cells } }));

  /** «Размер вне заказа…»: пустой и уже имеющийся не добавляются — текст причины */
  const addSize = (raw, color = NO_COLOR) => {
    const size = normalizeSize(raw);
    if (!size) return 'Введите размер';
    const key = cellKey(color || NO_COLOR, size);
    if (sizesRows.some((r) => r.key === key)) return `Размер ${size} уже в таблице`;
    setForm((f) => ({ ...f, extra: [...f.extra, { size, color: color || NO_COLOR }] }));
    return null;
  };

  const toggleSelect = (rollId) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(rollId)) next.delete(rollId); else next.add(rollId);
    return next;
  });
  const selectGroup = (ids, on) => setSelected((cur) => {
    const next = new Set(cur);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });

  /**
   * «Использованы полностью» для выбранных в группе. Введённый частичный
   * остаток молча не затирается — сначала вопрос. После действия выбор
   * снимается, а полоса объявляет итог.
   */
  const markSelectedFull = async (ids) => {
    const pick = ids.filter((id) => selected.has(id));
    if (pick.length === 0) return false;
    const partial = pick.filter((id) => {
      const row = form.byRoll[id];
      return row?.use === 'partial' && parseLeftover(row.leftoverRaw) !== null;
    });
    if (partial.length > 0 && !(await confirm({
      title: `У ${partial.length} ${pluralize(partial.length, 'рулона', 'рулонов', 'рулонов')} введён остаток. Отметить полностью?`,
      confirmLabel: 'Отметить полностью',
      cancelLabel: 'Не менять',
    }))) return false;
    const marked = markAllFull(usageRows, pick);
    const used = pick.reduce((sum, id) => {
      const option = options.find((o) => o.roll.id === id);
      const row = marked.find((r) => r.rollId === id);
      return sum + rollUsedM(rollAvailableM(option.roll, option.material) ?? 0, row);
    }, 0);
    setForm((f) => {
      const byRoll = { ...f.byRoll };
      for (const id of pick) byRoll[id] = { use: 'full', leftoverRaw: '', fate: null };
      return { ...f, byRoll, shown: { byRoll, cells: f.cells } };
    });
    selectGroup(pick, false);
    setMessage(`${pick.length} ${pluralize(pick.length, 'рулон', 'рулона', 'рулонов')}: полностью. Расход ${metres(used)}`);
    return true;
  };

  /** Попытка сдать: включает показ всех ошибок, возвращает их число */
  const attempt = () => {
    setAttempted(true);
    return errorIds.length;
  };

  const payload = useMemo(
    () => ({ sizes: good.sizes, rolls: usagePayload(options, usageRows) }),
    [good, options, usageRows],
  );
  const extras = useMemo(
    () => cutExtras([{ sizes: good.sizes.map((s) => ({ ...s, qty: s.qty_good })) }], grid, reported),
    [good, grid, reported],
  );

  return {
    sizesRows, cells: form.cells, setCell, addSize, commit,
    usageRows, setUse, setLeftover, setFate, leftoverRaw: (id) => form.byRoll[id]?.leftoverRaw ?? '',
    selected, toggleSelect, selectGroup, markSelectedFull, message,
    errors, visibleErrors, errorCount: errorIds.length, firstError, firstErrorRef, firstGroupRef, bindFirstGroup,
    attempted, attempt,
    payload, totals, barTotals, goodTotal: good.total, extras, hasGrid: sizeChoicesFor(grid).length > 0,
  };
}
