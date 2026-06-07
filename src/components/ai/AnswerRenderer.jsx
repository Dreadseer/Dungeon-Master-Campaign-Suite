// Renders AI answer text with basic markdown: **bold**, bullet lists, line breaks
export default function AnswerRenderer({ text }) {
  if (!text) return null
  const lines = text.split('\n')

  return (
    <div style={s.root}>
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />

        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <li key={i} style={s.li}>
              {renderInline(line.slice(2))}
            </li>
          )
        }

        // Numbered list item: "1. ..." or "1) ..."
        const numMatch = line.match(/^(\d+)[.)]\s+(.+)/)
        if (numMatch) {
          return (
            <li key={i} style={s.li}>
              <span style={s.numBullet}>{numMatch[1]}.</span>
              {renderInline(numMatch[2])}
            </li>
          )
        }

        // Section heading: line ending with ":"
        if (line.match(/^[A-Z][^.!?]*:$/) && line.length < 60) {
          return <p key={i} style={s.heading}>{renderInline(line)}</p>
        }

        return <p key={i} style={s.p}>{renderInline(line)}</p>
      })}
    </div>
  )
}

// Render inline bold (**text**) within a line
function renderInline(text) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: '#C9A84C' }}>{part}</strong>
      : part
  )
}

const s = {
  root: {
    fontFamily: 'inherit',
    fontSize:   13,
    color:      '#e8e0d0',
    lineHeight: 1.7,
  },
  p: {
    margin:       '0 0 6px',
    padding:      0,
  },
  heading: {
    margin:     '8px 0 4px',
    padding:    0,
    color:      '#C9A84C',
    fontWeight: 600,
    fontSize:   13,
  },
  li: {
    marginLeft:   '1.2rem',
    marginBottom: 4,
    listStyleType: 'disc',
  },
  numBullet: {
    color:       '#C9A84C',
    fontWeight:  600,
    marginRight: 6,
  },
}
