const pulseStyle = `
  @keyframes skeletonPulse {
    0%, 100% { opacity: 0.4 }
    50%       { opacity: 0.8 }
  }
`

let injected = false
function injectStyle() {
  if (injected || typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = pulseStyle
  document.head.appendChild(el)
  injected = true
}

export default function Skeleton({ width = '100%', height = '1rem', borderRadius = '4px', count = 1 }) {
  injectStyle()
  const bar = {
    display: 'block',
    width,
    height,
    borderRadius,
    background: '#2d1f0a',
    marginBottom: '0.5rem',
    animation: 'skeletonPulse 1.4s ease-in-out infinite',
  }
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={bar} />
      ))}
    </>
  )
}
