import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { currentUserId } from '../../store/shared';
import { Button } from '../Button';
import { LoadFailed } from '../ErpStates';
import { Skeleton } from '../../../components/shared/Skeleton';
import { ChatMessage } from './ChatMessage';
import { ChatComposer } from './ChatComposer';
import { isWholeDeal } from '../../utils/chatContext';
import styles from '../../styles';

/**
 * ОБСУЖДЕНИЕ СДЕЛКИ — лента и отправка.
 *
 * Панель одна на все входы: вкладка карточки заказа, страница задания,
 * карточка разработки. Разная у них только ОТПРАВНАЯ ТОЧКА (какой контекст
 * выбран сначала), а не правила — вторая реализация ленты означала бы два
 * ответа на вопрос «что считать прочитанным».
 *
 * ПЕРЕКЛЮЧАТЕЛЬ «вся сделка / эта задача» — ВИД, а не право (решение
 * владельца 14.09): видит переписку тот, кто видит сделку. Поэтому он
 * показывается только там, где контекст вообще есть, и не обещает никакой
 * приватности.
 */
export function ChatPanel({ orderId, context = {}, contextLabel = null }) {
  const {
    messages, hasMore, loading, error, directory, unread, ping,
    openChat, loadMore, refresh, send, loadDirectory, markRead, closeChat,
  } = useErpStore(useShallow((s) => ({
    messages: s.chatMessages,
    hasMore: s.chatHasMore,
    loading: s.chatLoading,
    error: s.chatError,
    directory: s.chatDirectory,
    unread: s.chatUnread[orderId],
    ping: s.chatPing,
    openChat: s.openChat,
    loadMore: s.loadMoreChat,
    refresh: s.refreshChat,
    send: s.sendChatMessage,
    loadDirectory: s.loadChatDirectory,
    markRead: s.markChatRead,
    closeChat: s.closeChat,
  })));

  /** Выбранный вид: контекст задачи либо вся сделка */
  const [scoped, setScoped] = useState(!isWholeDeal(context));
  const active = useMemo(() => (scoped ? context : {}), [scoped, context]);
  const [replyTo, setReplyTo] = useState(null);
  const feedRef = useRef(null);
  const meId = currentUserId();

  const contextId = JSON.stringify(active);
  useEffect(() => {
    void loadDirectory();
    void openChat(orderId, JSON.parse(contextId));
    /**
     * Панель размонтируется — лента закрывается. Иначе следующее открытие
     * первым кадром покажет ЧУЖОЙ разговор (тот, что остался в сторе),
     * и только потом заменит его своим.
     */
    return () => closeChat();
  }, [orderId, contextId, openChat, loadDirectory, closeChat]);

  /**
   * ЗВОНОК REALTIME. Из события берётся только факт «что-то пришло»
   * (`chatPing`), содержимое дочитывает `refreshChat`. Первый проход
   * пропускается: лента только что загружена `openChat`.
   */
  const seenPing = useRef(ping);
  useEffect(() => {
    if (seenPing.current === ping) return;
    seenPing.current = ping;
    void refresh();
  }, [ping, refresh]);

  /**
   * ПРОЧИТАНО — по ПОКАЗУ ленты, а не по открытию карточки: человек может
   * сидеть на вкладке «Позиции» с открытым счётчиком, и гасить его там
   * значило бы объявить прочитанным то, чего он не видел.
   *
   * Гасится ровно тот счётчик, который он закрыл: у сделки — общий,
   * у задачи — её (требование документа «просмотр переписки отдельной задачи
   * не отмечает прочитанными сообщения других задач»).
   */
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!lastMessageId) return;
    void markRead(orderId, scoped ? (context.stageId ?? null) : null);
  }, [orderId, lastMessageId, scoped, context.stageId, markRead]);

  // Новое сообщение прокручивает ленту вниз — но только если человек и так
  // внизу: иначе чтение старого разговора уезжало бы из-под пальца
  const atBottom = useRef(true);
  useEffect(() => {
    const el = feedRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  const nameOf = useCallback((userId) => {
    const person = directory.find((p) => p.user_id === userId);
    return person?.name || 'Сотрудник';
  }, [directory]);

  const onSend = useCallback(async (input) => {
    const result = await send({ ...input, orderId, context: active });
    return Boolean(result);
  }, [send, orderId, active]);

  const showSwitch = !isWholeDeal(context);
  const unreadTotal = unread?.total ?? 0;

  return (
    <section className={styles.chatPanel} aria-label="Обсуждение сделки">
      {showSwitch && (
        <div className={styles.chatScope} role="group" aria-label="Что показывать">
          <Button
            size="sm"
            variant={scoped ? 'primary' : 'ghost'}
            onClick={() => setScoped(true)}
          >
            {contextLabel || 'Эта задача'}
          </Button>
          <Button
            size="sm"
            variant={scoped ? 'ghost' : 'primary'}
            onClick={() => setScoped(false)}
          >
            Вся сделка{unreadTotal > 0 ? ` · ${unreadTotal}` : ''}
          </Button>
        </div>
      )}

      <div
        className={styles.chatFeed}
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {error && !loading && messages.length === 0 && (
          <LoadFailed onRetry={() => openChat(orderId, active)} what="переписку" />
        )}

        {hasMore && !loading && (
          <div className={styles.chatMore}>
            <Button size="sm" variant="ghost" onClick={() => loadMore()}>
              Показать более ранние
            </Button>
          </div>
        )}
        {loading && messages.length === 0 && (
          <div className={styles.chatSkeleton}>
            <Skeleton width="60%" height={12} />
            <Skeleton width="40%" height={12} />
            <Skeleton width="75%" height={12} />
          </div>
        )}
        {!loading && !error && messages.length === 0 && (
          <p className={styles.subText}>
            {isWholeDeal(active)
              ? 'Обсуждения пока нет — напишите первым.'
              : 'По этой задаче пока не писали. Общая переписка сделки — на соседней вкладке.'}
          </p>
        )}

        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            message={m}
            nameOf={nameOf}
            meId={meId}
            onReply={setReplyTo}
            highlighted={replyTo?.id === m.id}
          />
        ))}
      </div>

      <ChatComposer
        orderId={orderId}
        context={active}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={onSend}
        nameOf={nameOf}
      />
    </section>
  );
}
