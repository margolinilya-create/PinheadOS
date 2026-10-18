/**
 * Кэши картинок холста по требованию (веха 5а, задача 6б, раунд 1).
 *
 * `flatImages` (силуэт: скачивание, санитайзер, перекраска) и `artworkImages`
 * (логотипы: скачивание, проверка байтов, санитайзер) вместе с `sanitizeSvg`
 * и `sniff` — ≈ 6 кБ gzip. Картинки всё равно приходят из бакета асинхронно,
 * поэтому их кэши грузятся `import()` при первой картинке, а не в чанке холста
 * (потолок 100 кБ gzip, `design/README.md`). Тот же чанк читают превью
 * телефона и PDF макета — он качается один раз.
 *
 * - `flatImagesModule.get()` / `artworkImagesModule.get()` — модуль; чанк
 *   не загрузился — `null` (диалог «Вышло обновление» или один тост на попытку;
 *   следующая картинка пробует снова);
 * - `releaseFlatImages` / `releaseArtworkImages` — освободить object URL,
 *   если кэш уже загружен (не загружен — освобождать нечего, чанк не качаем).
 */
import { handlePossibleUpdate } from '../../../lib/appUpdate';
import { toast } from '../../../store/useToastStore';

export const MSG_IMAGES_UNAVAILABLE = 'Картинки холста не загрузились — обновите страницу';

export interface LazyModule<M> {
  /** Модуль; не загрузился — `null` */
  get(): Promise<M | null>;
  /** Уже загруженный модуль или `null` (без загрузки) */
  loaded(): M | null;
}

/** Ленивый модуль с одной загрузкой на попытку и повтором после сбоя */
export function lazyModule<M>(name: string, load: () => Promise<M>): LazyModule<M> {
  let mod: M | null = null;
  let pending: Promise<M | null> | null = null;
  return {
    get() {
      if (mod) return Promise.resolve(mod);
      pending ??= load().then(
        (m) => {
          mod = m;
          return m;
        },
        (e: unknown) => {
          pending = null;
          console.error(`imageLayer: ${name}`, e);
          if (!handlePossibleUpdate(e)) toast.error(MSG_IMAGES_UNAVAILABLE);
          return null;
        },
      );
      return pending;
    },
    loaded: () => mod,
  };
}

export const flatImagesModule = lazyModule('flatImages', () => import('./flatImages'));
export const artworkImagesModule = lazyModule('artworkImages', () => import('./artworkImages'));

/** Освободить object URL флэтов, если их кэш загружен */
export function releaseFlatImages(): void {
  flatImagesModule.loaded()?.releaseFlatImages();
}

/** Освободить object URL логотипов, если их кэш загружен */
export function releaseArtworkImages(): void {
  artworkImagesModule.loaded()?.releaseArtworkImages();
}
