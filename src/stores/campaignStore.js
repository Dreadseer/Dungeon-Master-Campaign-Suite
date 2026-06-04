import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useCampaignStore = create(
  persist(
    (set) => ({
      campaigns:       [],
      activeCampaign:  null,

      setCampaigns:        (campaigns)  => set({ campaigns }),
      setActiveCampaign:   (campaign)   => set({ activeCampaign: campaign }),
      clearActiveCampaign: ()           => set({ activeCampaign: null }),
    }),
    {
      name: 'dmcs-active-campaign',
      partialize: (state) => ({
        activeCampaign: state.activeCampaign ? { id: state.activeCampaign.id } : null,
      }),
    }
  )
)

export default useCampaignStore
