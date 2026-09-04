import { useState } from 'react';
import { PageHead } from '../components/PageHead';
import { Button, ButtonLink } from '../components/Button';
import { Badge } from '../components/Badge';
import { Field } from '../components/Field';
import { LoadFailed, EmptyResult, EmptyState } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { Icon } from '../components/Icon';
import { ICONS } from '../components/icons';
import { useTheme } from '../../hooks/useTheme';
import { dueLabel, dueLabelCompact, OVERDUE_BUCKET_SHORT, percentLabel } from '../utils/format';
import styles from '../styles';

/**
 * Витрина дизайн-системы ERP — за флагом `styleguide` (?styleguide=1).
 *
 * Зачем страница, если есть тесты. Тест проверяет вычислимое: контраст токенов
 * сторожит `styles/contrast.test.ts`, высоту тач-целей — правило в CSS. Но
 * «варианта кнопки три, а выглядят они как пять» тест не увидит: это вопрос
 * о том, различимы ли элементы РЯДОМ друг с другом. До 03.08.2026 такой
 * страницы не было, и примитив `Button` с невалидным `background` (лишняя
 * скобка в var()) прожил незамеченным — главная кнопка ERP рендерилась
 * прозрачной, и вместо починки её просто обходили глобальным `.btn`
 * из Order Studio: 107 мест против двух у собственного примитива.
 *
 * Не раздел ERP: в меню не показывается, по умолчанию выключена.
 */

const BADGE_VARIANTS = ['ready', 'progress', 'waiting', 'blocked', 'done', 'neutral'];
const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'];
const SIZES = ['sm', 'md', 'lg'];

const TEXT_TOKENS = ['--text', '--text-secondary', '--text-mid', '--text-dim', '--text-muted'];
const SURFACE_TOKENS = ['--bg', '--bg1', '--bg3', '--card', '--surface'];
const SPACE_TOKENS = ['--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl', '--space-2xl', '--space-3xl'];
const RADIUS_TOKENS = ['--radius-sm', '--radius-md', '--radius-lg'];

function Section({ title, note, children }) {
  return (
    <section className={styles.widget}>
      <div className={styles.widgetHead}>
        {/* Именно h2, а не span: заголовок секции — это заголовок, и страница
            должна читаться навигацией по заголовкам. Виджеты дашборда пока
            используют span — это отдельный пункт доступности (Ф6). */}
        <h2 className={styles.widgetTitle}>{title}</h2>
      </div>
      {note && <p className={styles.subText}>{note}</p>}
      <div className={styles.sgRow}>{children}</div>
    </section>
  );
}

export default function StyleGuide() {
  const { theme, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(false);

  return (
    <>
      <PageHead
        title="Дизайн-система"
        sub="Все примитивы ERP на одной странице. Проверять в обеих темах и на тач-экране."
      />

      <div className={styles.toolbar}>
        <Button variant="secondary" icon={theme === 'light' ? 'moon' : 'sun'} onClick={toggleTheme}>
          {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
        </Button>
        <span className={styles.subText}>
          Токены контраста сторожит styles/contrast.test.ts — эта страница про то,
          различимы ли элементы рядом друг с другом.
        </span>
      </div>

      <Section title="Кнопки" note="Иерархия действий: одна primary на экран, остальное — secondary/ghost. Danger только для необратимого.">
        {BUTTON_VARIANTS.map((v) => (
          <Button key={v} variant={v}>{v}</Button>
        ))}
        <Button variant="primary" icon="plus">С иконкой</Button>
        <Button variant="secondary" iconOnly icon="pencil" aria-label="Только иконка" />
        <Button variant="primary" loading>Загрузка</Button>
        <Button variant="primary" disabled>Недоступна</Button>
      </Section>

      <Section title="Размеры кнопок" note="На тач-экранах (pointer: coarse) все вырастают до ≥44px — проверять на планшете.">
        {SIZES.map((s) => (
          <Button key={s} variant="secondary" size={s}>{s}</Button>
        ))}
      </Section>

      <Section title="Ссылки в облике кнопки" note="Переход, а не действие: сохраняет Ctrl+клик и «открыть в новой вкладке».">
        {BUTTON_VARIANTS.map((v) => (
          <ButtonLink key={v} to="/styleguide" variant={v}>{v}</ButtonLink>
        ))}
      </Section>

      <Section title="Статусы" note="Один и тот же смысл — один и тот же вариант на всех экранах.">
        {BADGE_VARIANTS.map((v) => (
          <Badge key={v} variant={v}>{v}</Badge>
        ))}
      </Section>

      <Section title="Ступени просрочки" note="Решение заказчика 03.08.2026: одно число «просрочено: 47» не отвечает на вопрос «что делать сейчас».">
        <Badge variant="done">{OVERDUE_BUCKET_SHORT.none}</Badge>
        <Badge variant="waiting">{OVERDUE_BUCKET_SHORT.week}</Badge>
        <Badge variant="blocked">{OVERDUE_BUCKET_SHORT.month}</Badge>
        <Badge variant="neutral">{OVERDUE_BUCKET_SHORT.stale}</Badge>
      </Section>

      <Section title="Метки срока" note="Единые форматтеры: раньше эту строку собирали семь мест и все по-разному.">
        <code className={styles.sgCode}>dueLabel(-5) → {dueLabel(-5)}</code>
        <code className={styles.sgCode}>dueLabel(0) → {dueLabel(0)}</code>
        <code className={styles.sgCode}>dueLabel(1) → {dueLabel(1)}</code>
        <code className={styles.sgCode}>dueLabel(9) → {dueLabel(9)}</code>
        <code className={styles.sgCode}>dueLabel(null) → {dueLabel(null)}</code>
        <code className={styles.sgCode}>dueLabelCompact(-5) → {dueLabelCompact(-5)}</code>
        <code className={styles.sgCode}>percentLabel(null) → {percentLabel(null)}</code>
        <code className={styles.sgCode}>percentLabel(73) → {percentLabel(73)}</code>
      </Section>

      <Section title="Поля" note="Autofocus — на первом поле формы. Ошибка различает «не заполнено» и «заполнено неверно».">
        <Field label="Обычное" placeholder="напр. 54766" />
        <Field label="С ошибкой" error="Обязательное поле" />
        <Field label="Недоступное" disabled value="только чтение" onChange={() => {}} />
      </Section>

      <Section title="Состояния экрана" note="Порядок обязательный: ошибка → скелетон → пусто. Скелетон вешается на !loaded && !loadError.">
        <div className={styles.sgStack}>
          <LoadFailed what="заказы" onRetry={() => setLoading((v) => !v)} />
          <EmptyResult query="швейка" onReset={() => {}} />
          <EmptyState text="Работы нет — очередь цеха пуста." />
          <TableSkeleton rows={2} label="Пример скелетона" />
          {loading && <span className={styles.subText}>Повтор нажат</span>}
        </div>
      </Section>

      <Section title="Текстовые токены" note="Все обязаны проходить WCAG AA на любой поверхности — это проверяет тест.">
        <div className={styles.sgStack}>
          {TEXT_TOKENS.map((t) => (
            <div key={t} className={styles.sgSwatchRow}>
              <span className={styles.sgToken}>{t}</span>
              {SURFACE_TOKENS.map((bg) => (
                <span
                  key={bg}
                  className={styles.sgSwatch}
                  style={{ background: `var(${bg})`, color: `var(${t})` }}
                >
                  Аа {bg.replace('--', '')}
                </span>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Шкала отступов">
        <div className={styles.sgStack}>
          {SPACE_TOKENS.map((t) => (
            <div key={t} className={styles.sgSwatchRow}>
              <span className={styles.sgToken}>{t}</span>
              <span className={styles.sgBar} style={{ width: `var(${t})` }} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Скругления">
        {RADIUS_TOKENS.map((t) => (
          <span key={t} className={styles.sgRadius} style={{ borderRadius: `var(${t})` }}>{t}</span>
        ))}
      </Section>

      <Section title={`Иконки (${Object.keys(ICONS).length})`} note="Эмодзи вместо иконок в ERP не используются.">
        {Object.keys(ICONS).map((name) => (
          <span key={name} className={styles.sgIcon} title={name}>
            <Icon name={name} size={18} />
            <span className={styles.sgToken}>{name}</span>
          </span>
        ))}
      </Section>
    </>
  );
}
