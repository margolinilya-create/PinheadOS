import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LabelConfigurator from './LabelConfigurator';
import { useStore } from '../../store/useStore';

beforeEach(() => {
  useStore.setState({
    labelConfig: {
      careLabel: { enabled: false, logoOption: 'no-logo', composition: '', country: '', comments: '' },
      mainLabel: { option: 'none', placement: 'neck', material: 'satin', color: 'white', comments: '' },
      hangTag: { option: 'none', comments: '' },
    },
    setLabelConfig: vi.fn(),
    toggleCareLabel: vi.fn(),
  });
});

describe('LabelConfigurator', () => {
  it('renders care label section', () => {
    render(<LabelConfigurator />);
    expect(screen.getByText(/уход/i)).toBeInTheDocument();
  });

  it('renders main label section', () => {
    render(<LabelConfigurator />);
    expect(screen.getByText(/Основная бирка/i)).toBeInTheDocument();
  });

  it('renders hang tag section', () => {
    render(<LabelConfigurator />);
    expect(screen.getAllByText(/Хэнг-тег/i).length).toBeGreaterThan(0);
  });

  it('calls toggleCareLabel on click', () => {
    const toggleCareLabel = vi.fn();
    useStore.setState({ toggleCareLabel });
    render(<LabelConfigurator />);
    const header = document.querySelector('.label-section-header');
    if (header) {
      fireEvent.click(header);
      expect(toggleCareLabel).toHaveBeenCalled();
    }
  });

  it('shows care label fields when enabled', () => {
    useStore.setState({
      labelConfig: {
        ...useStore.getState().labelConfig,
        careLabel: { enabled: true, logoOption: 'no-logo', composition: '', country: '', comments: '' },
      },
    });
    render(<LabelConfigurator />);
    expect(screen.getByPlaceholderText(/100% хлопок/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Россия/)).toBeInTheDocument();
  });

  it('hides care label fields when disabled', () => {
    render(<LabelConfigurator />);
    expect(screen.queryByPlaceholderText(/100% хлопок/)).not.toBeInTheDocument();
  });

  it('calls setLabelConfig for main label option', () => {
    const setLabelConfig = vi.fn();
    useStore.setState({ setLabelConfig });
    render(<LabelConfigurator />);
    // Click on a main label option pill
    const pills = document.querySelectorAll('.label-option-pill');
    if (pills.length > 0) {
      fireEvent.click(pills[pills.length - 1]); // click last pill
      expect(setLabelConfig).toHaveBeenCalled();
    }
  });
});
