import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';
import { useConfirmStore } from '../../../store/useConfirmStore';

/**
 * ПРАВКА И УДАЛЕНИЕ СВОИХ СООБЩЕНИЙ (вторая очередь чата, документ 20.09, п. 4).
 *
 * Серверная половина сторожится отдельно (`utils/chatServer.test.ts`), здесь —
 * то, за что отвечает разметка, и каждое из этих правил тихое:
 *
 *   · действия видны ТОЛЬКО у своего сообщения — иначе человек нажимает
 *     кнопку, которую сервер отклонит, и виноватым выглядит он;
 *   · у удалённого нет ни текста, ни файлов, ни кнопок — «Сообщение удалено»
 *     рядом с вложением и кнопкой «Изменить» не значит ничего;
 *   · правка может СНЯТЬ упоминание, но не добавить: уведомлений правка
 *     не шлёт, и новый упомянутый о зове не узнал бы.
 */

const ME = 'u-me';
const OTHER = 'u-other';

const MSG = (over = {}) => ({
  id: 'm1',
  thread_id: 't1',
  author_id: ME,
  body: 'Ткань приехала',
  item_id: null,
  stage_id: null,
  experimental_id: null,
  reply_to: null,
  created_at: '2026-09-20T10:00:00Z',
  edited_at: null,
  deleted_at: null,
  mentions: [],
  attachments: [],
  reply: null,
  read_count: 0,
  ...over,
});

const DIRECTORY = [
  { user_id: ME, name: 'Илья', email: null, role: null, department_id: null },
  { user_id: OTHER, name: 'Мария', email: null, role: null, department_id: null },
];

const nameOf = (id) => DIRECTORY.find((p) => p.user_id === id)?.name ?? 'Сотрудник';

const show = (message, props = {}) => render(
  <ChatMessage
    message={message}
    nameOf={nameOf}
    meId={ME}
    directory={DIRECTORY}
    onReply={() => {}}
    onEdit={vi.fn(async () => true)}
    onDelete={vi.fn(async () => true)}
    {...props}
  />,
);

beforeEach(() => {
  useConfirmStore.setState({ open: false, _resolver: null });
});

describe('действия сообщения', () => {
  it('у своего есть «Изменить» и «Удалить»', () => {
    show(MSG());
    expect(screen.getByText('Изменить')).toBeInTheDocument();
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  it('у чужого их нет', () => {
    show(MSG({ author_id: OTHER }));
    expect(screen.queryByText('Изменить')).not.toBeInTheDocument();
    expect(screen.queryByText('Удалить')).not.toBeInTheDocument();
  });

  it('у удалённого нет ни действий, ни текста, ни файлов', () => {
    show(MSG({
      deleted_at: '2026-09-20T11:00:00Z',
      body: '',
      attachments: [{ id: 'a1', file_path: 'x/y.png', file_name: 'макет.png' }],
    }));
    expect(screen.getByText('Сообщение удалено')).toBeInTheDocument();
    expect(screen.queryByText('Изменить')).not.toBeInTheDocument();
    expect(screen.queryByText('Удалить')).not.toBeInTheDocument();
    expect(screen.queryByText('Ответить')).not.toBeInTheDocument();
    expect(screen.queryByText('макет.png')).not.toBeInTheDocument();
  });
});

describe('правка на месте', () => {
  it('сохраняет новый текст и закрывает форму', async () => {
    const onEdit = vi.fn(async () => true);
    show(MSG(), { onEdit });

    fireEvent.click(screen.getByText('Изменить'));
    const area = screen.getByLabelText('Текст сообщения');
    expect(area).toHaveValue('Ткань приехала');

    fireEvent.change(area, { target: { value: 'Ткань приехала, 47 кг' } });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    const [message, body] = onEdit.mock.calls.at(-1);
    expect(message.id).toBe('m1');
    expect(body).toBe('Ткань приехала, 47 кг');
    await waitFor(() => expect(screen.queryByLabelText('Текст сообщения')).not.toBeInTheDocument());
  });

  /**
   * Снятое упоминание не должно уехать на сервер: там оно превратилось бы
   * в строку, которую считает счётчик «Упоминания» в колоколе.
   */
  it('упоминание, стёртое из текста, в вызов не попадает', async () => {
    const onEdit = vi.fn(async () => true);
    show(MSG({ body: '@Мария глянь', mentions: [OTHER] }), { onEdit });

    fireEvent.click(screen.getByText('Изменить'));
    fireEvent.change(screen.getByLabelText('Текст сообщения'), { target: { value: 'глянь' } });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(onEdit.mock.calls.at(-1)[2]).toEqual([]);
  });

  it('оставленное упоминание сохраняется', async () => {
    const onEdit = vi.fn(async () => true);
    show(MSG({ body: '@Мария глянь', mentions: [OTHER] }), { onEdit });

    fireEvent.click(screen.getByText('Изменить'));
    fireEvent.change(screen.getByLabelText('Текст сообщения'), {
      target: { value: '@Мария глянь, пожалуйста' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(onEdit.mock.calls.at(-1)[2]).toEqual([OTHER]);
  });

  it('отмена возвращает прежний текст и ничего не шлёт', () => {
    const onEdit = vi.fn(async () => true);
    show(MSG(), { onEdit });

    fireEvent.click(screen.getByText('Изменить'));
    fireEvent.change(screen.getByLabelText('Текст сообщения'), { target: { value: 'другое' } });
    fireEvent.click(screen.getByText('Отмена'));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('Ткань приехала')).toBeInTheDocument();
  });

  it('«изменено» показывается у правленого', () => {
    show(MSG({ edited_at: '2026-09-20T12:00:00Z' }));
    expect(screen.getByText('изменено')).toBeInTheDocument();
  });
});

describe('удаление', () => {
  /**
   * Удаление необратимо и затирает текст на сервере — «отменить» после него
   * нечем, поэтому подтверждение обязательно, а не желательно.
   */
  it('спрашивает подтверждение и удаляет только после согласия', async () => {
    const onDelete = vi.fn(async () => true);
    show(MSG(), { onDelete });

    fireEvent.click(screen.getByText('Удалить'));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    expect(onDelete).not.toHaveBeenCalled();

    useConfirmStore.getState()._close(true);
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
  });

  it('отказ в диалоге ничего не удаляет', async () => {
    const onDelete = vi.fn(async () => true);
    show(MSG(), { onDelete });

    fireEvent.click(screen.getByText('Удалить'));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    useConfirmStore.getState()._close(false);

    await new Promise((r) => { setTimeout(r, 0); });
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('цитата удалённого', () => {
  it('показывает «Сообщение удалено», а не пустую полоску', () => {
    show(MSG({
      reply: { id: 'm0', author_id: OTHER, body: '', deleted: true },
    }));
    expect(screen.getByText('Сообщение удалено')).toBeInTheDocument();
  });
});
