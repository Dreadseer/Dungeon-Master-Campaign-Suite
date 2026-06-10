import { useState, useEffect, useCallback } from 'react'
import useCampaignStore    from '../../stores/campaignStore'
import EntityModal         from '../world/EntityModal'
import HomebrewCard        from './HomebrewCard'
import CustomItemForm      from './forms/CustomItemForm'
import CustomSpellForm     from './forms/CustomSpellForm'
import CustomEquipmentForm from './forms/CustomEquipmentForm'
import CustomMonsterForm   from './forms/CustomMonsterForm'
import PdfImportPanel      from './PdfImportPanel'

const TYPE_TABS = [
  { key: 'all',       label: 'All'       },
  { key: 'item',      label: 'Items'     },
  { key: 'spell',     label: 'Spells'    },
  { key: 'equipment', label: 'Equipment' },
  { key: 'monster',   label: 'Monsters'  },
]

const TYPE_LABELS = { item: 'Item', spell: 'Spell', equipment: 'Equipment', monster: 'Monster' }

const TYPE_COLORS = {
  item:      { bg: '#1a3a1a', border: '#3a6a3a', text: '#7aba7a' },
  spell:     { bg: '#1a1a3a', border: '#3a3a7a', text: '#7a7ada' },
  equipment: { bg: '#2a1a08', border: '#5a3a10', text: '#ba8a4a' },
  monster:   { bg: '#2a1a1a', border: '#6a2a2a', text: '#da7a7a' },
}

const FORM_MAP = {
  item:      CustomItemForm,
  spell:     CustomSpellForm,
  equipment: CustomEquipmentForm,
  monster:   CustomMonsterForm,
}

export default function CustomBrowser() {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [entries,        setEntries]        = useState([])
  const [loading,        setLoading]        = useState(false)
  const [typeTab,        setTypeTab]        = useState('all')
  const [search,         setSearch]         = useState('')
  const [selected,       setSelected]       = useState(null)   // entry shown in HomebrewCard
  const [modalType,      setModalType]      = useState(null)   // 'item'|'spell'|'equipment'|'monster'
  const [editEntry,      setEditEntry]      = useState(null)   // entry being edited (null = create)
  const [pickerOpen,     setPickerOpen]     = useState(false)  // "New Entry ▾" dropdown
  const [confirmDelete,  setConfirmDelete]  = useState(null)   // entry pending delete confirmation
  const [showPdfImport,  setShowPdfImport]  = useState(false)  // slide-in PDF import panel

  // ── Load entries ────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!activeCampaign) return
    setLoading(true)
    try {
      const type = typeTab === 'all' ? undefined : typeTab
      const data = await window.electronAPI.db.compendium.getAll(activeCampaign.id, type)
      setEntries(data)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [activeCampaign, typeTab])

  useEffect(() => { load() }, [load])

  // Clear selection on tab switch
  useEffect(() => { setSelected(null) }, [typeTab])

  // ── No campaign guard ────────────────────────────────────────────
  if (!activeCampaign) {
    return (
      <div style={s.empty}>
        <p style={s.emptyIcon}>📜</p>
        <p style={s.emptyTitle}>No Campaign Selected</p>
        <p style={s.emptyText}>
          Select or create a campaign to manage custom compendium entries.
        </p>
      </div>
    )
  }

  // ── Client-side search ───────────────────────────────────────────
  const filtered = entries.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  )

  // ── Handlers ────────────────────────────────────────────────────
  async function handleSave({ name, data }) {
    if (editEntry) {
      await window.electronAPI.db.compendium.update(editEntry.id, { name, data })
    } else {
      await window.electronAPI.db.compendium.create({
        campaign_id: activeCampaign.id,
        type: modalType,
        name,
        data,
      })
    }
    closeModal()
    await load()
  }

  async function handleDelete(entry) {
    await window.electronAPI.db.compendium.delete(entry.id)
    setConfirmDelete(null)
    if (selected?.id === entry.id) setSelected(null)
    await load()
  }

  function openCreate(type) {
    setPickerOpen(false)
    setEditEntry(null)
    setModalType(type)
  }

  function openEdit(entry) {
    setEditEntry(entry)
    setModalType(entry.type)
  }

  function closeModal() {
    setModalType(null)
    setEditEntry(null)
  }

  const activeType    = typeTab === 'all' ? null : typeTab
  const FormComponent = modalType ? FORM_MAP[modalType] : null

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div style={s.wrapper}>

      {/* ── Top bar ── */}
      <div style={s.topBar}>
        {/* Type filter tabs */}
        <div style={s.typeTabs}>
          {TYPE_TABS.map(t => (
            <button key={t.key}
              style={typeTab === t.key ? { ...s.typeTab, ...s.typeTabActive } : s.typeTab}
              onClick={() => setTypeTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + Import + New */}
        <div style={s.topRight}>
          <input
            style={s.search}
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <button style={s.pdfImportBtn} onClick={() => setShowPdfImport(true)}>
            📄 Import from PDF
          </button>

          {activeType ? (
            <button style={s.newBtn} onClick={() => openCreate(activeType)}>
              ＋ New {TYPE_LABELS[activeType]}
            </button>
          ) : (
            <div style={{ position: 'relative' }}>
              <button style={s.newBtn} onClick={() => setPickerOpen(p => !p)}>
                ＋ New Entry ▾
              </button>
              {pickerOpen && (
                <div style={s.picker}>
                  {['item','spell','equipment','monster'].map(t => (
                    <button key={t} style={s.pickerBtn} onClick={() => openCreate(t)}>
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Body: list + card ── */}
      <div style={s.body}>
        <div style={s.list}>
          {loading ? (
            <p style={s.msg}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={s.msg}>
              {entries.length === 0
                ? `No custom ${typeTab === 'all' ? 'entries' : typeTab + 's'} yet — create one above.`
                : 'No entries match your search.'}
            </p>
          ) : (
            <>
              {filtered.map(entry => {
                const tc         = TYPE_COLORS[entry.type] ?? TYPE_COLORS.item
                const isSelected = selected?.id === entry.id
                const isPdf      = entry.source === 'pdf_upload'
                let   pdfData    = {}
                if (isPdf) { try { pdfData = JSON.parse(entry.data ?? '{}') } catch { /* empty */ } }
                const pdfTooltip = isPdf
                  ? `Imported from ${pdfData.source_book || 'PDF'}${pdfData.page ? ', p.' + pdfData.page : ''}`
                  : ''
                return (
                  <div
                    key={entry.id}
                    style={isSelected ? { ...s.row, ...s.rowSelected } : s.row}
                    onClick={() => setSelected(isSelected ? null : entry)}
                  >
                    <span style={{ ...s.typeBadge, background: tc.bg, border: `1px solid ${tc.border}`, color: tc.text }}>
                      {TYPE_LABELS[entry.type] ?? entry.type}
                    </span>
                    {isPdf && (
                      <span
                        style={s.pdfBadge}
                        title={pdfTooltip}
                      >
                        📄 PDF
                      </span>
                    )}
                    <span style={s.entryName}>{entry.name}</span>
                    <div style={s.rowActions} onClick={e => e.stopPropagation()}>
                      <button style={s.editBtn} title="Edit" onClick={() => openEdit(entry)}>✏</button>
                      <button style={s.delBtn}  title="Delete" onClick={() => setConfirmDelete(entry)}>🗑</button>
                    </div>
                  </div>
                )
              })}
              <p style={s.countLine}>
                {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
                {filtered.length !== entries.length && ` (${entries.length} total)`}
              </p>
            </>
          )}
        </div>

        {/* HomebrewCard panel for selected entry */}
        {selected && (
          <HomebrewCard
            entry={{ ...selected, data_raw: selected.data }}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {/* ── Create / Edit form modal ── */}
      {FormComponent && (
        <EntityModal
          title={editEntry ? `Edit: ${editEntry.name}` : `New ${TYPE_LABELS[modalType]}`}
          isOpen
          onClose={closeModal}
        >
          <FormComponent
            entry={editEntry}
            onSave={handleSave}
            onClose={closeModal}
          />
        </EntityModal>
      )}

      {/* ── Delete confirmation modal ── */}
      {confirmDelete && (
        <EntityModal
          title="Delete Entry"
          isOpen
          onClose={() => setConfirmDelete(null)}
        >
          <p style={s.confirmText}>
            Delete <strong style={{ color: '#c9a84c' }}>{confirmDelete.name}</strong>?
            This action cannot be undone.
          </p>
          <div style={s.confirmBtns}>
            <button style={s.cancelBtn} onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button style={s.deleteBtn} onClick={() => handleDelete(confirmDelete)}>Delete</button>
          </div>
        </EntityModal>
      )}

      {/* ── PDF Import Panel ── */}
      {showPdfImport && (
        <PdfImportPanel
          campaignId={activeCampaign?.id}
          onImportComplete={() => { setShowPdfImport(false); load() }}
          onClose={() => setShowPdfImport(false)}
        />
      )}
    </div>
  )
}

const s = {
  wrapper:      { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0.85rem 1.5rem' },

  topBar:       { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexShrink: 0, flexWrap: 'wrap' },
  typeTabs:     { display: 'flex', gap: '0.2rem' },
  typeTab:      { background: 'transparent', border: '1px solid transparent', borderRadius: 3, color: '#6b5a3a', padding: '0.28rem 0.65rem', cursor: 'pointer', fontSize: '0.82rem' },
  typeTabActive:{ background: '#1a1208', border: '1px solid #3a2a10', color: '#c9a84c' },
  topRight:     { display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: 'auto' },
  search:       { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.32rem 0.6rem', fontSize: '0.83rem', outline: 'none', width: 170 },
  newBtn:       { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', borderRadius: 3, padding: '0.32rem 0.7rem', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap' },
  pdfImportBtn: { background: '#0d1a2a', border: '1px solid #1a4a8a', color: '#4A90D9', borderRadius: 4, padding: '0.32rem 0.75rem', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.3rem' },
  pdfBadge:     { background: '#0d1a2a', border: '1px solid #1a3a6a', color: '#4A90D9', fontSize: '0.62rem', padding: '0.05rem 0.32rem', borderRadius: 10, fontWeight: 600, flexShrink: 0, cursor: 'help' },
  picker:       { position: 'absolute', top: '100%', right: 0, marginTop: 2, background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 4, zIndex: 100, display: 'flex', flexDirection: 'column', minWidth: 130, boxShadow: '0 4px 12px rgba(0,0,0,0.5)' },
  pickerBtn:    { background: 'transparent', border: 'none', borderBottom: '1px solid #2a1c08', color: '#e8e0d0', padding: '0.4rem 0.85rem', cursor: 'pointer', fontSize: '0.83rem', textAlign: 'left' },

  body:         { display: 'flex', flex: 1, gap: '1rem', overflow: 'hidden', minHeight: 0 },
  list:         { flex: 1, overflowY: 'auto', minWidth: 0 },

  row:          { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.38rem 0.6rem', borderBottom: '1px solid #1a1208', cursor: 'pointer', borderRadius: 3 },
  rowSelected:  { background: '#1a1208', outline: '1px solid #3a2a10' },
  typeBadge:    { fontSize: '0.65rem', padding: '0.08rem 0.35rem', borderRadius: 3, flexShrink: 0, fontWeight: 600 },
  entryName:    { color: '#e8e0d0', fontSize: '0.87rem', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowActions:   { display: 'flex', gap: '0.2rem', flexShrink: 0 },
  editBtn:      { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.82rem', padding: '0.1rem 0.3rem', lineHeight: 1 },
  delBtn:       { background: 'none', border: 'none', color: '#6b3a3a', cursor: 'pointer', fontSize: '0.82rem', padding: '0.1rem 0.3rem', lineHeight: 1 },
  countLine:    { color: '#6b5a3a', fontSize: '0.7rem', textAlign: 'center', padding: '0.5rem', marginTop: '0.2rem' },

  msg:          { color: '#6b5a3a', padding: '2.5rem', textAlign: 'center', fontSize: '0.88rem' },

  empty:        { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.5rem' },
  emptyIcon:    { fontSize: '3rem', margin: 0 },
  emptyTitle:   { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.1rem', margin: 0 },
  emptyText:    { color: '#6b5a3a', fontSize: '0.85rem', fontStyle: 'italic', margin: 0, textAlign: 'center', maxWidth: 320 },

  confirmText:  { color: '#e8e0d0', fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5 },
  confirmBtns:  { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' },
  cancelBtn:    { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem' },
  deleteBtn:    { background: '#3a0a0a', border: '1px solid #7a2a2a', color: '#da7a7a', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
}
