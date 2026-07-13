import React from 'react'
import { createRoot } from 'react-dom/client'
import PlayerWebApp from './PlayerWebApp'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(err) {
    return { error: err }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', color: '#f08080',
          background: '#1a0a0a', minHeight: '100vh' }}>
          <h2 style={{ color: '#e05050', marginBottom: '1rem' }}>⚠ Player App Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <PlayerWebApp />
  </ErrorBoundary>
)
