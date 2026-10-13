// Неизменяемая запись и чтение по пути — для редактора цен (правка 13.10)
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Запись по пути без мутации; массивы остаются массивами */
export function setIn(obj: any, path: string[], value: unknown): any {
  if (path.length === 0) return value;
  const [k, ...rest] = path;
  const cur = obj ?? (/^\d+$/.test(k) ? [] : {});
  const next = Array.isArray(cur) ? [...cur] : { ...cur };
  next[k as any] = setIn(cur[k], rest, value);
  return next;
}

export function getIn(obj: any, path: string[]): any {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
