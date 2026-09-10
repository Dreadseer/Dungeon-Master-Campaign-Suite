import { create } from 'zustand'
import { friendlyIpcError } from '../utils/ipcError'

// Toast queue. Deliberately not persisted — a toast that survives a reload is a
// bug, not a feature.
//
// Read the queue with `useToastStore(s => s.toasts)`; push from anywhere,
// including outside React, via the exported helpers at the bottom.

let nextId = 1
const DEFAULT_MS = { error: 8000, success: 3000, info: 4000 }

const useToastStore = create((set, get) => ({
  toasts: [],

  push: ({ kind = 'info', message, detail = null, duration }) => {
    const id = nextId++
    const ms = duration ?? DEFAULT_MS[kind] ?? DEFAULT_MS.info
    set(s => ({ toasts: [...s.toasts, { id, kind, message, detail, createdAt: Date.now() }] }))
    if (ms > 0) setTimeout(() => get().dismiss(id), ms)
    return id
  },

  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────
// These are plain functions rather than hooks so they can be called from inside
// a catch block in a non-component function.

/**
 * Surface a failed operation. Pass the caught error and, optionally, what the
 * user was trying to do ("Delete location") so the toast reads as a sentence
 * rather than a bare database message.
 *
 * Always logs the raw error to the console as well — the toast is for the user,
 * the console is for whoever is debugging.
 */
export function notifyError(err, action = null) {
  const { message, detail, channel } = describe(err)
  console.error('[dmcs]', action ?? 'operation failed', channel ? `(${channel})` : '', err)
  return useToastStore.getState().push({
    kind: 'error',
    message: action ? `${action} failed. ${message}` : message,
    detail,
  })
}

export function notifySuccess(message) {
  return useToastStore.getState().push({ kind: 'success', message })
}

export function notifyInfo(message) {
  return useToastStore.getState().push({ kind: 'info', message })
}

function describe(err) {
  const parsed = friendlyIpcError(err)
  return { message: parsed.message, detail: parsed.technical, channel: parsed.channel }
}

export default useToastStore
