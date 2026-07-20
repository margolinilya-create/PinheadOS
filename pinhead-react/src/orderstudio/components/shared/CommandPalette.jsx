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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && filtered.length > 0) {
      handleSelect(filtered[0]);
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
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="cmd-list">
          {filtered.map(cmd => (
            <button
              key={cmd.id}
              className="cmd-item"
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
          <kbd>↵</kbd> выбрать &nbsp; <kbd>esc</kbd> закрыть
        </div>
      </div>
    </>
  );
}
