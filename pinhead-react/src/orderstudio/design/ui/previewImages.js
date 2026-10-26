/** Сторона растра логотипа в превью, px — для экрана хватает */
const PREVIEW_PX = 1024;

/**
 * Картинка логотипа → `data:image/png` (превью и лист выкройки строятся только
 * из `data:`, H1). Холст из чистой картинки (object URL того же источника);
 * не вышло — `undefined`, логотип не рисуется. Общая у превью телефона
 * (`DesignPreview`) и листа «Выкройка» (`stage/PatternSheet`, веха 5в, Э2б)
 */
export function toPngDataUrl(img) {
  if (!img?.naturalWidth || !img?.naturalHeight) return undefined;
  try {
    const k = Math.min(1, PREVIEW_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = canvas.getContext('2d');
    if (!g) return undefined;
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('превью: логотип', e);
    return undefined;
  }
}
