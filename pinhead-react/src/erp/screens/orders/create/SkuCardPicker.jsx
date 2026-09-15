import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../../store/useErpStore';
import { useErpAccess } from '../../../store/useErpAccess';
import styles from '../../../styles';

/**
 * ВЫБОР МОДЕЛИ ИЗ КАТАЛОГА SKU (правка 14.09, п. 6): «использовать в заказе».
 *
 * ССЫЛКА, А НЕ ЗАМЕНА ПОЛЕЙ. Позиция продолжает хранить собственные изделие,
 * крой и сетку — это СНИМОК на момент заказа: правка карточки задним числом
 * не имеет права переписать действующий заказ (прямой запрет документа).
 * Поэтому выбор модели ПОДСТАВЛЯЕТ значения в поля, а дальше они живут своей
 * жизнью.
 *
 * ПОДСТАВЛЯЕТСЯ ТОЛЬКО ПУСТОЕ. Человек, уже набравший «худи оверсайз 320
 * с начёсом», не ждёт, что выпадающий список сотрёт его текст; а список,
 * который стирает набранное, перестают открывать вовсе. Что подставилось,
 * видно сразу — поля рядом.
 *
 * АРХИВНЫХ В ВЫБОРЕ НЕТ. Архив означает «из выбора убрана, история заказов
 * осталась»; предлагать её в новом заказе значило бы, что архивирование
 * ничего не делает. Уже выбранная модель из списка НЕ пропадает, даже уехав
 * в архив: иначе правка старого заказа молча отвязала бы её.
 *
 * БЕЗ ПРАВА `sku.view` БЛОКА НЕТ ВОВСЕ. Менеджеру право выдано, но снимается
 * оно галочкой — и select, который нечем наполнить, выглядел бы поломкой.
 */
export function SkuCardPicker({ item, onPick }) {
  const canView = useErpAccess().can('sku.view');
  const { cards, loaded, load } = useErpStore(useShallow((s) => ({
    cards: s.skuCards,
    loaded: s.skuCardsLoaded,
    load: s.loadSkuCards,
  })));

  useEffect(() => {
    if (canView && !loaded) void load();
  }, [canView, loaded, load]);

  const options = useMemo(() => cards.filter(
    (c) => c.status !== 'archived' || c.id === item.sku_card_id,
  ), [cards, item.sku_card_id]);

  if (!canView || (loaded && cards.length === 0)) return null;

  const pick = (id) => {
    if (!id) {
      onPick({ sku_card_id: '' });
      return;
    }
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    onPick({
      sku_card_id: id,
      // Только пустое: набранный человеком текст сильнее подсказки каталога
      ...(item.product_type.trim() ? null : { product_type: card.name }),
      ...(item.fit.trim() || !card.fit ? null : { fit: card.fit }),
    });
  };

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>Модель из каталога</span>
      <select
        className={styles.input}
        value={item.sku_card_id || ''}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="">Не из каталога</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.code}
          </option>
        ))}
      </select>
    </label>
  );
}
