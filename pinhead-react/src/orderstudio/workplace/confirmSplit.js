import { confirm } from '../../store/useConfirmStore';
import { pluralize } from '../../utils/i18n';

/**
 * Подтверждение «Разнести по цветам» — одно для меню позиции и плашки
 * многоцветной позиции на вкладке «Изделие». Разнесение уходит в базу
 * автосохранением без отмены, поэтому без вопроса не делается.
 *
 * @param {{ size_grid: { rows: { color: string }[] } }} item
 * @returns {Promise<boolean>}
 */
export function confirmSplit(item) {
  const colors = item.size_grid.rows.map((r) => r.color.trim() || 'без цвета');
  const n = colors.length;
  return confirm({
    title: 'Разнести по цветам?',
    message: `Позиция станет ${n} позициями: ${colors.join(', ')}. Нанесения скопируются в каждую`,
    confirmLabel: `Разнести на ${n} ${pluralize(n, 'позицию', 'позиции', 'позиций')}`,
  });
}
