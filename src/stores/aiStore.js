import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Chat history survives a restart (Phase 6 task 3).
//
// Before this the store was plain zustand, so closing the app threw the
// conversation away — there was no record of what the AI suggested last week
// even for manual re-entry. campaignStore has used `persist` since Phase 1, so
// this is the same middleware already bundled with zustand: no new dependency.
//
// History is kept PER CAMPAIGN. A single shared log would show a DM notes from
// a different world the moment they switched campaigns, which is worse than
// losing them. `history` and `input` stay top-level so components read them
// exactly as before; `archive` holds the other campaigns' logs, and setCampaign
// swaps the active slice in and out.

/** Cap what reaches disk — a long campaign should not grow localStorage without bound. */
export const MAX_PERSISTED_MESSAGES = 200

const CURSOR = '▋'

/** Strip what must never be restored: stream cursors, and failed requests. */
export function sanitiseHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter(m => m && !m.isError && m.role)
    .map(m => ({ ...m, content: String(m.content ?? '').split(CURSOR).join('') }))
    .filter(m => m.content.trim() !== '')
    .slice(-MAX_PERSISTED_MESSAGES)
}

const key = (id) => String(id ?? 'none')

const useAiStore = create(
  persist(
    (set) => ({
      history:     [],   // [{ role, content, sources?, isError?, noSourcesFound? }]
      input:       '',
      campaignId:  null,
      archive:     {},   // campaignId -> history for every campaign but the active one

      // Deliberately NOT persisted — see partialize. A stream cannot survive a
      // reload, and restoring isStreaming:true would leave the composer
      // permanently disabled with no way back.
      ragMode:     false,
      isStreaming: false,

      /**
       * Point the store at a campaign, filing the outgoing campaign's history
       * into the archive and restoring the incoming one's.
       */
      setCampaign: (campaignId) => set(s => {
        if (key(campaignId) === key(s.campaignId)) return {}
        const archive = { ...s.archive }
        if (s.campaignId != null) archive[key(s.campaignId)] = s.history
        const incoming = archive[key(campaignId)] ?? []
        delete archive[key(campaignId)]
        return { campaignId: campaignId ?? null, archive, history: incoming, input: '' }
      }),

      setHistory:     (fn)  => set(s => ({ history: typeof fn === 'function' ? fn(s.history) : fn })),
      setInput:       (v)   => set({ input: v }),
      setRagMode:     (v)   => set({ ragMode: v }),
      setIsStreaming: (v)   => set({ isStreaming: v }),
      clearHistory:   ()    => set({ history: [], isStreaming: false }),
    }),
    {
      name: 'dmcs-ai-chat',
      partialize: (s) => ({
        campaignId: s.campaignId,
        history:    sanitiseHistory(s.history),
        archive:    Object.fromEntries(
          Object.entries(s.archive ?? {}).map(([k, v]) => [k, sanitiseHistory(v)]),
        ),
      }),
    },
  ),
)

export default useAiStore
