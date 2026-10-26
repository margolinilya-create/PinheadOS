/**
 * «Скачать PDF макета» (веха 5а, задача 7). Слот для вкладки «Дизайн»:
 * T6б монтирует `<ExportPdfButton order item flat disabled />` в шапку вкладки.
 *
 * - `order` — заказ v4 (номер, клиент, статус; `id` — путь логотипов в бакете);
 * - `item` — позиция; в PDF идут её нанесения, размещённые на `flat`;
 * - `flat` — флэт позиции (`pickFlat`) или `null` — тогда PDF не собрать;
 * - `disabled` — выключить снаружи (например, пока грузится справочник флэтов).
 *
 * Только чтение заказа PDF НЕ запрещает: макет скачивают и после запуска.
 *
 * Порядок (решение DM № 6 и ответ владельца 17.10: ничего не блокирует):
 * 0. листы, проверка и имя файла (`maketTools`) — `import()` по клику, не в чанке
 *    холста; доступность кнопки — лёгкий `hasMaketPages`;
 * 1. проверка перед сборкой (`preflight`): серьёзные замечания и предупреждения —
 *    вопрос «Скачать всё равно?», подсказки (вышивка) — без вопроса;
 * 2. движок PDF (`export/exportPdf`: jsPDF + svg2pdf) — `import()` только
 *    в `maketExport.loadPdfEngine`, по клику: в холст и оболочки он не попадает
 *    (страж `bundle-budget`, `pdfGuards.test.ts`);
 * 3. «Готовлю PDF…» (`aria-busy`), итог — в области `aria-live`;
 * 4. файл — `saveBlob` под ASCII-именем `PH-1234-<модель>-<цвет>-maket.pdf`.
 *
 * Отказ сборки, понятный человеку (`MaketPdfError`), — тостом с причиной; сбой
 * библиотеки — общим текстом; пропавший чанк движка — общий диалог «Вышло обновление».
 */
import { useId, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { confirm } from '../../../../store/useConfirmStore';
import { useStore } from '../../../../store/useStore';
import { toast } from '../../../../store/useToastStore';
import { itemTitle } from '../../../model/itemOps';
import { STATUS_LABELS } from '../../../screens/labels';
import { garmentHexOf } from '../../assets/garmentHex';
import { hasMaketPages, loadMaketTools, loadPdfEngine } from './maketExport';
import styles from './ExportPdfButton.module.css';

const LABEL = 'Скачать PDF макета';
const BUSY_LABEL = 'Готовлю PDF…';
const NO_FLAT = 'Для модели нет силуэта — PDF макета не собрать';
const NO_PLACEMENTS = 'Поставьте логотип на изделие — тогда можно скачать PDF макета';
const MSG_FAILED = 'PDF макета не собран — повторите или сообщите администратору';

export default function ExportPdfButton({ order, item, flat, disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const hintId = useId();
  const cat = useStore(useShallow((s) => ({
    skuCatalog: s.skuCatalog,
    categoryRules: s.categoryRules,
    suppliers: s.suppliers,
  })));
  const hasPages = useMemo(() => hasMaketPages(item, flat), [item, flat]);
  const reason = disabled ? '' : (!flat && NO_FLAT) || (!hasPages && NO_PLACEMENTS) || '';
  const off = disabled || Boolean(reason);

  async function build(tools) {
    const engine = await loadPdfEngine();
    if (!engine) return;
    const blob = await engine.exportMaketPdf({
      orderId: order.id,
      item,
      flat,
      garmentHex: garmentHexOf(item, cat.suppliers ?? []),
      meta: {
        client: order.customer,
        orderNumber: order.number,
        itemTitle: itemTitle(item),
        date: new Date().toLocaleDateString('ru-RU'),
        statusLabel: STATUS_LABELS[order.status] ?? '',
      },
    });
    const name = tools.maketFileName(order, item);
    tools.saveBlob(blob, name);
    setStatus(`PDF макета готов: ${name}`);
  }

  async function onExport() {
    if (busy || off) return;
    const tools = await loadMaketTools();
    if (!tools) return;
    const pages = tools.maketPages(item, flat);
    const issues = tools.issuesToAsk(pages, flat, tools.rulesOf(item, cat.skuCatalog, cat.categoryRules), tools.mismatchOf(item, flat, cat.skuCatalog));
    if (issues.length > 0) {
      const go = await confirm({
        title: 'Проверьте макет перед PDF',
        message: tools.preflightMessage(issues),
        confirmLabel: 'Скачать PDF всё равно',
        cancelLabel: 'Вернуться к макету',
      });
      if (!go) return;
    }
    setBusy(true);
    setStatus('Готовлю PDF макета…');
    try {
      await build(tools);
    } catch (e) {
      console.error('ExportPdfButton', e);
      toast.error(e instanceof tools.MaketPdfError ? `PDF макета не собран: ${e.message}` : MSG_FAILED);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`btn btn-primary ${styles.button}${busy ? ' loading' : ''}`}
        onClick={onExport}
        disabled={off}
        aria-busy={busy}
        aria-describedby={reason ? hintId : undefined}
      >
        {busy && <span className="btn-spinner" aria-hidden="true" />}
        {busy ? BUSY_LABEL : LABEL}
      </button>
      {reason && <p id={hintId} className={styles.hint}>{reason}</p>}
      <span className={styles.srOnly} role="status" aria-live="polite">{status}</span>
    </div>
  );
}
