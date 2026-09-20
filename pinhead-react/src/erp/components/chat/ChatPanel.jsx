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
import { buildFeed } from '../../utils/chatFeed';
import { useSeenMessages } from '../../hooks/useSeenMessages';
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
export function ChatPanel({ orderId, context = {}, contextLabel = null, focusId = null }) {
  const {
    messages, hasMore, loading, error, directory, unread, unreadAnchor, ping, realtimeLive,
    openChat, loadMore, refresh, send, loadDirectory, markRead, markSeen, loadUnread, closeChat,
  } = useErpStore(useShallow((s) => ({
    messages: s.chatMessages,
    hasMore: s.chatHasMore,
    loading: s.chatLoading,
    error: s.chatError,
    directory: s.chatDirectory,
    unread: s.chatUnread[orderId],
    unreadAnchor: s.chatUnreadAnchor,
    ping: s.chatPing,
    realtimeLive: s.realtimeLive,
    openChat: s.openChat,
    loadMore: s.loadMoreChat,
    refresh: s.refreshChat,
    send: s.sendChatMessage,
    loadDirectory: s.loadChatDirectory,
    markRead: s.markChatRead,
    markSeen: s.markChatSeen,
    loadUnread: s.loadChatUnread,
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
   * ФОЛБЭК, ПОКА КАНАЛ ЛЕЖИТ. Документ обещает новые сообщения «не позднее
   * чем через 10 секунд», а подписка умеет падать: переподключение растёт
   * шагами до минуты, и ровно в этот промежуток обещание не выполнялось бы —
   * то есть тогда, когда оно и нужно.
   *
   * Опрос идёт ТОЛЬКО при открытой переписке и ТОЛЬКО пока связи нет:
   * постоянный поллинг рядом с работающим realtime — это второй источник
   * тех же данных и лишний трафик на цеховом Wi-Fi.
   */
  useEffect(() => {
    if (realtimeLive) return undefined;
    const timer = setInterval(() => { void refresh(); }, 7000);
    return () => clearInterval(timer);
  }, [realtimeLive, refresh]);

  /**
   * ПРОЧИТАНО — по ПОКАЗУ ленты, а не по открытию карточки: человек может
   * сидеть на вкладке «Позиции» с открытым счётчиком, и гасить его там
   * значило бы объявить прочитанным то, чего он не видел.
   *
   * Гасится ровно тот счётчик, который он закрыл: у сделки — общий,
   * у задачи — её (требование документа «просмотр переписки отдельной задачи
   * не отмечает прочитанными сообщения других задач»).
   */
  /**
   * ГРАНИЦА НЕПРОЧИТАННОГО ФИКСИРУЕТСЯ ПРИ ОТКРЫТИИ И ЖИВЁТ ВЕСЬ СЕАНС
   * (правка 20.09, п. 4): «граница остаётся ориентиром в текущем сеансе,
   * даже когда видимые сообщения уже отмечены прочитанными».
   *
   * Считать её от счётчика на каждом кадре нельзя: первый же `markRead`
   * обнулил бы счётчик, и граница исчезла бы ровно в тот момент, когда
   * человек по ней ориентируется.
   */
  /**
   * Граница непрочитанного приходит ИЗ СТОРА: она считается один раз при
   * открытии переписки (см. `openChat`). Здесь её вычислять нельзя —
   * панель перерисовывается от каждого realtime-события, а показ ленты
   * тут же гасит счётчик, из которого граница выводится.
   */
  /**
   * ПОШТУЧНОЕ ПРОЧТЕНИЕ (правка 20.09, п. 4): прочитанным считается то,
   * что реально показалось на глаза при активном окне. Водяная отметка
   * ниже остаётся — она отвечает за счётчик вкладки и за всё, что прочитано
   * до перехода на поштучную модель.
   */
  const onSeen = useCallback(async (ids) => {
    const added = await markSeen(ids);
    // Счётчик перечитываем, только если что-то действительно отметилось:
    // повтор пачки ничего не меняет, и лишний запрос здесь — это запрос
    // на каждую прокрутку
    if (added > 0) void loadUnread(orderId);
  }, [markSeen, loadUnread, orderId]);
  const seen = useSeenMessages(onSeen, messages.length > 0);
  /**
   * Один узел — два наблюдателя: прокрутка (`feedRef`) и корень наблюдения
   * прочтения. Callback-ref, а не мутация в разметке: правило раздела
   * запрещает трогать `ref.current` во время рендера.
   */
  const attachFeed = useCallback((node) => {
    feedRef.current = node;
    seen.setRoot(node);
  }, [seen]);

  const feed = useMemo(
    () => buildFeed(messages, { firstUnreadId: unreadAnchor }),
    [messages, unreadAnchor],
  );

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

  /**
   * Переход ИЗ УВЕДОМЛЕНИЯ ведёт на конкретное сообщение
   * (`/orders/:id?tab=chat&msg=<id>`). Прокрутка идёт к нему, а не вниз:
   * человека позвали в разговор недельной давности, и «последнее сообщение»
   * ответа на «зачем меня звали» не даёт.
   *
   * Сообщения может не оказаться в загруженной странице — тогда прокрутки
   * не будет, и это честно: лента остаётся там, где открылась, а кнопка
   * «Показать более ранние» на месте.
   */
  useEffect(() => {
    if (!focusId || messages.length === 0) return;
    const node = document.getElementById(`chat-msg-${focusId}`);
    if (node) node.scrollIntoView({ block: 'center' });
  }, [focusId, messages.length]);

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
        ref={attachFeed}
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

        {/*
          ЛЕНТА РАЗОБРАНА НА УЗЛЫ (правка 20.09, п. 4): разделители дней,
          граница непрочитанного и группы сообщений одного автора. Раньше
          здесь стоял плоский `messages.map`, и каждое сообщение несло полную
          шапку с датой — в переписке из двадцати реплик подряд это двадцать
          повторов одного имени и одной даты.
        */}
        {feed.map((node) => {
          if (node.kind === 'day') {
            return (
              <div key={node.key} className={styles.chatDay} role="separator">
                <span>{node.label}</span>
              </div>
            );
          }
          if (node.kind === 'unread') {
            return (
              <div key={node.key} className={styles.chatUnreadLine} role="separator">
                <span>Непрочитанные сообщения</span>
              </div>
            );
          }
          return (
            <div key={node.key} className={styles.chatGroup}>
              {node.messages.map((m, i) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  nameOf={nameOf}
                  meId={meId}
                  onReply={setReplyTo}
                  highlighted={replyTo?.id === m.id || focusId === m.id}
                  directory={directory}
                  /* Имя автора — только над ГРУППОЙ: повтор у каждой реплики
                     и есть то, что документ просит объединить визуально */
                  compact={i > 0}
                  observeRef={seen.observe}
                />
              ))}
            </div>
          );
        })}
      </div>

      <ChatComposer
        orderId={orderId}
        context={active}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={onSend}
        nameOf={nameOf}
        directory={directory}
      />
    </section>
  );
}
