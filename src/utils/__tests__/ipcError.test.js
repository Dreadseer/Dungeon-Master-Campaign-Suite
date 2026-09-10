import { describe, it, expect } from 'vitest'
import { parseIpcError, friendlyIpcError } from '../ipcError.js'

// The exact shape Electron produces when a wrapped main-process handler throws:
// its own prefix, then the stringified Error, then registerHandler's channel tag.
const asElectronSees = (channel, message) =>
  new Error(`Error invoking remote method '${channel}': Error: ${message} [${channel}]`)

describe('parseIpcError — unwrapping a real IPC rejection', () => {
  it('strips the remote prefix, the Error: prefix and the channel tag', () => {
    const parsed = parseIpcError(asElectronSees('db:locations:delete', 'FOREIGN KEY constraint failed'))
    expect(parsed.message).toBe('FOREIGN KEY constraint failed')
    expect(parsed.channel).toBe('db:locations:delete')
  })

  it('recovers the channel from the prefix even when the tag is absent', () => {
    const err = new Error("Error invoking remote method 'ai:ragQuery': Error: Ollama is not running")
    const parsed = parseIpcError(err)
    expect(parsed.message).toBe('Ollama is not running')
    expect(parsed.channel).toBe('ai:ragQuery')
  })

  it('recovers the channel from the tag alone', () => {
    const parsed = parseIpcError(new Error('Disk full [embed:source]'))
    expect(parsed.message).toBe('Disk full')
    expect(parsed.channel).toBe('embed:source')
  })

  it('handles channel names containing dots and dashes', () => {
    const parsed = parseIpcError(new Error("Error invoking remote method 'server:ngrok:saveToken': Error: nope"))
    expect(parsed.channel).toBe('server:ngrok:saveToken')
  })

  it('collapses stacked Error: prefixes', () => {
    const parsed = parseIpcError(new Error('Error: Error: Error: deeply nested'))
    expect(parsed.message).toBe('deeply nested')
  })
})

describe('parseIpcError — inputs that are not IPC rejections', () => {
  it('passes an ordinary Error through untouched', () => {
    const parsed = parseIpcError(new Error('Location name is required.'))
    expect(parsed.message).toBe('Location name is required.')
    expect(parsed.channel).toBeNull()
  })

  it('accepts a bare string', () => {
    expect(parseIpcError('something broke').message).toBe('something broke')
  })

  it('accepts an object that merely has a message', () => {
    expect(parseIpcError({ message: 'from a rejected object' }).message).toBe('from a rejected object')
  })

  it('falls back rather than showing "undefined" for a valueless rejection', () => {
    for (const value of [undefined, null, 0, {}, []]) {
      expect(parseIpcError(value).message).toBe('Something went wrong.')
    }
  })

  it('falls back for an Error with an empty message', () => {
    expect(parseIpcError(new Error('')).message).toBe('Something went wrong.')
  })

  it('keeps the original value on `raw` for logging', () => {
    const err = new Error('x')
    expect(parseIpcError(err).raw).toBe(err)
  })

  it('does not mistake square brackets in prose for a channel tag', () => {
    // A tag is a channel-shaped token at the very end; "[3]" is not one.
    const parsed = parseIpcError(new Error('Chunk [3] could not be parsed'))
    expect(parsed.message).toBe('Chunk [3] could not be parsed')
    expect(parsed.channel).toBeNull()
  })
})

describe('friendlyIpcError — rewriting the messages users actually hit', () => {
  it('rewrites a foreign key failure as an instruction', () => {
    const result = friendlyIpcError(asElectronSees('db:locations:delete', 'FOREIGN KEY constraint failed'))
    expect(result.message).toBe('Something else still refers to this. Remove or reassign it first.')
    expect(result.channel).toBe('db:locations:delete')
  })

  it('keeps the raw database message available as `technical`', () => {
    const result = friendlyIpcError(asElectronSees('db:locations:delete', 'FOREIGN KEY constraint failed'))
    expect(result.technical).toBe('FOREIGN KEY constraint failed')
  })

  it('names the missing column in a NOT NULL failure', () => {
    const result = friendlyIpcError(new Error('NOT NULL constraint failed: npcs.character_name'))
    expect(result.message).toBe('"character name" is required.')
  })

  it('rewrites unique, check, busy, missing-file and permission failures', () => {
    const cases = [
      ['UNIQUE constraint failed: campaigns.name', 'That name is already taken. Try a different one.'],
      ['CHECK constraint failed: status', 'That value is not one this field accepts.'],
      ['database is locked', 'The database is busy. Try again in a moment.'],
      ['ENOENT: no such file or directory', 'That file is missing — it may have been moved or deleted.'],
      ['EACCES: permission denied', 'Permission denied. Check the file is not open in another program.'],
    ]
    for (const [raw, expected] of cases) {
      expect(friendlyIpcError(new Error(raw)).message).toBe(expected)
    }
  })

  it('leaves an unrecognised message verbatim rather than flattening it', () => {
    const result = friendlyIpcError(asElectronSees('pdf:ingest', 'Page 12 is not extractable text'))
    expect(result.message).toBe('Page 12 is not extractable text')
    expect(result.technical).toBeNull()
  })

  it('a deliberate, user-facing handler message survives intact', () => {
    const result = friendlyIpcError(asElectronSees('db:locations:update', 'A location cannot be its own ancestor.'))
    expect(result.message).toBe('A location cannot be its own ancestor.')
  })
})
