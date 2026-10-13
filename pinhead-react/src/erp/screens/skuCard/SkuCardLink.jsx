import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { ButtonLink } from '../../components/Button';

/**
 * ССЫЛКА НА КАРТОЧКУ МОДЕЛИ — из разработки и из позиции заказа.
 *
 * Документ требует «одна и та же карточка»: и каталог, и разработка, и заказ
 * обязаны открывать её, а не три похожие поверхности. Отсюда общий
 * компонентик — вызывающему нужен ровно один вопрос («есть ли карточка»),
 * и тянуть ради него в `DevCard` и `OrderItemSection` весь слайс каталога
 * незачем.
 *
 * ДВА СПОСОБА АДРЕСОВАТЬ — это два РАЗНЫХ вопроса, а не один с вариантами:
 * `experimentalId` спрашивает «что вышло из этой разработки» (связь ведёт
 * карточка), `itemCardId` — «по какой модели шьётся эта позиция» (связь ведёт
 * позиция). Сводить их в один параметр значило бы, что вызывающий обязан
 * помнить, какая сторона хранит связь.
 *
 * НИЧЕГО НЕ РИСУЕТ БЕЗ ПРАВА И БЕЗ КАРТОЧКИ: ссылка, ведущая в «Нет доступа»,
 * хуже её отсутствия.
 */
export function SkuCardLink({ experimentalId, itemCardId, label = 'Открыть карточку модели' }) {
  const canView = useErpAccess().can('sku.view');
  const { cards, loaded, load } = useErpStore(useShallow((s) => ({
    cards: s.skuCards,
    loaded: s.skuCardsLoaded,
    load: s.loadSkuCards,
  })));

  const wanted = Boolean(canView && (experimentalId || itemCardId));
  useEffect(() => {
    if (wanted && !loaded) void load();
  }, [wanted, loaded, load]);

  if (!wanted) return null;
  const card = itemCardId
    ? cards.find((c) => c.id === itemCardId)
    : cards.find((c) => c.experimental_id === experimentalId);
  if (!card) return null;

  return (
    <ButtonLink to={`/sku-card/${card.id}`} variant="ghost" size="sm">
      {itemCardId ? `Модель: ${card.name}` : label}
    </ButtonLink>
  );
}
