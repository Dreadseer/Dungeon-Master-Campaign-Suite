import { create } from 'zustand'

const useAiStore = create((set) => ({
  history:     [],   // [{ role, content, sources?, isError?, noSourcesFound? }]
  input:       '',
  ragMode:     false,
  isStreaming: false,

  setHistory:     (fn)  => set(s => ({ history:     typeof fn === 'function' ? fn(s.history)     : fn })),
  setInput:       (v)   => set({ input: v }),
  setRagMode:     (v)   => set({ ragMode: v }),
  setIsStreaming: (v)   => set({ isStreaming: v }),
  clearHistory:   ()    => set({ history: [], isStreaming: false }),
}))

export default useAiStore
