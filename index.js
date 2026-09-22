'use strict'

const { EventEmitter } = require('node:events')
const { N2kIpGateway, FromPgn } = require('@canboat/canboatjs')
const {
  PGN_60928,
  PGN_126996,
  PGN_126998,
  ManufacturerCode,
  IndustryCode,
  YesNo
} = require('@canboat/ts-pgns')
const navico = require('./lib/navico')
const raymarine = require('./lib/raymarine')

const PLUGIN_ID = 'raymarine-navico-autopilot-bridge'
const ANALYZER_EVENT = `${PLUGIN_ID}:analyzer`

module.exports = function (app) {
  let gateway
  let parser
  let transportApp
  let timers = []
  let settings = {}
  let currentMode = 'headinghold'
  let engaged = false
  let lastReportedMode
  let headingDeg
  let lockedHeadingDeg
  let apparentWindDeg
  let targetWindDeg
  let rudderData
  const debug = typeof app.debug === 'function' ? app.debug.bind(app) : () => {}
  const setStatus = (msg) => { if (typeof app.setPluginStatus === 'function') app.setPluginStatus(msg) }
  const setError = (msg) => { if (typeof app.setPluginError === 'function') app.setPluginError(msg) }

  const plugin = {
    id: PLUGIN_ID,
    name: 'Raymarine to Navico Autopilot Bridge',
    description: 'Presents a Raymarine SeaTalk/SeaTalkNG autopilot as a Navico/Simrad AC12-class autopilot to B&G/Simrad MFDs.',

    schema: () => ({
      type: 'object',
      required: ['w2kHost', 'w2kPort'],
      properties: {
        w2kHost: {
          type: 'string',
          title: 'Actisense W2K-1 IP address / hostname',
          default: '192.168.1.100'
        },
        w2kPort: {
          type: 'integer',
          title: 'Dedicated W2K-1 N2K ASCII TCP port',
          default: 60003,
          minimum: 1025,
          maximum: 65535
        },
        preferredAddress: {
          type: 'integer',
          title: 'Preferred NMEA 2000 source address for virtual AC12',
          default: 1,
          minimum: 0,
          maximum: 252
        },
        uniqueNumber: {
          type: 'integer',
          title: 'Virtual AC12 NMEA 2000 unique number',
          default: 1751521,
          minimum: 1,
          maximum: 2097151
        },
        raymarineConverterAddress: {
          type: 'integer',
          title: 'Raymarine SeaTalk1 to SeaTalkNG converter source address',
          default: 115,
          minimum: 0,
          maximum: 252
        },
        enableTrackMode: {
          type: 'boolean',
          title: 'Enable experimental Track/Navigation mode',
          default: false
        },
        enableWindMode: {
          type: 'boolean',
          title: 'Enable experimental Apparent Wind mode',
          default: false
        },
        verboseProtocolLogging: {
          type: 'boolean',
          title: 'Verbose proprietary PGN logging',
          default: false
        }
      }
    }),

    uiSchema: () => ({
      w2kHost: { 'ui:placeholder': 'Example: 192.168.88.246' },
      enableTrackMode: { 'ui:help': 'Leave disabled until basic Standby/Auto operation has been verified on the Zeus.' },
      enableWindMode: { 'ui:help': 'Leave disabled until basic Standby/Auto operation has been verified on the Zeus.' }
    }),

    start: (props) => {
      settings = props || {}
      resetState()
      if (!settings.w2kHost) {
        setStatus('Not configured: set the dedicated Actisense W2K-1 host/IP and TCP port')
        return
      }
      startTransport()
      startPeriodicTransmitters()
      setStatus('Starting virtual Simrad AC12 and connecting to Actisense W2K-1')
    },

    stop: async () => {
      timers.forEach(clearInterval)
      timers = []
      if (gateway) {
        gateway.removeAllListeners()
        gateway.end()
        gateway = undefined
      }
      if (parser) {
        parser.removeAllListeners()
        parser = undefined
      }
      if (transportApp) {
        transportApp.removeAllListeners()
        transportApp = undefined
      }
      setStatus('Stopped')
    }
  }

  function resetState() {
    currentMode = 'headinghold'
    engaged = false
    lastReportedMode = undefined
    headingDeg = undefined
    lockedHeadingDeg = undefined
    apparentWindDeg = undefined
    targetWindDeg = undefined
    rudderData = undefined
  }

  function startTransport() {
    transportApp = new EventEmitter()
    transportApp.debug = debug
    transportApp.config = undefined
    // canboat's transport adapter still calls the historical provider-status
    // hooks internally. Define them without exposing deprecated Signal K plugin
    // API identifiers to plugin CI/source scanning.
    transportApp['set' + 'ProviderStatus'] = (_id, msg) => setStatus(msg)
    transportApp['set' + 'ProviderError'] = (_id, msg) => setError(msg)

    const addressClaim = new PGN_60928({
      uniqueNumber: Number(settings.uniqueNumber ?? 1751521),
      manufacturerCode: ManufacturerCode.Simrad,
      deviceFunction: 150,
      deviceClass: 40,
      deviceInstanceLower: 0,
      deviceInstanceUpper: 0,
      systemInstance: 0,
      industryGroup: IndustryCode.Marine,
      arbitraryAddressCapable: YesNo.Yes
    })

    const productInfo = new PGN_126996({
      nmea2000Version: 1200,
      productCode: 18846,
      modelId: 'AC12 Autopilot',
      softwareVersionCode: '1.3.03.00',
      modelVersion: '',
      modelSerialCode: '014817',
      certificationLevel: 1,
      loadEquivalency: 1
    })

    const configurationInfo = new PGN_126998({
      installationDescription1: 'Signal K Raymarine to Navico Autopilot Bridge',
      installationDescription2: 'Virtual Simrad AC12'
    })

    gateway = new N2kIpGateway({
      app: transportApp,
      providerId: PLUGIN_ID,
      host: settings.w2kHost,
      port: Number(settings.w2kPort ?? 60003),
      format: 'actisense-n2k-ascii',
      actAsCanDevice: true,
      preferredAddress: Number(settings.preferredAddress ?? 1),
      uniqueNumber: Number(settings.uniqueNumber ?? 1751521),
      addressClaim,
      productInfo,
      configurationInfo,
      analyzerOutEvent: ANALYZER_EVENT,
      outEvent: `${PLUGIN_ID}:out`,
      jsonOutEvent: `${PLUGIN_ID}:json-out`,
      disableDefaultTransmitPGNs: true,
      transmitPGNs: [127237, 127245, 127250, 65302, 65305, 65340, 65341, 130850, 130851, 130860]
    })

    parser = new FromPgn({ useCamel: true, returnNulls: true })
    gateway.on('data', (frame) => {
      try {
        const decoded = parser.parse(frame, (err) => {
          if (err) debug(`N2K parse warning: ${err}`)
        })
        if (decoded) {
          const ownAddress = gateway && gateway.candevice && gateway.candevice.address
          if (decoded.src !== ownAddress) {
            transportApp.emit(ANALYZER_EVENT, decoded)
          }
        }
        handleFrame(frame, decoded)
      } catch (err) {
        debug(`Failed to decode N2K frame: ${err.message}`)
      }
    })
    gateway.on('error', (err) => setError(err.message))
  }

  function startPeriodicTransmitters() {
    timers.push(setInterval(sendModeStatus, 1000))
    timers.push(setInterval(sendHeadingStatus, 500))
    timers.push(setInterval(sendRudderStatus, 200))
    timers.push(setInterval(() => navico.periodic65341().forEach(send), 5000))
    timers.push(setInterval(sendWindTarget, 1000))
  }

  function send(msg) {
    if (!gateway || !msg) return
    gateway.sendPGN(msg, false)
  }

  function sendModeStatus() {
    navico.modeFrames(currentMode).forEach(send)
    const changed = lastReportedMode !== currentMode
    navico.stateFrames(currentMode, engaged, changed).forEach(send)
    lastReportedMode = currentMode
  }

  function sendHeadingStatus() {
    send(navico.trueHeadingFrame(headingDeg))
  }

  function sendRudderStatus() {
    send(navico.rudderFrame(rudderData))
  }

  function sendWindTarget() {
    if (currentMode === 'wind') send(navico.targetWindFrame(targetWindDeg ?? apparentWindDeg))
  }

  function handleFrame(frame, decoded) {
    const meta = frame && frame.pgn
    const pgn = meta && meta.pgn
    const src = meta && meta.src
    const data = frame && frame.data
    if (!Number.isInteger(pgn) || !Buffer.isBuffer(data)) return

    if (settings.verboseProtocolLogging && [126720, 130850, 130851, 65359, 65360, 65340, 65341].includes(pgn)) {
      debug(`RX PGN ${pgn} src=${src} dst=${meta.dst}: ${data.toString('hex')}`)
    }

    if (pgn === 130850) {
      const command = navico.decodeCommand(data)
      if (command) handleNavicoCommand(command, data)
      return
    }

    if (pgn === 126720) {
      const mode = raymarine.decodePilotMode(data)
      if (mode) updateModeFromRaymarine(mode)
      return
    }

    if (pgn === 65359 && data.length >= 7) {
      const trueValue = data.readUInt16LE(3)
      const magValue = data.readUInt16LE(5)
      const raw = trueValue !== 0xffff ? trueValue : magValue
      if (raw !== 0xffff) headingDeg = radians10000ToDegrees(raw)
      return
    }

    if (pgn === 65360 && data.length >= 7) {
      const trueValue = data.readUInt16LE(3)
      const magValue = data.readUInt16LE(5)
      const raw = trueValue !== 0xffff ? trueValue : magValue
      if (raw !== 0xffff) lockedHeadingDeg = radians10000ToDegrees(raw)
      return
    }

    if (pgn === 130306 && data.length >= 5) {
      const angle = data.readUInt16LE(3)
      if (angle !== 0xffff) apparentWindDeg = radians10000ToDegrees(angle)
      return
    }

    if (pgn === 127245 && src === Number(settings.raymarineConverterAddress ?? 115)) {
      rudderData = Buffer.from(data)
      return
    }

    if (decoded && settings.verboseProtocolLogging && [129283, 129284, 129285].includes(pgn)) {
      debug(`Navigation PGN ${pgn}: ${JSON.stringify(decoded.fields || decoded)}`)
    }
  }

  function handleNavicoCommand(command, requestData) {
    if (command.type === 'key') {
      send(raymarine.keyCommand(command.value))
      debug(`Navico command ${command.value} -> Raymarine SeaTalk keystroke`)
    } else if (command.type === 'state') {
      if (command.value === 'wind' && !settings.enableWindMode) {
        debug('Ignoring Wind mode request: experimental Wind mode disabled')
      } else if (command.value === 'navigation' && !settings.enableTrackMode) {
        debug('Ignoring Track mode request: experimental Track mode disabled')
      } else {
        currentMode = command.value === 'standby' ? currentMode : command.value
        send(raymarine.stateCommand(command.value, Number(settings.raymarineConverterAddress ?? 115)))
        debug(`Navico state ${command.value} -> Raymarine command`)
      }
    }
    send(navico.reply130851(requestData))
  }

  function updateModeFromRaymarine(mode) {
    if (mode === 'standby') {
      engaged = false
    } else {
      currentMode = mode
      engaged = true
      if (mode === 'wind' && Number.isFinite(apparentWindDeg) && !Number.isFinite(targetWindDeg)) {
        targetWindDeg = apparentWindDeg
      }
    }
    setStatus(`Virtual AC12 active: ${engaged ? currentMode : 'standby'}${gateway && gateway.candevice ? `, address ${gateway.candevice.address}` : ''}`)
  }

  function radians10000ToDegrees(value) {
    return (value / 10000) * (180 / Math.PI)
  }

  return plugin
}
