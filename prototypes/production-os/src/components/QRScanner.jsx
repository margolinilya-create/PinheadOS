import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import styles from './QRScanner.module.css';

export default function QRScanner() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef(null);

  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);
  const currentWorkshop = useWorkshopStore(s => s.currentWorkshop);
  const selectTask = useWorkshopStore(s => s.selectTask);
  const setWorkshop = useWorkshopStore(s => s.setWorkshop);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const query = input.trim().toUpperCase();
    if (!query) return;

    setScanning(true);
    setError('');

    setTimeout(() => {
      setScanning(false);

      // Find the order by number
      const order = Object.values(orders).find(o =>
        o.order_number.toUpperCase() === query ||
        o.order_number.toUpperCase().replace('PH-', '') === query.replace('PH-', '')
      );

      if (!order) {
        setError(`Заказ "${query}" не найден. Проверьте номер.`);
        return;
      }

      // Find a task for this order in current workshop, or any active task
      let task = tasks.find(t =>
        t.order_id === order.id &&
        t.workshop_code === currentWorkshop &&
        (t.status === 'ready' || t.status === 'in_progress' || t.status === 'blocked')
      );

      // If not found in current workshop, find any active task for this order
      if (!task) {
        task = tasks.find(t =>
          t.order_id === order.id &&
          (t.status === 'ready' || t.status === 'in_progress' || t.status === 'blocked')
        );
      }

      // If still not found, find the first non-done, non-pending task
      if (!task) {
        task = tasks.find(t =>
          t.order_id === order.id && t.status !== 'done' && t.status !== 'pending'
        );
      }

      // Last resort: find any task
      if (!task) {
        task = tasks.find(t => t.order_id === order.id);
      }

      if (!task) {
        setError(`Нет задач для заказа "${query}".`);
        return;
      }

      // Switch to the workshop of the found task and open it
      setWorkshop(task.workshop_code);
      selectTask(task.id);
      navigate('/');
    }, 400);
  }

  // Demo quick-access buttons
  const demoOrders = Object.values(orders).slice(0, 6);

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>СКАНЕР QR</div>
        <div className={styles.sub}>Наведите камеру или введите номер заказа</div>

        {/* Camera frame mock */}
        <div className={styles.cameraFrame}>
          <div className={`${styles.corner} ${styles.cornerTl}`} />
          <div className={`${styles.corner} ${styles.cornerTr}`} />
          <div className={`${styles.corner} ${styles.cornerBl}`} />
          <div className={`${styles.corner} ${styles.cornerBr}`} />
          {scanning ? (
            <div className={styles.scanLine} />
          ) : (
            <div className={styles.cameraInner}>
              <div className={styles.cameraIcon}>📷</div>
              <div className={styles.cameraHint}>Камера недоступна в браузере</div>
            </div>
          )}
        </div>

        {/* Manual input */}
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formLabel}>Введите номер заказа</div>
          <div className={styles.inputRow}>
            <input
              ref={inputRef}
              className={styles.input}
              type="text"
              placeholder="PH-1042"
              value={input}
              onChange={e => { setInput(e.target.value); setError(''); }}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className={`${styles.submitBtn}${scanning ? ' ' + styles.submitBtnScanning : ''}`}
              disabled={!input.trim() || scanning}
            >
              {scanning ? '...' : 'Найти'}
            </button>
          </div>
          {error && <div className={styles.error}>{error}</div>}
        </form>

        {/* Quick access */}
        <div className={styles.quick}>
          <div className={styles.quickLabel}>Быстрый доступ</div>
          <div className={styles.quickList}>
            {demoOrders.map(o => (
              <button
                key={o.id}
                className={styles.quickBtn}
                onClick={() => {
                  setInput(o.order_number);
                  setError('');
                  inputRef.current?.focus();
                }}
              >
                {o.order_number}
              </button>
            ))}
          </div>
        </div>

        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← Назад
        </button>
      </div>
    </div>
  );
}
