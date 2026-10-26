/**
 * «Повторить заказ» (веха 5в, Э8) — поток по кнопке в шапке рабочего места;
 * грузится только `import()` из `HeadActions` (бюджет рабочего места).
 *
 * 1. Источник сохранён: `flush`, затем только `clean` или `locked` (не черновик) —
 *    иначе снимок не равен сохранённому, отказ словами.
 * 2. Подтверждение → `createNew` с шапкой и телом БЕЗ файлов (`repeatDraft`) —
 *    новый черновик сразу полон позиций; переход на него.
 * 3. Серверные копии файлов (по 4 одновременно; PDF/AI — парой с `.preview.png`:
 *    не скопировалось превью — файл не скопирован).
 * 4. Привязка путей (`attachFiles`) — только если открыт ТОТ ЖЕ новый заказ
 *    (проверка и `edit` синхронны: правка не уйдёт в другой заказ); затем `flush`.
 *
 * Повторный вызов во время работы получает тот же промис — второго заказа нет.
 */
import { copyArtwork, artworkPreviewPath } from '../api/artworks';
import { attachFiles, orderFilePaths, previewSources, repeatDraft, repeatHeader } from '../model/repeatOrder';
import type { SalesOrder } from '../model/types';
import { useSalesStore } from '../store/useSalesStore';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { pluralize } from '../../utils/i18n';

export const COPY_CONCURRENCY = 4;
export const MSG_SAVE_FIRST = 'Повтор берёт сохранённый заказ — дождитесь сохранения или обновите страницу';

export interface RepeatUser {
  id: string;
  name?: string | null;
}

let pending: Promise<string | null> | null = null;

async function copyFiles(src: SalesOrder, toId: string): Promise<Record<string, string>> {
  const queue = orderFilePaths(src);
  const paired = previewSources(src);
  const map: Record<string, string> = {};
  const one = async (path: string) => {
    const to = await copyArtwork(path, toId);
    if (!to) return;
    if (paired.has(path) && !(await copyArtwork(artworkPreviewPath(path), toId))) return;
    map[path] = to;
  };
  const workers = Array.from({ length: Math.min(COPY_CONCURRENCY, queue.length) }, async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) await one(path);
  });
  await Promise.all(workers);
  return map;
}

const filesText = (n: number) => `${n} ${pluralize(n, 'файл', 'файла', 'файлов')}`;

async function run(user: RepeatUser, go: (id: string) => void): Promise<string | null> {
  await useSalesStore.getState().flush();
  const { current: src, saveState } = useSalesStore.getState();
  if (!src?.id) return null;
  if (saveState !== 'clean' && saveState !== 'locked') {
    toast.error(MSG_SAVE_FIRST);
    return null;
  }
  const ok = await confirm({
    title: `Повторить заказ ${src.number}?`,
    message: 'Будет новый черновик с теми же изделиями, нанесениями, бирками и файлами. Срок и оплату задайте заново.',
    confirmLabel: 'Создать черновик',
  });
  if (!ok) return null;

  const draft = repeatDraft(src);
  const id = await useSalesStore.getState().createNew({
    ...repeatHeader(src),
    ...draft.seed,
    ...(user.name ? { manager: user.name } : {}),
    created_by: user.id,
  });
  if (!id) return null;
  go(id);
  if (draft.links.length === 0) {
    toast.success(`Создан черновик — повтор ${src.number}`);
    return id;
  }

  const map = await copyFiles(src, id);
  let dropped = 0;
  let attached = false;
  const st = useSalesStore.getState();
  if (st.current?.id === id) {
    st.edit((o) => {
      const res = attachFiles(o, draft.links, map);
      dropped = res.dropped;
      attached = true;
      return res.order;
    });
  }
  if (!attached) {
    toast.warning(`Черновик повтора ${src.number} создан без файлов: его закрыли или он не сохранился до конца копирования — загрузите файлы заново`);
    return id;
  }
  await useSalesStore.getState().flush();
  toast.success(`Создан черновик — повтор ${src.number}`);
  if (dropped > 0) toast.warning(`${filesText(dropped)} ${pluralize(dropped, 'не скопировался', 'не скопировались', 'не скопировались')} — загрузите заново`);
  return id;
}

/** Повторить открытый заказ; ответ — id нового черновика либо `null` (отказ, тост уже показан) */
export function repeatOrder(user: RepeatUser, go: (id: string) => void): Promise<string | null> {
  if (!pending) pending = run(user, go).finally(() => { pending = null; });
  return pending;
}
