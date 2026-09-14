const { app, safeStorage } = require('electron')
const path = require('path')
const fs   = require('fs')

class KeyService {
  constructor() {
    this.dataPath = app.getPath('userData')
    this.keyPath  = path.join(this.dataPath, 'dmcs.key')
  }

  saveKey(key) {
    const encrypted = safeStorage.encryptString(key)
    fs.writeFileSync(this.keyPath, encrypted)
  }

  /**
   * Read the key, and say what happened.
   *
   * The Phase 6.1 root cause: loadKey() returned null both when there was no
   * key AND when there was one that would not decrypt, while hasKey() reported
   * a key because the FILE existed. The app showed a saved key and behaved as
   * though it had none, with nothing anywhere explaining the contradiction.
   *
   * A stored blob stops decrypting when the OS crypto key changes underneath it
   * — a Windows credential change, a different user account, a restored
   * profile. The key is not recoverable and has to be re-entered. Saying so is
   * the entire point of this method.
   *
   * @returns {{ key: string|null, error: string|null, present: boolean }}
   */
  readKey() {
    if (!fs.existsSync(this.keyPath)) {
      return { key: null, error: null, present: false }
    }
    try {
      return {
        key: safeStorage.decryptString(fs.readFileSync(this.keyPath)),
        error: null,
        present: true,
      }
    } catch (err) {
      return {
        key: null,
        present: true,
        error: `${err?.message ?? 'decryption failed'} The stored key can no longer be read on this machine or user account.`,
      }
    }
  }

  loadKey() {
    return this.readKey().key
  }

  deleteKey() {
    if (fs.existsSync(this.keyPath)) fs.unlinkSync(this.keyPath)
  }

  hasKey() {
    return fs.existsSync(this.keyPath)
  }

  saveNgrokToken(token) {
    const encrypted = safeStorage.encryptString(token)
    fs.writeFileSync(path.join(this.dataPath, 'ngrok.key'), encrypted)
  }

  loadNgrokToken() {
    const keyFile = path.join(this.dataPath, 'ngrok.key')
    if (!fs.existsSync(keyFile)) return null
    try {
      return safeStorage.decryptString(fs.readFileSync(keyFile))
    } catch {
      return null
    }
  }

  hasNgrokToken() {
    return fs.existsSync(path.join(this.dataPath, 'ngrok.key'))
  }

  deleteNgrokToken() {
    const keyFile = path.join(this.dataPath, 'ngrok.key')
    if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile)
  }
}

module.exports = KeyService
