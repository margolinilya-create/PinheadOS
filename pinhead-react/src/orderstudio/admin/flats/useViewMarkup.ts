/**
 * Разметка вида для редактора и превью флэта (веха 5б, задача 6б): выбранный
 * файл — сразу; иначе свежее скачивание SVG по пути вида из бакета флэтов.
 *
 * Не кэш холста `loadFlatMarkup` (5а): тот помнит неудачу (`null`) до перезагрузки
 * вкладки, и «Загрузить снова» не помогало бы. Здесь в памяти — только удачные
 * тексты: путь версии неизменяем (решение 3), его текст не устаревает.
 * Разметка проходит санитайзер повторно (`resolveFlat`), габарит — viewBox
 * в единицах SVG (масштаб вида применяет экран).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadFlatSvg } from '../../api/garmentFlats';
import { resolveFlat } from '../../design/export/resolveFlat';

export interface ViewMarkup {
  state: 'none' | 'loading' | 'ready' | 'error';
  markup: string | null;
  /** viewBox, единицы SVG */
  vb: { w: number; h: number } | null;
  retry(): void;
}

const texts = new Map<string, string>();

/** Для тестов: забыть скачанные тексты */
export function forgetViewMarkup(): void {
  texts.clear();
}

const UNIT = { scale_mm_per_unit: 1 };

function resolved(text: string | undefined | null) {
  const r = text ? resolveFlat(text, UNIT) : null;
  return r ? { markup: r.markup, vb: r.flatMm } : null;
}

export function useViewMarkup(path: string | null | undefined, file: string | undefined): ViewMarkup {
  const [loaded, setLoaded] = useState<{ path: string; text: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cached = path ? texts.get(path) : undefined;

  useEffect(() => {
    if (file !== undefined || !path || texts.has(path)) return undefined;
    let alive = true;
    void downloadFlatSvg(path).then((text) => {
      if (text) texts.set(path, text);
      if (alive) setLoaded({ path, text });
    });
    return () => { alive = false; };
  }, [path, file, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, []);

  return useMemo(() => {
    if (file !== undefined) {
      const r = resolved(file);
      return { state: r ? 'ready' : 'error', markup: r?.markup ?? null, vb: r?.vb ?? null, retry };
    }
    if (!path) return { state: 'none', markup: null, vb: null, retry };
    const text = cached ?? (loaded?.path === path ? loaded.text : undefined);
    if (text === undefined) return { state: 'loading', markup: null, vb: null, retry };
    const r = resolved(text);
    return { state: r ? 'ready' : 'error', markup: r?.markup ?? null, vb: r?.vb ?? null, retry };
  }, [file, path, cached, loaded, retry]);
}
