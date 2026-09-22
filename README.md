# Raymarine to Navico Autopilot Bridge for Signal K

This project presents a legacy Raymarine SeaTalk/SeaTalkNG autopilot to a B&G/Simrad/Navico MFD as a virtual Simrad AC12-class autopilot.

The target installation is:

- Raymarine S1/S2/S2G-class course computer on SeaTalk1
- Raymarine p70/p70s control head
- Raymarine SeaTalk1-to-SeaTalkNG converter with current firmware
- B&G/Simrad Zeus-family MFD on the same NMEA 2000 backbone
- Signal K Server on Linux/Raspberry Pi
- Actisense W2K-1 providing NMEA 2000 over Wi-Fi/Ethernet TCP

The plugin does **not** replace the Raymarine course computer. The Raymarine pilot remains responsible for steering the vessel. The plugin translates between the Navico control protocol expected by the Zeus and the Raymarine SeaTalk protocol transported over NMEA 2000 by the Raymarine converter.

## Current development status

Branch `modern-signalk-plugin` is the modern replacement for the original standalone `emulate.js` application.

Implemented in the first modern pass:

- Current Signal K plugin lifecycle and Admin UI configuration schema
- Current `@canboat/canboatjs` and `@canboat/ts-pgns` dependencies; the old embedded canboatjs v1.8 tree is no longer used by the plugin
- Dedicated Actisense W2K-1 TCP connection using **N2K ASCII**
- Independent NMEA 2000 address claim for the virtual Simrad AC12
- AC12 product/configuration information responses through current canboatjs device handling
- Navico periodic mode/state frames derived from the original project
- Raymarine Standby / Auto (heading hold) translation
- Navico `+1`, `-1`, `+10`, `-10` to Raymarine SeaTalk keystrokes
- Raymarine pilot mode monitoring
- Raymarine heading and rudder data mirrored into Navico-facing status frames
- Experimental Track and Apparent Wind command paths behind disabled-by-default feature switches
- Protocol unit tests

Still under development / vessel testing:

- Full Navico commissioning response table (PGN 130845)
- Complete PGN 127237 heading/track status generation
- Verified Zeus S Track-mode workflow
- Verified Zeus S Apparent Wind workflow and wind-angle adjustment
- Tack commands from the Zeus
- Automatic discovery of the Raymarine converter source address
- Alarm translation and edge cases

**Do not enable Track or Wind until basic Zeus discovery, Standby, Auto, and heading adjustments have been verified at the dock.**

---

# Why the plugin uses a dedicated W2K-1 data server

A normal Signal K NMEA 2000 connection represents the Signal K gateway itself. This plugin must instead appear on the NMEA 2000 network as a *second, independent device* with its own NMEA 2000 NAME, address claim, product information, source address, and directed traffic.

The Actisense W2K-1 supports three concurrently operating data servers. One server can remain dedicated to the normal Signal K NMEA 2000 connection and another can be dedicated to this virtual autopilot.

For this plugin, configure the dedicated server as **N2K ASCII**, not NMEA 0183. N2K ASCII carries complete NMEA 2000 PGNs in both directions and leaves fast-packet assembly to the W2K-1/canboat stack. This is simpler and less error-prone than manually handling raw CAN fast packets in the plugin while still preserving source/destination addressing.

The current W2K-1 manual states that the three data servers can be enabled independently and configured for protocol, format, direction, and port. It also states that N2K ASCII can be transmitted and received by the W2K-1. Default server ports are 60001, 60002 and 60003.

Actisense reference: `https://actisense.com/acti_downloads/w2k-1-user-manual/`

---

# Actisense W2K-1 setup

## 1. Do not change the existing Signal K server until you identify it

Open the W2K-1 web interface and go to:

**Settings → Data Server Settings**

The W2K-1 has Server 1, Server 2 and Server 3. Determine which server/port your normal Signal K NMEA 2000 connection currently uses.

Do **not** change that server.

For example, if Signal K currently connects to Server 1 / port 60001, leave Server 1 exactly as it is and use Server 3 for this plugin.

## 2. Configure one unused server for the virtual autopilot

Recommended configuration:

| W2K-1 setting | Value |
|---|---|
| Server | Any currently unused server, normally Server 3 |
| Enabled | Yes |
| Protocol | **TCP** |
| Format | **N2K ASCII** |
| Direction | **Both** (Transmit + Receive) |
| Port | **60003** if Server 3 is unused; otherwise another unused port >1024 |

TCP is preferred because Actisense recommends it and because the plugin requires bidirectional traffic. The W2K-1 manual notes that UDP receive is not supported in the same way; do not use UDP for this plugin.

## 3. Filtering

For initial commissioning, **do not filter the dedicated plugin server**. The emulator must see ISO requests, address claims, Navico proprietary PGNs, Raymarine proprietary PGNs, heading, rudder, wind and navigation PGNs.

After the system is proven, filtering can be investigated if bus/network traffic needs to be reduced. Do not enable filtering during initial testing.

## 4. Record the W2K-1 client-mode IP address

Use the W2K-1 address reachable from the Raspberry Pi running Signal K. Prefer a DHCP reservation/static address so it does not change.

Example only:

```text
W2K-1 address: 192.168.88.246
Virtual AP TCP port: 60003
```

Do not assume the example address matches your installation.

## 5. Verify the port before enabling the plugin

From the Raspberry Pi:

```bash
nc -vz <W2K-IP> 60003
```

A successful TCP connection confirms that the W2K server is reachable. It does not by itself prove the format/direction settings are correct.

You can also temporarily observe N2K ASCII text with:

```bash
nc <W2K-IP> 60003
```

Press `Ctrl-C` to exit. Do not type arbitrary data into this session; the server is configured for bidirectional NMEA 2000 traffic.

---

# Installing the Signal K plugin from this development branch

The plugin is not yet published in the Signal K App Store. During development, install it by linking a local checkout.

## 1. Clone the repository

```bash
cd ~
git clone https://github.com/cram001/RaymarineAPtoFakeNavicoAutoPilotV2.git
cd RaymarineAPtoFakeNavicoAutoPilotV2
git checkout modern-signalk-plugin
```

## 2. Install dependencies

```bash
npm install
```

The modern plugin uses the published current canboat packages. It does not use the old `canboatjs/` directory retained in the repository for legacy/reference purposes.

## 3. Run the unit tests

```bash
npm test
npm run check
```

Both should complete without errors before linking the plugin into Signal K.

## 4. Link the plugin

From the repository directory:

```bash
sudo npm link
```

Then link it into the Signal K configuration directory:

```bash
cd ~/.signalk
sudo npm link signalk-raymarine-navico-autopilot-bridge
```

If your Signal K installation runs under a dedicated service account or uses a non-default configuration directory, perform the link under the same environment/user used by the Signal K service.

Restart Signal K after linking.

## 5. Configure in the Signal K Admin UI

Open:

**Server → Plugin Config → Raymarine to Navico Autopilot Bridge**

Configure:

| Plugin setting | Initial value |
|---|---|
| Actisense W2K-1 IP / hostname | Your W2K-1 client-mode IP |
| Dedicated N2K ASCII TCP port | `60003` or the port chosen above |
| Preferred virtual AC12 source address | `1` initially |
| Virtual AC12 unique number | Leave default unless there is a conflict |
| Raymarine ST1→STNG converter source address | `115` initially; verify from your network |
| Enable Track mode | **Off** |
| Enable Apparent Wind mode | **Off** |
| Verbose protocol logging | Off initially; enable while diagnosing |

Save/enable the plugin.

---

# Initial dockside commissioning sequence

Perform the first tests with the vessel secured and with a person able to put the physical Raymarine pilot into Standby immediately.

## Test 1 — NMEA 2000 device discovery only

1. Enable the plugin.
2. Wait at least 10 seconds for address claiming/product information.
3. On the Zeus, inspect the NMEA 2000 device list.
4. Look for a Simrad/AC12 autopilot-class device.
5. Confirm that the source address does not conflict with another NMEA 2000 device.

Expected plugin status after address claiming resembles:

```text
Claimed address 1
```

If the preferred address is already occupied, current canboatjs address-claim logic should move to another free address.

Do not continue if enabling the plugin causes NMEA 2000 device-list instability, repeated address conflicts, or network alarms.

## Test 2 — Zeus autopilot panel

Confirm whether the Zeus now exposes its Navico autopilot control panel/sidebar.

At this stage record exactly what appears, including any messages such as:

- No Autopilot
- Not Commissioned
- AP unavailable
- Heading unavailable
- Rudder unavailable

Those messages determine which remaining Navico commissioning frames need to be implemented.

## Test 3 — State reporting

Using the physical p70s:

1. Select Standby.
2. Select Auto/Heading Hold.
3. Return to Standby.

Verify that the Zeus follows the Raymarine state changes.

## Test 4 — Remote commands

Only after state reporting is reliable:

1. With the vessel safely secured, put the pilot in Standby.
2. Use the Zeus to request Auto.
3. Verify the p70s/S2G enters Auto.
4. Test `+1` and `-1`.
5. Test `+10` and `-10`.
6. Return to Standby from the Zeus.

The physical p70s Standby control remains the immediate fallback.

## Test 5 — Track/Wind later

Leave both experimental feature switches disabled until Tests 1–4 are reliable.

Track mode and Apparent Wind mode will then be enabled individually and instrumented with verbose logging so we can compare:

- commands sent by the Zeus,
- commands accepted by the Raymarine converter/S2G,
- mode reports returned by the Raymarine pilot,
- navigation/wind PGNs present on the backbone.

---

# Architecture

```text
B&G Zeus S
    │
    │ Navico/SimNet autopilot PGNs
    ▼
NMEA 2000 backbone
    │
    ├──────── Raymarine ST1 → STNG converter ─── S2/S2G ─── p70s
    │
    └──────── Actisense W2K-1
                  │
                  │ dedicated TCP / N2K ASCII server
                  ▼
             Signal K plugin
                  │
                  ├── virtual Simrad AC12 address claim
                  ├── Navico command/state translation
                  └── Raymarine SeaTalk command translation
```

The existing normal Signal K NMEA 2000 connection may continue to use another W2K-1 data server simultaneously.

---

# Protocol notes

## Navico side

The original project reverse-engineered and uses several proprietary SimNet/Navico PGNs, including:

- 65302
- 65305
- 65340
- 65341
- 130850
- 130851
- 130860

The current canboat/ts-pgns database now contains definitions for a number of these Simrad PGNs, but this project deliberately retains raw payload support where it is useful for reproducing captured AC12 behavior exactly.

## Raymarine side

The SeaTalk1-to-SeaTalkNG converter transports Raymarine SeaTalk pilot commands over NMEA 2000 proprietary PGNs. The modern implementation references the current Signal K autopilot project's Raymarine support rather than relying exclusively on the 2019 emulator code.

Initial commands implemented here include:

- Standby
- Auto / Heading Hold
- Wind mode command path (feature-gated)
- Track mode command path (feature-gated)
- ±1 / ±10
- Tack keystroke payload definitions for later Zeus mapping

## Safety model

Signal K is **not** calculating rudder output. The Raymarine course computer remains the steering controller. This plugin is a protocol bridge/control-head emulator only.

---

# Troubleshooting

## Plugin says it cannot connect to W2K-1

Check:

```bash
ping <W2K-IP>
nc -vz <W2K-IP> <PORT>
```

Then re-check the W2K-1 Data Server configuration: enabled, TCP, N2K ASCII, Both, matching port.

## Signal K already uses port 60003

Do not share the plugin's dedicated TCP connection with an existing Signal K provider unless you have explicitly verified the W2K/server behavior. Prefer a different unused W2K data server/port.

## Zeus does not show an autopilot

Enable **Verbose proprietary PGN logging** and capture:

- plugin log from startup through at least 30 seconds,
- Zeus NMEA 2000 device list,
- plugin-reported virtual AC12 source address,
- any Zeus autopilot error message.

The next likely work item is completing the legacy PGN 130845 commissioning-response table.

## Raymarine commands do not work

Verify the ST1→STNG converter address. The historical project used source/destination `115`, but NMEA 2000 addresses are dynamic and must not be assumed permanently.

Automatic converter discovery is planned; until then the address is configurable.

---

# Legacy code

The old files (`emulate.js`, `device/`, and the bundled `canboatjs/` tree) are retained on this development branch as protocol reference during the port. They are not used by `index.js` and will be removed or moved under a legacy/reference directory once the modern implementation reaches functional parity.
