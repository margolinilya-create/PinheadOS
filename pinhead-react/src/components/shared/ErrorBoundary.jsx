import { Component } from 'react';
// eslint-disable-next-line no-unused-vars
import styles from './ErrorBoundary.module.css';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg, #FAFAFA)',
          fontFamily: 'var(--font-body, Inter, sans-serif)',
          color: 'var(--text, #0A0A0A)',
        }}>
          <div style={{
            background: 'var(--card, #fff)',
            border: '1px solid var(--border-light, #DCDCDC)',
            borderRadius: 'var(--radius-sm, 4px)',
            padding: '40px 32px',
            maxWidth: 420,
            width: '90%',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠</div>
            <h2 style={{
              fontSize: 18,
              fontFamily: 'var(--font-display, Barlow Condensed, sans-serif)',
              fontWeight: 600,
              marginBottom: 8,
            }}>
              Что-то пошло не так
            </h2>
            <p style={{
              fontSize: 13,
              color: 'var(--text-dim, #999)',
              marginBottom: 20,
              lineHeight: 1.5,
            }}>
              {this.state.error?.message || 'Произошла непредвиденная ошибка'}
            </p>
            <button
              onClick={this.handleReload}
              style={{
                background: 'var(--accent, #2B2BF0)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm, 4px)',
                padding: '10px 24px',
                fontSize: 14,
                fontFamily: 'var(--font-body, Inter, sans-serif)',
                cursor: 'pointer',
              }}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
