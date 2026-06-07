import { Component } from 'react'

export default class PlayerErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[PlayerView] Unhandled error:', error, info)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={s.root}>
          <div style={s.card}>
            <h2 style={s.title}>⚠ Player View Error</h2>
            <p style={s.message}>
              {this.state.error?.message || 'An unexpected error occurred in the Player View.'}
            </p>
            <button style={s.btn} onClick={this.handleReload}>
              Try Again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const s = {
  root:    { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0a05' },
  card:    { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '2rem', maxWidth: 480, textAlign: 'center' },
  title:   { color: '#e05050', fontSize: '1.3rem', marginBottom: '1rem' },
  message: { color: '#a89060', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  btn:     { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.5rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' },
}
