import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pipeline } from './Pipeline';

const stages = [
  { key: 'p', label: 'Лекала', icon: '📐', count: 3 },
  { key: 'd', label: 'Проработка', icon: '🧵', count: 8 },
];

describe('Pipeline', () => {
  it('рендерит подписи фаз и счётчики', () => {
    render(<Pipeline stages={stages} />);
    expect(screen.getByText(/Лекала/)).toBeInTheDocument();
    expect(screen.getByText(/Проработка/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('боковой узел (aside) показывается только при count > 0', () => {
    const { queryByText, rerender } = render(
      <Pipeline stages={stages} aside={{ key: 'r', label: 'Возврат', icon: '↩', count: 0 }} />,
    );
    expect(queryByText(/Возврат/)).toBeNull();
    rerender(<Pipeline stages={stages} aside={{ key: 'r', label: 'Возврат', icon: '↩', count: 4 }} />);
    expect(screen.getByText(/Возврат/)).toBeInTheDocument();
  });
});
