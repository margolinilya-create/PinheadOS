import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { SizeResultTable } from '../../components/SizeResultTable';
import {
  intakeRows, intakeTotals, intakeSizes, intakeBlock, intakeShortfallWarning,
  intakeComment, intakeClosesStage,
} from '../../utils/garmentIntake';
import { mergeGrids } from '../../utils/sizeGrid';
import { GARMENT_INTAKE_LABELS, garmentIntakeAction } from '../../utils/garmentSource';
import { materialsForItem } from '../../utils/routes';
import styles from '../../styles';

/**
 * ОКНО «РЕЗУЛЬТАТ ПРИЁМКИ» (правка заказчика 16.09, п. 1).
 *
 * ЧТО БЫЛО. Кнопка «Принять изделие» звала `confirmStageDone` и закрывала
 * этап целиком — то есть числа приёмки не вводились вовсе, и в журнале
 * оставалось «склад отчитался 0 из N». Документ жалуется ровно на это.
 *
 * ЧТО СТАЛО. Кнопка открывает окно с подтянутым из заказа количеством:
 * у позиции с размерной сеткой — строка на размер, без сетки — одна строка
 * с тиражом. Введённое уходит отчётом этапа (`erp_stage_submit_report`),
 * и этап закрывается САМ, когда принятое добирает тираж. Недоприёмка
 * («принято 47 из 50») оставляет этап открытым — полный тираж не
 * записывается автоматически.
 *
 * ПРЕДЗАПОЛНЕНИЕ ФАКТОМ ЗАКУПКИ (п. 2 документа). Когда по позиции есть
 * закупка готового изделия, окно подставляет ФАКТИЧЕСКИ ПРИНЯТОЕ ею
 * по размерам — сумму журнала приходов. Журнал грузится точечно, при
 * открытии окна: возить историю приходов в общей выборке заказа ради
 * одного экрана нельзя.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ «ЗАВЕРШИТЬ ЭТАП». Завершение — следствие числа, а не
 * отдельное решение: цех, принявший 47 из 50, не должен иметь кнопки,
 * закрывающей недостачу молча.
 */
export function GarmentIntakeModal({ entry, onClose }) {
  const { order, item, stage } = entry;
  const { submitStageReport, loadMaterialReceipts, setStageStatus } = useErpStore(
    useShallow((s) => ({
      submitStageReport: s.submitStageReport,
      loadMaterialReceipts: s.loadMaterialReceipts,
      setStageStatus: s.setStageStatus,
    })),
  );

  const [purchaseFact, setPurchaseFact] = useState(null);
  const [busy, setBusy] = useState(false);

  /** Позиции закупки, описывающие САМО изделие: у них и лежит разбивка */
  const garmentMaterials = useMemo(
    () => materialsForItem(order.materials, item.id).filter((m) => m.kind === 'finished_good'),
    [order.materials, item.id],
  );

  useEffect(() => {
    let alive = true;
    const ids = garmentMaterials.map((m) => m.id);
    if (ids.length === 0) return undefined;
    (async () => {
      const receipts = await loadMaterialReceipts(ids);
      if (!alive) return;
      // Приходов по одной позиции бывает несколько (частичная поставка) —
      // фактическая разбивка это их СУММА, а не последний приход
      setPurchaseFact(receipts.reduce((acc, r) => mergeGrids(acc, r.size_grid), []));
    })();
    return () => { alive = false; };
  }, [garmentMaterials, loadMaterialReceipts]);

  const rows = useMemo(() => intakeRows(item, purchaseFact), [item, purchaseFact]);

  /**
   * ХРАНИМ ТОЛЬКО ПРАВКИ, А НЕ ВСЮ ФОРМУ.
   *
   * Предзаполнение приезжает из заказа и из журнала закупки, то есть может
   * прийти ПОЗЖЕ открытия окна. Скопировать его в состояние эффектом значило
   * бы либо затирать уже введённое кладовщиком, либо городить сравнение
   * «менялось ли оно» — и то и другое лишний каскад отрисовок. Правка
   * перекрывает предзаполнение по ключу строки, всё остальное выводится.
   */
  const [edits, setEdits] = useState({});

  const current = useMemo(
    () => rows.map((r) => ({
      ...r,
      accepted: edits[r.key] === undefined ? r.accepted : Math.max(Number(edits[r.key]) || 0, 0),
    })),
    [rows, edits],
  );

  const values = useMemo(
    () => Object.fromEntries(rows.map((r) => [
      r.key, { accepted: edits[r.key] ?? String(r.accepted) },
    ])),
    [rows, edits],
  );

  const totals = intakeTotals(current);
  const block = intakeBlock(current);
  const warning = intakeShortfallWarning(current);
  const closes = intakeClosesStage(current, item, stage.qty_done ?? 0);

  const action = garmentIntakeAction(item);
  const title = action ? GARMENT_INTAKE_LABELS[action] : 'Результат приёмки';

  const submit = async () => {
    if (block) return;
    setBusy(true);
    /**
     * Этап, ещё не взятый в работу, берём тем же действием: иначе склад
     * сдаёт результат по заданию, которое никто не начинал, и в истории
     * появляется «готово» без «в работе».
     */
    if (stage.status === 'ready') await setStageStatus(stage.id, 'in_progress');

    const ok = await submitStageReport(stage.id, {
      qtyIn: totals.expected,
      qtyGood: totals.accepted,
      comment: intakeComment(current),
      sizes: intakeSizes(current).flatMap((row) => Object.entries(row.sizes).map(([size, qty]) => ({
        color: row.color, size, qty_good: qty,
      }))),
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title={`${title} — ${item.product_type}`} onClose={onClose}>
      <p className={styles.subText}>
        Заказ {order.title} · тираж {item.qty} шт
      </p>

      <SizeResultTable
        rows={current}
        columns={[{
          code: 'accepted',
          label: 'Принято, шт',
        }]}
        values={values}
        onChange={(key, _code, value) => setEdits((v) => ({ ...v, [key]: value }))}
        expectedLabel="Заказано"
        caption="Результат приёмки по размерам"
        disabled={busy}
      />

      {/*
        Последствия называются ДО подтверждения и ЧИСЛАМИ: «принято не всё»
        без цифр отправляет человека пересчитывать строки заново.
      */}
      {warning && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} /> {warning}
        </p>
      )}
      {!warning && closes && (
        <p className={styles.queueReason} role="status">
          <Icon name="check" size={13} /> Принят весь тираж — этап закроется,
          и позиция уйдёт дальше по маршруту.
        </p>
      )}
      {block && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} /> {block}
        </p>
      )}

      <div className={styles.queueActions}>
        <Button variant="primary" loading={busy} disabled={busy || Boolean(block)} onClick={submit}>
          <Icon name="check" size={14} /> Подтвердить приёмку
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>Отмена</Button>
      </div>
    </Modal>
  );
}
