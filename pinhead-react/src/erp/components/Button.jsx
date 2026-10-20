import { useId } from 'react';
import { Link } from 'react-router-dom';
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
 * - `ariaDisabledReason`: БЛОК ПО УСЛОВИЮ (правило вехи 6+7, правки 19.10) —
 *   кнопка `aria-disabled`, клик заглушён, причина видимым текстом рядом
 *   и описанием кнопки (`aria-describedby`). Кнопка остаётся в порядке Tab
 *   и объясняет себя читалке; `disabled` — только на время запроса
 *   (`loading`), и тогда причина не показывается.
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
  ariaDisabledReason = '',
  children,
  ...rest
}) {
  const reasonId = useId();
  const cls = [
    styles.btn,
    styles[variant],
    size !== 'md' && styles[size],
    iconOnly && styles.iconOnly,
    block && styles.block,
    className,
  ].filter(Boolean).join(' ');

  const iconSize = size === 'lg' ? 17 : size === 'sm' ? 14 : 15;
  const reason = !loading && !disabled && ariaDisabledReason ? ariaDisabledReason : '';
  const blocked = reason
    ? { 'aria-disabled': 'true', 'aria-describedby': reasonId, onClick: (e) => e.preventDefault() }
    : {};

  const button = (
    <button type={type} className={cls} disabled={disabled || loading} {...rest} {...blocked}>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={iconSize} />
      )}
      {!iconOnly && children}
    </button>
  );
  if (!reason) return button;
  return (
    <>
      {button}
      <span id={reasonId} className={styles.reason}>{reason}</span>
    </>
  );
}

/**
 * Ссылка в облике кнопки: те же варианты и размеры, но `<Link>`/`<a>`.
 *
 * Нужна ровно там, где действие — это ПЕРЕХОД («Открыть задание», «← В очередь
 * цеха», «Скачать ТЗ»). Подменять её кнопкой нельзя: ломаются Ctrl+клик,
 * «открыть в новой вкладке», средняя кнопка мыши и объявление роли для
 * скринридера. Раньше таких мест было восемь, и все они звали глобальный
 * `btn btn-*` из Order Studio — то есть ERP в этих точках говорила
 * на чужом языке и получала чужую (uppercase) типографику.
 *
 * `href` → внешняя ссылка `<a>`, `to` → маршрут `<Link>`.
 */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  block = false,
  className = '',
  href,
  to,
  children,
  ...rest
}) {
  const cls = [
    styles.btn,
    styles[variant],
    styles.link,
    size !== 'md' && styles[size],
    block && styles.block,
    className,
  ].filter(Boolean).join(' ');

  const iconSize = size === 'lg' ? 17 : size === 'sm' ? 14 : 15;
  const content = (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
    </>
  );

  if (href !== undefined) {
    return <a href={href} className={cls} {...rest}>{content}</a>;
  }
  return <Link to={to} className={cls} {...rest}>{content}</Link>;
}
