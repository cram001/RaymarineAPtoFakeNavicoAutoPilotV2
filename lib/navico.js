'use strict'

const MODE_65340 = {
  standby: [0x41, 0x9f, 0x00, 0x00, 0xfe, 0xf8, 0x00, 0x80],
  headinghold: [0x41, 0x9f, 0x10, 0x01, 0xfe, 0xfa, 0x00, 0x80],
  wind: [0x41, 0x9f, 0x10, 0x03, 0xfe, 0xfa, 0x00, 0x80],
  navigation: [0x41, 0x9f, 0x10, 0x06, 0xfe, 0xf8, 0x00, 0x80]
}

const MODE_65302 = {
  standby: [0x41, 0x9f, 0x0a, 0x6b, 0x00, 0x00, 0x00, 0xff],
  headinghold: [0x41, 0x9f, 0x0a, 0x69, 0x00, 0x00, 0x28, 0xff],
  wind: [0x41, 0x9f, 0x0a, 0x69, 0x00, 0x00, 0x30, 0xff],
  navigation: [0x41, 0x9f, 0x0a, 0x6b, 0x00, 0x00, 0x28, 0xff]
}

function raw(pgn, data, prio = 7, dst = 255) {
  return { pgn, prio, dst, data: Buffer.from(data) }
}

function modeFrames(mode) {
  const m = MODE_65340[mode] ? mode : 'standby'
  return [raw(65340, MODE_65340[m], 3), raw(65302, MODE_65302[m], 7)]
}

function stateFrames(mode, engaged, modeChanged) {
  const frames = []
  if (modeChanged) {
    frames.push(raw(65305, [0x41, 0x9f, 0x00, 0x1d, 0x81, 0x00, 0x00, 0x00]))
    frames.push(raw(65305, [0x41, 0x9f, 0x00, 0x1d, 0x80, 0x00, 0x00, 0x00]))
  }

  const map = engaged
    ? {
        headinghold: [0x41, 0x9f, 0x00, 0x0a, 0x16, 0x00, 0x00, 0x00],
        wind: [0x41, 0x9f, 0x00, 0x0a, 0x06, 0x04, 0x00, 0x00],
        navigation: [0x41, 0x9f, 0x00, 0x0a, 0xf0, 0x00, 0x80, 0x00]
      }
    : {
        headinghold: [0x41, 0x9f, 0x00, 0x02, 0x02, 0x00, 0x00, 0x00],
        wind: [0x41, 0x9f, 0x00, 0x0a, 0x1e, 0x00, 0x00, 0x00],
        navigation: [0x41, 0x9f, 0x00, 0x02, 0x10, 0x00, 0x00, 0x00]
      }
  frames.push(raw(65305, map[mode] || map.headinghold))
  return frames
}

function periodic65341() {
  return [
    raw(65341, [0x41, 0x9f, 0xff, 0xff, 0x0b, 0xff, 0x00, 0x00], 6),
    raw(65341, [0x41, 0x9f, 0xff, 0xff, 0x0c, 0xff, 0xff, 0xff], 6),
    raw(65341, [0x41, 0x9f, 0xff, 0xff, 0x02, 0xff, 0xff, 0xff], 6)
  ]
}

function targetWindFrame(angleDeg) {
  if (!Number.isFinite(angleDeg)) return undefined
  const value = Math.trunc((angleDeg * Math.PI / 180) * 10000) & 0xffff
  return raw(65341, [0x41, 0x9f, 0xff, 0xff, 0x03, 0xff, value & 0xff, (value >> 8) & 0xff], 6)
}

function trueHeadingFrame(deg) {
  if (!Number.isFinite(deg)) return undefined
  const value = Math.trunc((deg * Math.PI / 180) * 10000) & 0xffff
  return raw(127250, [0x00, value & 0xff, (value >> 8) & 0xff, 0xff, 0x7f, 0xff, 0x7f, 0xfd], 3)
}

function rudderFrame(sourceData) {
  if (!Buffer.isBuffer(sourceData) || sourceData.length < 8) return undefined
  const d = Buffer.from(sourceData.subarray(0, 8))
  d[1] = 0xff
  d[3] = d[5]
  return raw(127245, d, 2)
}

function decodeCommand(data) {
  if (!Buffer.isBuffer(data)) return undefined
  const hex = data.toString('hex')
  const has = (s) => hex.includes(s.replaceAll(',', '').toLowerCase())
  if (has('1a0002ae00')) return { type: 'key', value: '-1' }
  if (has('1a0003ae00')) return { type: 'key', value: '+1' }
  if (has('1a0002d106')) return { type: 'key', value: '-10' }
  if (has('1a0003d106')) return { type: 'key', value: '+10' }
  if (has('1a00025b3d')) return { type: 'key', value: 'tackPort' }
  if (has('1a00035b3d')) return { type: 'key', value: 'tackStarboard' }
  if (has('0600ffffff')) return { type: 'state', value: 'standby' }
  if (has('0a00ffffff')) return { type: 'state', value: 'navigation' }
  if (has('0f00ffffff')) return { type: 'state', value: 'wind' }
  if (has('0900ffffff')) return { type: 'state', value: 'headinghold' }
  return undefined
}

function reply130851(requestData) {
  if (!Buffer.isBuffer(requestData) || requestData.length === 0) return undefined
  return raw(130851, requestData, 7)
}

module.exports = {
  raw,
  modeFrames,
  stateFrames,
  periodic65341,
  targetWindFrame,
  trueHeadingFrame,
  rudderFrame,
  decodeCommand,
  reply130851
}
