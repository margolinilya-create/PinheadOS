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

  it('shows active zone as active', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    const activeZones = container.querySelectorAll('.zm-zone.active');
    expect(activeZones.length).toBe(1);
  });

  it('renders all available zones', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    const zones = container.querySelectorAll('.zm-zone');
    expect(zones.length).toBe(3); // front, back, sleeve-l
  });

  it('no active zones when activeZones=[]', () => {
    const { container } = render(<ZoneMockup {...baseProps} activeZones={[]} />);
    const active = container.querySelectorAll('.zm-zone.active');
    expect(active.length).toBe(0);
  });

  it('shows no summary chips when no active zones', () => {
    const { container } = render(<ZoneMockup {...baseProps} activeZones={[]} />);
    const summary = container.querySelector('.zm-summary');
    expect(summary).toBeNull();
  });

  it('shows summary chips for active zones', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    const chips = container.querySelectorAll('.zm-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('Шелко');
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
    const active = container.querySelectorAll('.zm-zone.active');
    expect(active.length).toBe(2);
  });

  it('handles onZoneClick callback', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ZoneMockup {...baseProps} onZoneClick={onClick} />
    );
    const zone = container.querySelector('.zm-zone');
    zone.click();
    expect(onClick).toHaveBeenCalled();
  });

  it('zone labels have title attribute', () => {
    const { container } = render(<ZoneMockup {...baseProps} />);
    const zone = container.querySelector('.zm-zone');
    expect(zone.getAttribute('title')).toBeTruthy();
  });
});
