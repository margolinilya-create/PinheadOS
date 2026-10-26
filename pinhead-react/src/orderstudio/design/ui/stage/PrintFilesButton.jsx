import ZipExportButton from './ZipExportButton';

export const MSG_NO_PRINT_FILES = 'Нет нанесений с макетом и размером в мм';

/** Есть что печатать: макет и оба мм (как `printablePrints`, без загрузки модуля) */
const printable = (item) => item.prints.some((p) => p.artwork_path && p.width_mm > 0 && p.height_mm > 0);

/** «Файлы печати» (веха 5в, Э4а): ZIP с PNG 300 dpi на каждое нанесение (вектор и PDF — с исходником) */
export function PrintFilesButton({ order, item }) {
  const build = async () => {
    const [m, api] = await Promise.all([import('../../export/printFiles'), import('../../../api/artworks')]);
    return m.buildPrintFiles(order, item, { download: api.downloadArtwork, rasterize: m.rasterizeInBrowser });
  };
  return (
    <ZipExportButton label="Файлы печати" busyLabel="Собираю файлы печати…" reason={printable(item) ? null : MSG_NO_PRINT_FILES}
      doneText={(n) => `Файлы печати: ${n}`} build={build} />
  );
}

/** «Мокапы» (веха 5в, Э5): PNG «вид × цвет ткани» в фирменной сцене */
export function MockupsButton({ order, item, flat, suppliers }) {
  const build = async () => {
    const [m, flats, arts, prev] = await Promise.all([
      import('../../export/mockups'), import('../../assets/flatImages'), import('../../assets/artworkImages'), import('../previewImages'),
    ]);
    return m.buildMockups(order, item, flat, suppliers ?? [], {
      flatMarkup: flats.loadFlatMarkup,
      artwork: async (pl) => prev.toPngDataUrl(await arts.loadArtworkImage(order.id, pl.artwork_path, pl.asset.has_preview)),
      toPng: m.svgToPngInBrowser,
    });
  };
  return <ZipExportButton label="Мокапы" busyLabel="Собираю мокапы…" reason={null} doneText={(n) => `Мокапов: ${n}`} build={build} />;
}
