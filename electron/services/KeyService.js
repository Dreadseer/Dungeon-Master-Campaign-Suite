const { app, safeStorage } = require('electron')
const path = require('path')
const fs   = require('fs')

class KeyService {
  constructor() {
    this.keyPath = path.join(app.getPath('userData'), 'dmcs.key')
  }

  saveKey(key) {
    const encrypted = safeStorage.encryptString(key)
    fs.writeFileSync(this.keyPath, encrypted)
  }

  loadKey() {
    if (!fs.existsSync(this.keyPath)) return null
    try {
      const buf = fs.readFileSync(this.keyPath)
      return safeStorage.decryptString(buf)
    } catch {
      return null
    }
  }

  deleteKey() {
    if (fs.existsSync(this.keyPath)) fs.unlinkSync(this.keyPath)
  }

  hasKey() {
    return fs.existsSync(this.keyPath)
  }
}

module.exports = KeyService
