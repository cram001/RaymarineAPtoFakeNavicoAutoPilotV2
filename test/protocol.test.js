'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const navico = require('../lib/navico')
const raymarine = require('../lib/raymarine')

test('decodes Navico heading adjustment commands', () => {
  assert.deepEqual(navico.decodeCommand(Buffer.from('419f01ffff011a0003ae00', 'hex')), { type: 'key', value: '+1' })
  assert.deepEqual(navico.decodeCommand(Buffer.from('419f01ffff011a0002d106', 'hex')), { type: 'key', value: '-10' })
})

test('decodes Navico state commands', () => {
  assert.deepEqual(navico.decodeCommand(Buffer.from('419f01ffff010f00ffffff', 'hex')), { type: 'state', value: 'wind' })
  assert.deepEqual(navico.decodeCommand(Buffer.from('419f01ffff010a00ffffff', 'hex')), { type: 'state', value: 'navigation' })
})

test('builds Raymarine key payload', () => {
  const msg = raymarine.keyCommand('+10')
  assert.equal(msg.pgn, 126720)
  assert.equal(msg.dst, 255)
  assert.equal(msg.data.includes(Buffer.from([0x08, 0xf7])), true)
})

test('decodes Raymarine mode report without fast-packet length byte', () => {
  const data = Buffer.from([0x3b, 0x9f, 0xf0, 0x81, 0x84, 0x00, 0x00, 0x00, 0x46, 0x00])
  assert.equal(raymarine.decodePilotMode(data), 'wind')
})
