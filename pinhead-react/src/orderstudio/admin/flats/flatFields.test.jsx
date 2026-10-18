import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MmField } from './flatFields';

describe('MmField — показ миллиметров', () => {
  it('хвост плавающей точки не показывается: разность 598,8 − 238,8 → «360», 0,1 мм остаются', () => {
    const { rerender } = render(<MmField id="h" label="В, мм" value={598.8 - 238.8} onCommit={() => {}} />);
    expect(screen.getByLabelText('В, мм')).toHaveValue('360');
    rerender(<MmField id="h" label="В, мм" value={337.6} onCommit={() => {}} />);
    expect(screen.getByLabelText('В, мм')).toHaveValue('337,6');
    rerender(<MmField id="h" label="В, мм" value={0.125} onCommit={() => {}} />);
    expect(screen.getByLabelText('В, мм')).toHaveValue('0,13');
  });
});
