# Verdant · Local Smart Plant Demo

Read the Arduino’s sensors and control its fan, pump and atomizer from a phone or laptop. **No deployment, database, account or internet connection is needed during the demo.**

## Run with the real Arduino

One-time preparation: install Node.js 22.12+ (Node 24 recommended) and run `npm.cmd ci` from this folder while the laptop has internet. Install the Arduino libraries below before joining the demo Wi-Fi. Later demo runs work offline.

1. Open `firmware/SmartPlant/SmartPlant.ino` in Arduino IDE. Select **Arduino UNO R4 WiFi**, install the libraries listed below, and upload.
2. Connect the **laptop and phone** to the Wi-Fi network created by the board:
   - Network: **Verdant-Demo**
   - Password: **plantdemo**
   - Arduino address: **192.168.4.1**
   - Stay connected if the phone warns that this Wi-Fi has no internet.
3. On the laptop, double-click **START-DEMO.cmd**, or run:

   ```powershell
   npm.cmd run dev
   ```

   `START-DEMO.cmd` uses the installed dependencies and starts the same local server.
4. Open **http://localhost:5173/**. In **Settings**, enter **192.168.4.1** and press **Connect Arduino**.
5. On the phone, open the **Network URL** printed by Vite on the laptop, such as `http://192.168.4.2:5173/`. Use the laptop's IP for the dashboard, not the Arduino's IP. The device connection is shared by phones using that running laptop server.

If another device cannot open the laptop URL, allow Node.js through Windows Firewall for your demo network. Serial Monitor at **9600 baud** prints the Arduino IP. The OLED and original Serial readings remain available.

The laptop stays running during the demo. The app's existing Vite server forwards local requests to the board; there is no separate backend service to configure.

## Controls

- Each actuator has independent **Auto / Manual** selection. Selecting Manual first puts it OFF. Enable the switch after confirmation to activate it.
- Manual ON runs for **30 seconds, 1 minute, or 5 minutes**, then returns to Auto. The timer runs on the Arduino even if the laptop or phone disconnects.
- Manual OFF stays OFF until Auto is selected, another command is sent, or the board restarts. Returning to Auto can immediately turn an actuator ON if its sensor thresholds are met.
- Existing low-water and DHT11 protections remain active. A protective stop cancels manual activation and leaves it OFF until another command.
- The dashboard polls every **2 seconds**. Readings older than **10 seconds** disable controls. Failed commands are never queued or automatically retried.
- ON/OFF is the output state reported by firmware; it is not a separate physical measurement of the actuator.
- Charts keep one reading per minute while the tab is open, up to 24 hours. Activity is limited to recent controls from that tab. **Reloading clears this session history.** There is no stored database or browser data store.
- Soil moisture and water level percentages use the original, untested constants. No calibration work was added.

## Use your existing Wi-Fi instead (optional)

Copy `firmware/SmartPlant/arduino_secrets.example.h` to `arduino_secrets.h`. Set `USE_EXISTING_WIFI` to `true` and fill in `SECRET_SSID` and `SECRET_PASS`. Upload, read the assigned IP in Serial Monitor, and connect all devices to that same Wi-Fi. Use that IP in Settings.

The correctly named configuration file is **arduino_secrets.h** (underscore). An existing file named `arduino.secrets.h` is preserved and ignored by Git, but is not read by this sketch. There is no need to create any configuration file when using the default Verdant-Demo hotspot.

You can optionally set `ARDUINO_HOST=http://192.168.4.1` in `.env.local` to preselect the board address on server startup. Otherwise connect in Settings.

## Demo without hardware

- **Sample interface:** open `http://localhost:5173/?demo=1`. This is clearly labeled sample data and never contacts a device.
- **Local device simulator:** in another terminal run `npm.cmd run simulator`, then connect the normal dashboard to **127.0.0.1:8787** in Settings. It exercises real local HTTP readings and control acknowledgements and is labeled as simulated hardware. No credentials are required.

The simulator supports `PLANT_SCENARIO=normal`, `dry`, `low-water` or `dht-failure`. For example, in PowerShell:

```powershell
$env:PLANT_SCENARIO = 'low-water'
npm.cmd run simulator
```

Use Ctrl+C to stop the simulator or dashboard server.

## Arduino libraries and wiring

Validated compile environment: Arduino UNO R4 Boards **1.6.0**, **ArduinoJson 7.4.2**, DHT sensor library **1.4.7**, Adafruit Unified Sensor **1.1.15**, Adafruit GFX Library **1.12.6**, Adafruit SSD1306 **2.5.17**, Adafruit BusIO **1.17.4**. WiFiS3 comes with the board package.

| Component | Working sketch assignment |
| --- | --- |
| Soil moisture | A0 |
| Water level | A1 |
| DHT11 | A2 |
| Fan | D5, PWM 220 |
| Pump | D8, active-HIGH relay |
| Atomizer | D11, PWM 255 |
| OLED | Hardware I²C, address 0x3C |

The original automatic thresholds, pin assignments, OLED and Serial output are preserved. The pump remains an irrigation pump.

## Build and check

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

`npm run preview` runs the compiled interface **and the same local Arduino bridge**. Opening `dist/index.html` as a file does not provide device communication.

The PWA manifest and offline app shell remain available. Installation works on localhost or HTTPS where the browser supports it. For this demo, phones simply open the local HTTP Network URL; home-screen installation on phones is not required.

## Local interfaces

| Route | Behavior |
| --- | --- |
| Laptop `GET /api/connection` | Current Arduino target, held in server memory |
| Laptop `POST /api/connection` | `{ "address": "192.168.4.1" }`; connects and validates a reading |
| Laptop `GET /api/status` | Current board telemetry with sample timestamp |
| Laptop `POST /api/control` | Current `session_id`, actuator, mode, ON/OFF, duration; returns device confirmation |
| Arduino `GET /api/status` | Sensor and output readings |
| Arduino `POST /api/control` | Applies one validated, session-bound control request and returns its output state |

`server/bridge.ts` is mounted by Vite. It keeps only the current address and latest reading in memory, validates local targets, forwards each command once, and returns the board acknowledgement. `LocalControl.h` is the Arduino HTTP/control extension. `src/control.ts` models those rules for the separately labeled simulator and tests.

This is a local demonstration setup; access is intended for people connected to the demo network. See `VERIFICATION.md` for completed checks and physical-hardware checks still needed.
