import { NavLink } from 'react-router-dom'

const navSections = [
  {
    label: 'CAMPAIGN',
    links: [
      { to: '/', label: 'Campaign Manager' },
    ],
  },
  {
    label: 'WORLD',
    links: [
      { to: '/world',            label: 'World Builder' },
      { to: '/world/factions',   label: 'Factions',   sub: true },
      { to: '/world/npcs',       label: 'NPCs',       sub: true },
      { to: '/world/locations',  label: 'Locations',  sub: true },
      { to: '/lore',             label: 'Lore & Connections' },
      { to: '/mindmap',          label: 'Mind Map' },
    ],
  },
  {
    label: 'MAPS',
    links: [
      { to: '/maps', label: 'Map Engine' },
    ],
  },
  {
    label: 'TOOLS',
    links: [
      { to: '/compendium',  label: 'Compendium' },
      { to: '/characters',  label: 'Character Sheets' },
      { to: '/encounters',  label: 'Encounter Builder' },
      { to: '/calculator',  label: 'Combat Calculator' },
    ],
  },
  {
    label: 'AI',
    links: [
      { to: '/ai', label: 'AI Assistant' },
    ],
  },
  {
    label: 'SETTINGS',
    links: [
      { to: '/settings', label: 'Settings' },
    ],
  },
]

export default function Sidebar() {
  return (
    <nav style={sidebarStyle}>
      {navSections.map((section) => (
        <div key={section.label}>
          <div style={sectionLabelStyle}>{section.label}</div>
          {section.links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              style={({ isActive }) => ({
                ...(link.sub ? subLinkStyle : linkStyle),
                ...(isActive ? (link.sub ? activeSubLinkStyle : activeLinkStyle) : {}),
              })}
            >
              {link.sub ? '· ' : ''}{link.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

const sidebarStyle = {
  width: '240px', minWidth: '240px', background: '#1a1208',
  borderRight: '1px solid #3a2a10', overflowY: 'auto',
  display: 'flex', flexDirection: 'column', padding: '1rem 0',
}
const sectionLabelStyle = {
  fontSize: '0.65rem', fontWeight: 'bold', letterSpacing: '0.12em',
  color: '#7a6035', padding: '1rem 1.25rem 0.35rem', textTransform: 'uppercase',
}
const linkStyle = {
  display: 'block', padding: '0.5rem 1.25rem', color: '#c9a84c',
  textDecoration: 'none', fontSize: '0.875rem',
  borderRadius: '0 4px 4px 0', marginRight: '0.5rem', transition: 'background 0.15s',
}
const activeLinkStyle   = { ...linkStyle, background: '#2d1f0a', color: '#f0d080' }
const subLinkStyle      = { ...linkStyle, fontSize: '0.82rem', paddingLeft: '1.75rem', color: '#a89060' }
const activeSubLinkStyle = { ...subLinkStyle, background: '#2d1f0a', color: '#c9a84c' }
