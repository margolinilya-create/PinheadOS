import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const COMMANDS = [
  { id: 'wizard', label: 'Новый заказ', desc: 'Открыть визард', path: '/', icon: '+' },
  { id: 'orders', label: 'Заказы', desc: 'Kanban-доска', path: '/orders', icon: '☰' },
  { id: 'express', label: 'Экспресс калькулятор', desc: 'Быстрый расчёт', path: '/express', icon: '⚡' },
  { id: 'sku', label: 'Каталог SKU', desc: 'Управление изделиями', path: '/sku', icon: '📦' },
  { id: 'prices', label: 'Цены нанесений', desc: 'Матрицы цен', path: '/sku?tab=pricing', icon: '💰' },
  { id: 'analytics', label: 'Аналитика', desc: 'Дашборд', path: '/analytics', icon: '📊' },
  { id: 'admin', label: 'Админ-панель', desc: 'Управление', path: '/admin', icon: '⚙' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => {
          if (!v) setQuery('');
          return !v;
        });
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const q = query.toLowerCase();
  const filtered = COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );

  const handleSelect = (cmd) => {
    navigate(cmd.path);
    setOpen(false);
  };

  /**
   * СТРЕЛКИ И ВЫБРАННЫЙ ПУНКТ (правка 12.09).
   *
   * Здесь стояло `handleSelect(filtered[0])` — то есть `Enter` ВСЕГДА брал
   * первый результат, а стрелки не работали вовсе. Пункт, до которого человек
   * «дошёл», существовал только в его голове: подсветки не было, и палитра
   * из семи пунктов годилась ровно для одного — первого.
   *
   * Выбор зажимается ПРИ ОТРИСОВКЕ (`cursorAt`), а не эффектом: список
   * перестраивается на каждый символ, и хранить индекс, который уже вышел
   * за его конец, незачем. Заворот по кругу — чтобы у списка не было двух
   * тупиков (то же правило, что у `nextIndex` в палитре ERP).
   */
  const cursorAt = cursor >= filtered.length ? 0 : cursor;

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((cursorAt + delta + filtered.length) % filtered.length);
      return;
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      handleSelect(filtered[cursorAt]);
    }
  };

  return (
    <>
      <div className="cmd-backdrop" onClick={() => setOpen(false)} />
      <div className="cmd-palette" role="dialog" aria-modal="true" aria-label="Быстрый поиск">
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Куда перейти..."
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={handleKeyDown}
        />
        <div className="cmd-list">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={i === cursorAt ? 'cmd-item cmd-item-active' : 'cmd-item'}
              aria-current={i === cursorAt ? 'true' : undefined}
              /* Наведение двигает ВЫБОР, а не подсвечивает отдельно: две
                 подсветки рядом — это вопрос, какая сработает по Enter */
              onMouseMove={() => setCursor(i)}
              onClick={() => handleSelect(cmd)}
            >
              <span className="cmd-icon">{cmd.icon}</span>
              <div className="cmd-item-text">
                <span className="cmd-label">{cmd.label}</span>
                <span className="cmd-desc">{cmd.desc}</span>
              </div>
              <kbd className="cmd-shortcut">↵</kbd>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="cmd-empty">Ничего не найдено</div>
          )}
        </div>
        <div className="cmd-footer">
          <kbd>↑</kbd><kbd>↓</kbd> выбор &nbsp; <kbd>↵</kbd> открыть &nbsp; <kbd>esc</kbd> закрыть
        </div>
      </div>
    </>
  );
}
