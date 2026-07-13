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
