import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ZoneMockup from './ZoneMockup';

// Mock mockup utility
vi.mock('../../utils/mockup', () => ({
  getGarmentSVG: vi.fn(() => '<svg><rect width="100" height="100"/></svg>'),
}));

const baseProps = {
  garmentType: 'tee',
  color: '01-01',
  availableZones: ['front', 'back', 'sleeve-l'],
  activeZones: ['front'],
  zoneTechs: { front: 'screen' },
  zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
  flexZones: {},
  dtgZones: {},
  embZones: {},
  dtfZones: {},
};

describe('ZoneMockup', () => {
  it('renders without errors', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('.zm-wrap')).toBeTruthy();
  });

  it('renders SVG mockup', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    expect(container.querySelector('.zm-svg')).toBeTruthy();
  });

  it('renders clean mockup without zone overlays', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    const zones = container.querySelectorAll('.zm-zone');
    expect(zones.length).toBe(0);
  });

  it('renders clean mockup without summary chips', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    const summary = container.querySelector('.zm-summary');
    expect(summary).toBeNull();
  });

  it('renders for hoodie type', () => {
    const { container } = render(
      <ZoneMockup
        {...baseProps}
        garmentType="hoodie"
        availableZones={['front', 'back', 'hood']}
        activeZones={['front', 'hood']}
        zoneTechs={{ front: 'screen', hood: 'embroidery' }}
        embZones={{ hood: { colors: 3, area: 's' } }}
      />
    );
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('.zm-svg')).toBeTruthy();
  });

  it('renders with empty activeZones', () => {
    const { container } = render(<ZoneMockup {...baseProps} activeZones={[]} />);
    expect(container.querySelector('.zm-wrap')).toBeTruthy();
    expect(container.querySelector('.zm-svg')).toBeTruthy();
  });
});
