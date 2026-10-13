import { useCallback, useState } from 'react';
import { storageGet, storageSet } from '../../lib/storage';
import { currentUserId } from '../store/shared';
import { contextKey } from '../utils/chatContext';

/**
 * ЧЕРНОВИК СООБЩЕНИЯ — «если пользователь закрыл окно чата, не отправив
 * сообщение, при следующем открытии показать несохранённый текст»
 * (требование документа).
 *
 * КЛЮЧ — ЧЕЛОВЕК × ОБСУЖДЕНИЕ × КОНТЕКСТ, и все три части обязательны:
 * планшет в цеху общий (значит человек), у одной сделки несколько разговоров
 * (значит контекст), и недописанное «жду ответа по вышивке» не должно
 * всплыть в чужой сделке.
 *
 * ХРАНИЛИЩЕ — ОДИН КЛЮЧ на все черновики (`erp_chat_draft`), а не ключ
 * на разговор: `storageClearAll()` чистит перечисленные ключи поимённо,
 * и россыпь `erp_chat_draft_<uuid>` пережила бы выход из системы целиком.
 * Он же в `APP_KEYS`: текст переписки — данные человека, а не устройства.
 */

const KEY = 'erp_chat_draft';
/** Сколько черновиков помним. Разговоров за смену бывает много, текст короткий */
const LIMIT = 30;

function readAll() {
  const raw = storageGet(KEY, null);
  return raw && typeof raw === 'object' ? raw : {};
}

export function chatDraftKey(orderId, context) {
  return `${currentUserId() ?? 'anon'}|${orderId}|${contextKey(context)}`;
}

/**
 * @returns {[string, (text: string) => void, () => void]} текст, запись, сброс
 */
export function useChatDraft(orderId, context) {
  const key = chatDraftKey(orderId, context);
  const [state, setState] = useState(() => ({ key, text: readAll()[key] ?? '' }));

  /**
   * Смена разговора — это ДРУГОЙ черновик, а не продолжение прежнего. Без
   * этого текст, набранный для задачи, уезжал бы в общую ленту сделки при
   * переключении контекста — то есть отправлялся бы не туда.
   *
   * Правка ПРЯМО В ОТРИСОВКЕ, а не эффектом: это документированный приём
   * React для состояния, зависящего от пропа («adjusting state when a prop
   * changes»). Эффект отрисовал бы один кадр с ЧУЖИМ текстом в поле —
   * и, нажми человек «Отправить» в этот момент, отправил бы его.
   */
  if (state.key !== key) setState({ key, text: readAll()[key] ?? '' });
  const text = state.key === key ? state.text : (readAll()[key] ?? '');

  const write = useCallback((next) => {
    setState({ key, text: next });
    const all = readAll();
    if (next.trim()) all[key] = next;
    else delete all[key];
    /**
     * Потолок: самые старые ключи выбрасываются. Порядок вставки в объекте
     * сохраняется, поэтому «старые» — это первые; отдельной метки времени
     * заводить не нужно, а бесконечный рост localStorage однажды упёрся бы
     * в квоту и уронил ЗАПИСЬ ВСЕХ ключей приложения, а не только чата.
     */
    const keys = Object.keys(all);
    if (keys.length > LIMIT) {
      for (const k of keys.slice(0, keys.length - LIMIT)) delete all[k];
    }
    storageSet(KEY, all);
  }, [key]);

  const reset = useCallback(() => write(''), [write]);

  return [text, write, reset];
}
