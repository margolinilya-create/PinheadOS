import { Icon } from './Icon';
import styles from './Button.module.css';

/**
 * Кнопка ERP — единая замена глобальным `btn btn-primary/secondary/ghost/danger`
 * из Order Studio (там своя uppercase-типографика).
 *
 * - `variant`: primary | secondary | ghost | danger
 * - `size`: sm | md (по умолчанию) | lg — высота берётся из токенов `--control-h*`,
 *   на тач-экранах цехов растёт сама (медиа `pointer: coarse`).
 * - `icon`: имя иконки слева от подписи; `iconOnly` — квадратная кнопка без подписи
 *   (тогда обязателен `aria-label`).
 * - `loading`: показывает спиннер и блокирует кнопку.
 * - `block`: на всю ширину контейнера.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconOnly = false,
  loading = false,
  block = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const cls = [
    styles.btn,
    styles[variant],
    size !== 'md' && styles[size],
    iconOnly && styles.iconOnly,
    block && styles.block,
    className,
  ].filter(Boolean).join(' ');

  const iconSize = size === 'lg' ? 17 : size === 'sm' ? 14 : 15;

  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={iconSize} />
      )}
      {!iconOnly && children}
    </button>
  );
}
