import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isProtocolFrame, parseProtocolFrame, ProtocolValidationError } from '../dist/src/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function vector(directory, name) {
  return JSON.parse(await readFile(join(root, 'test-vectors', directory, name), 'utf8'))
}

const validVectors = [
  ['pc-challenge.json', 'pc.challenge'],
  ['event-ack.json', 'event.ack'],
  ['session-event.json', 'session.event'],
  ['command-submit.json', 'command.submit'],
  ['client-hello.json', 'client.hello'],
]

for (const [name, kind] of validVectors) {
  const frame = await vector('valid', name)
  assert.equal(isProtocolFrame(frame), true, `${name} should be valid`)
  assert.equal(parseProtocolFrame(frame).kind, kind)
}

const invalidVectors = ['unknown-kind.json', 'command-without-id.json', 'event-ack-without-frame-id.json']

for (const name of invalidVectors) {
  const frame = await vector('invalid', name)
  assert.equal(isProtocolFrame(frame), false, `${name} should be invalid`)
  assert.throws(() => parseProtocolFrame(frame), ProtocolValidationError)
}

const unknownEvent = await vector('valid', 'session-event.json')
assert.equal(parseProtocolFrame(unknownEvent).payload.event.futureMetadata, 'must survive')

console.log(`Protocol vectors verified: ${validVectors.length} valid, ${invalidVectors.length} invalid`)
