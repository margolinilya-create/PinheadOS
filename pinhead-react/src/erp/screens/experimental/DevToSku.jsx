import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../../../lib/supabase';
import { useErpStore } from '../../store/useErpStore';
import { erpQuery } from '../../store/shared';
import { Button } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { matchByName, skuDraftFromDev } from '../../utils/skuFromDev';
import { DEV_ATTACHMENT_KINDS } from '../../utils/finalPackage';
import styles from '../../erp.module.css';

/**
 * ФОРМА СВЕРКИ «МОДЕЛЬ → КАТАЛОГ SKU» (решение заказчика 21.08).
 *
 * ЗАЧЕМ ФОРМА, А НЕ КНОПКА. Пакет описывает модель словами технолога, каталог —
 * артикул числами прайса. Три вещи каталога из пакета не выводятся вообще:
 * код артикула, категория (от неё зависят правила визарда) и цена пошива
 * с расходом ткани (по ним считается заказ). Перенос «одной кнопкой» завёл бы
 * артикул с нулевой ценой — визард ломается на таком молча, и чинит его не тот,
 * кто переносил. Поэтому здесь предзаполнено всё, что выводится, и спрошено
 * ровно недостающее.
 *
 * СПРАВОЧНИКИ ЧИТАЮТСЯ ЗДЕСЬ ЖЕ. Ткани живут в `catalog_config`, каталог SKU —
 * в `app_config`: это данные Order Studio, и тянуть его стор в ERP значило бы
 * связать два раздела ради одной формы (правило веса оболочки). Один запрос
 * на открытие дешевле такой связи.
 */

const CATEGORIES = [
  ['tshirts', 'Футболки'], ['longsleeves', 'Лонгсливы'], ['sweatshirts', 'Свитшоты'],
  ['halfzips', 'Халф-зипы'], ['hoodies', 'Худи'], ['ziphoodies', 'Зип-худи'],
  ['polo', 'Поло / Регбийка / Олимпийка'], ['bombers', 'Бомберы'],
  ['pants', 'Штаны'], ['shorts', 'Шорты'], ['accessories', 'Аксессуары'],
];

const FITS = [['regular', 'Regular'], ['oversize', 'Oversize'], ['free', 'Free'], ['classic', 'Classic']];

export function DevToSku({ dev, attachments = [], onClose }) {
  const transferDevToSku = useErpStore(useShallow((s) => s.transferDevToSku));

  const { draft } = useMemo(() => skuDraftFromDev(dev), [dev]);
  const [form, setForm] = useState(() => ({
    code: draft.code,
    name: draft.name,
    category: draft.category,
    fit: draft.fit ?? 'regular',
    sewingPrice: '',
    mainFabricUsage: '',
  }));
  const [fabrics, setFabrics] = useState([]);
  const [takenCodes, setTakenCodes] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cat, app] = await Promise.all([
        erpQuery(() => supabase.from('catalog_config').select('key, value')),
        erpQuery(() => supabase.from('app_config').select('value').eq('key', 'sku_catalog').maybeSingle()),
      ]);
      if (!alive) return;
      const row = (cat.data ?? []).find((r) => r.key === 'fabricsCatalog');
      setFabrics(Array.isArray(row?.value) ? row.value : []);
      const list = app.data?.value;
      setTakenCodes(Array.isArray(list) ? list.map((s) => s?.code).filter(Boolean) : []);
    })();
    return () => { alive = false; };
  }, []);

  /** Ткани пакета → коды справочника; ненайденное показываем, а не прячем */
  const fabricMatch = useMemo(
    () => matchByName(draft.fabricNames, fabrics),
    [draft.fabricNames, fabrics],
  );

  const photos = attachments
    .filter((a) => a.kind === DEV_ATTACHMENT_KINDS.photo)
    .map((a) => supabase.storage.from('erp-attachments').getPublicUrl(a.file_path).data.publicUrl);

  const codeTaken = takenCodes.includes(form.code.trim());
  const priceOk = Number(form.sewingPrice) > 0;
  const usageOk = Number(form.mainFabricUsage) > 0;
  const ready = form.code.trim() && form.category && priceOk && usageOk && !codeTaken;

  const submit = async () => {
    setSaving(true);
    const sku = {
      code: form.code.trim(),
      name: form.name.trim() || draft.name,
      category: form.category,
      fit: form.category === 'accessories' ? null : form.fit,
      sewingPrice: Number(form.sewingPrice),
      mainFabricUsage: Number(form.mainFabricUsage),
      trimCode: null,
      trimUsage: 0,
      mockupType: 'tee',
      zones: [],
      description: draft.description || undefined,
      // Фото образца берётся ССЫЛКОЙ на публичный файл разработки: копия
      // в другой бакет — второй экземпляр того же снимка, который потом
      // расходится с оригиналом при замене
      photos: photos.length > 0 ? photos : undefined,
      availableSizes: draft.availableSizes ?? undefined,
      allowedFabrics: fabricMatch.matched.length > 0 ? fabricMatch.matched : undefined,
    };
    const code = await transferDevToSku(dev.id, sku);
    setSaving(false);
    if (code) onClose();
  };

  return (
    <Drawer title="Модель в каталог SKU" subtitle={dev.tech_name || ''} onClose={onClose}>
      <div className={styles.stackTight}>
        <p className={styles.subText}>
          Каталог описывает артикул числами прайса, а пакет — модель словами.
          Заполнено то, что выводится из пакета; ниже спрошено то, чего в нём нет.
        </p>

        <div className={styles.addMatRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Код артикула *</span>
            <input
              className={styles.input}
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              aria-invalid={codeTaken || undefined}
            />
            {codeTaken && (
              <span className={styles.fieldError}>Такой артикул в каталоге уже есть</span>
            )}
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Название</span>
            <input
              className={styles.input}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
        </div>

        <div className={styles.addMatRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Категория *</span>
            <select
              className={styles.select}
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">— выберите —</option>
              {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className={styles.subText}>от неё зависят техники, размеры и MOQ</span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Крой</span>
            <select
              className={styles.select}
              value={form.fit}
              disabled={form.category === 'accessories'}
              onChange={(e) => setForm((f) => ({ ...f, fit: e.target.value }))}
            >
              {FITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.addMatRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Цена пошива, ₽ *</span>
            <input
              type="number" min="0" className={styles.input}
              value={form.sewingPrice}
              onChange={(e) => setForm((f) => ({ ...f, sewingPrice: e.target.value }))}
            />
            <span className={styles.subText}>
              {draft.priceHint.min || draft.priceHint.max
                ? `вилка разработки: ${draft.priceHint.min ?? '—'}–${draft.priceHint.max ?? '—'} ₽ за изделие (это не цена пошива)`
                : 'в пакете этого нет — это прайс, а не описание модели'}
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Расход ткани, м *</span>
            <input
              type="number" min="0" step="0.1" className={styles.input}
              value={form.mainFabricUsage}
              onChange={(e) => setForm((f) => ({ ...f, mainFabricUsage: e.target.value }))}
            />
          </label>
        </div>

        {/* Что уедет из пакета как есть — показываем, чтобы человек не гадал */}
        <div className={styles.subText}>
          Из пакета переносится: описание{draft.availableSizes ? `, размеры (${draft.availableSizes.join(', ')})` : ''}
          {photos.length > 0 ? `, фото образца (${photos.length})` : ''}
          {fabricMatch.matched.length > 0 ? `, ткани (${fabricMatch.matched.length})` : ''}.
        </div>
        {fabricMatch.unmatched.length > 0 && (
          /* Блоком, а не чипом: чип не переносится и обрезает список тканей
             краем панели — а имена как раз и нужно прочитать целиком */
          <div className={styles.warnBox}>
            <strong>Не найдены в справочнике тканей:</strong>{' '}
            {fabricMatch.unmatched.join(', ')}. Их можно завести в каталоге тканей
            и указать артикулу вручную — перенос это не блокирует.
          </div>
        )}
        {draft.brandingNames.length > 0 && (
          <div className={styles.subText}>
            Нанесения пакета ({draft.brandingNames.join(', ')}) задаются правилами
            категории в редакторе SKU — здесь они не переносятся.
          </div>
        )}

        <div className={styles.queueActions}>
          <Button variant="primary" disabled={!ready || saving} loading={saving} onClick={submit}>
            Перенести в каталог
          </Button>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
        </div>
        {!ready && !saving && (
          <p className={styles.subText}>
            Осталось заполнить: {[
              !form.code.trim() && 'код артикула',
              codeTaken && 'свободный код артикула',
              !form.category && 'категорию',
              !priceOk && 'цену пошива',
              !usageOk && 'расход ткани',
            ].filter(Boolean).join(', ')}.
          </p>
        )}
      </div>
    </Drawer>
  );
}
