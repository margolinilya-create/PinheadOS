import { Component } from 'react';
// eslint-disable-next-line no-unused-vars
import styles from './ErrorBoundary.module.css';
import { reportError } from '../../lib/errorReport';
import { isChunkLoadError, UPDATE_TITLE, UPDATE_MESSAGE } from '../../lib/appUpdate';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    // Консоль остаётся для разработки, но о белом экране в цеху по ней
    // не узнать: отчёт уходит наружу, если приёмник настроен (C7 аудита).
    // Устаревшая вкладка после выкатки в отчёт не идёт: наблюдаемость должна
    // показывать поломки, а не наши же деплои.
    if (!isChunkLoadError(error)) reportError(error, 'render', info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  /**
   * Аварийный блок: полноэкранный сам по себе и КОМПАКТНЫЙ внутри оболочки.
   *
   * `compact` поднимается, когда владелец дал свой фолбэк: занять весь экран
   * внутри уже нарисованного меню значило бы разорвать раскладку — ровно тот
   * довод, ради которого фолбэк и передают. Содержимое при этом одно и то же:
   * два вида одного сообщения разошлись бы в первую же правку.
   */
  renderNotice(isUpdate, compact) {
    return (
        <div style={compact ? {
          display: 'flex',
          justifyContent: 'center',
          padding: 'var(--space-2xl) var(--space-lg)',
          fontFamily: 'var(--font-body)',
          color: 'var(--text)',
        } : {
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          fontFamily: 'var(--font-body)',
          color: 'var(--text)',
        }}>
          <div style={{
            background: 'var(--card)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)',
            padding: '40px 32px',
            maxWidth: 420,
            width: '90%',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>{isUpdate ? '⟳' : '⚠'}</div>
            <h2 style={{
              fontSize: 18,
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              marginBottom: 8,
            }}>
              {isUpdate ? UPDATE_TITLE : 'Что-то пошло не так'}
            </h2>
            <p style={{
              fontSize: 13,
              color: 'var(--text-dim)',
              marginBottom: 20,
              lineHeight: 1.5,
            }}>
              {isUpdate
                ? UPDATE_MESSAGE
                : (this.state.error?.message || 'Произошла непредвиденная ошибка')}
            </p>
            <button
              onClick={this.handleReload}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 24px',
                fontSize: 14,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
              }}
            >
              {isUpdate ? 'Обновить' : 'Перезагрузить'}
            </button>
          </div>
        </div>
    );
  }

  render() {
    if (this.state.hasError) {
      /**
       * Ленивый экран, чей чанк исчез после выкатки, — не поломка приложения,
       * а устаревшая вкладка (планшет в цеху держат открытым сутками).
       * Общий текст «Что-то пошло не так» читается там как «программа
       * сломалась», хотя лечится одной кнопкой. Перезагружаем только
       * по нажатию: в соседней форме может быть набранное.
       */
      const isUpdate = isChunkLoadError(this.state.error);
      // Локальный фолбэк (напр. один экран внутри оболочки ERP): полноэкранный
      // блок ниже разорвал бы layout, поэтому владелец даёт свой.
      const { fallback } = this.props;
      /**
       * УСТАРЕВШАЯ ВКЛАДКА РЕШАЕТСЯ ЗДЕСЬ И ВЛАДЕЛЬЦУ ФОЛБЭКА НЕ ДЕЛЕГИРУЕТСЯ.
       *
       * `isUpdate` вычислялся строкой выше и не доживал до применения: ветка
       * пользовательского фолбэка стоит раньше и возвращает управление
       * владельцу, который про обновление не знает. А фолбэк передаёт ВЕСЬ
       * раздел «Производство» (`ErpApp`), то есть ровно тот, которым
       * пользуются, — и на планшете в цеху выкатка показывала «Не удалось
       * загрузить экран (Importing a module script failed.) / Проверьте связь»
       * с кнопкой «Повторить». Совет неверный (связь ни при чём), а кнопка
       * не может сработать НИКОГДА: `reset` перемонтирует тот же ленивый
       * импорт, а файла по этому адресу больше нет.
       *
       * Отсюда и место починки: распознавание живёт у ПИСАТЕЛЯ, а не
       * у вызывающего. Прокинуть признак в сигнатуру фолбэка значило бы
       * править каждого вызывающего — все они `.jsx`, где аргументы
       * тайпчеком не проверяются, то есть забытый вызывающий молча вернул бы
       * прежнее поведение.
       */
      if (isUpdate) return this.renderNotice(true, Boolean(fallback));
      if (fallback) {
        return typeof fallback === 'function'
          ? fallback(this.state.error, this.handleReset)
          : fallback;
      }
      /*
       * ФОЛБЭКОВ ЗДЕСЬ НЕТ (снято 06.09), хотя экран аварийный.
       *
       * Их было восемь, и один уже разошёлся с правдой: `var(--text-dim, #999)`
       * при настоящем #666666 — то есть на экране, который человек видит вместо
       * приложения, текст красился бы значением, забракованным аудитом контраста.
       * Ещё один называл `Barlow Condensed`, которого в проекте больше нет.
       *
       * Довод «а вдруг токенов не будет» не работает: `index.css` импортируется
       * в `main.jsx` до React, а в сборке это <link> в <head>. Если токенов нет,
       * значит не загрузился CSS — и тогда фолбэк спасёт цвет заголовка,
       * но не вёрстку вокруг.
       *
       * Сторож не видел этого блока по построению: `tokens.test.ts` читал только
       * CSS. С 06.09 он читает и разметку — правило «обход по CSS не видит
       * инлайн-стилей» записано 04.09, но применено было к одному сторожу.
       */
      return this.renderNotice(false, false);
    }
    return this.props.children;
  }
}
