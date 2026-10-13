import styles from '../erp.module.css';
import { statusUi, VARIANT_CHIP_CLASS } from '../utils/statusUi';

/**
 * Единый статус-бейдж раздела. Пилюля с тонированным фоном по палитре `.chip*`.
 *
 * ДВА СПОСОБА ВЫЗОВА, и первый предпочтителен:
 *
 *   <Badge entity="stage" status={stage.status} />   ← слово и цвет из словаря
 *   <Badge variant="violet">Кастом</Badge>           ← произвольная пилюля
 *
 * Первый снимает вопрос «каким цветом этот статус» с места вызова: ответ живёт
 * в `utils/statusUi`, одном на раздел. Второй остаётся для того, что состоянием
 * работы не является, — вид изделия, пометка «ЭКС», счётчик.
 */


export function Badge({
  entity, status, variant = 'neutral', children, className = '', ...rest
}) {
  const fromDict = entity ? statusUi(entity, status) : null;
  const key = fromDict ? fromDict.variant : variant;
  const variantClass = styles[VARIANT_CHIP_CLASS[key] || 'chipNeutral'];
  return (
    <span className={`${styles.chip} ${variantClass} ${className}`.trim()} {...rest}>
      {children ?? fromDict?.label}
    </span>
  );
}
