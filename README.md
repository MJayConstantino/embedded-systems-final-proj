# Verdant · Local Smart Irrigation Demo

Monitor soil moisture and reservoir supply, run the irrigation pump, and control optional ventilation from a phone or laptop. **No deployment, database, account or internet connection is needed during the demo.**

The product pitch is in [`pitch-deck/`](pitch-deck/README.md), including an editable PowerPoint, a PDF viewing copy and presenter notes.

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

## Irrigation behavior

- Auto starts the pump when soil moisture is **30% or lower** and reservoir level is **25% or higher**. It stops at soil **45% or higher** or water **15% or lower**. Values are estimates using the existing constants, not calibrated measurements.
- Manual watering runs for 30 seconds, 1 minute or 5 minutes. Manual ignores sensor thresholds and sensor-based lockouts, including low-water detection. Check the reservoir yourself before watering. Air humidity and a DHT11 failure do not stop soil-based irrigation.
- In Auto, the optional fan keeps its original 30°C ON / 28°C OFF rules and turns OFF on DHT11 failure. Manual fan control works without a DHT11 reading.
- Upload this revised sketch before the hardware demo. Disconnect the damaged mist module with power off; do not reuse it as an irrigation output. The old sketch still contains mist control until replaced.

## Controls

- Each actuator has independent **Auto / Manual** selection. Selecting Manual first puts it OFF. Enable the switch after confirmation to activate it.
- Manual ON runs for **30 seconds, 1 minute, or 5 minutes**, then returns to Auto. The timer runs on the Arduino even if the laptop or phone disconnects.
- Manual OFF stays OFF until Auto is selected, another command is sent, or the board restarts. Returning to Auto can immediately turn an actuator ON if its sensor thresholds are met.
- Auto retains low-water and DHT11 protections. Manual is sensor-independent and remains available without readings. Its time limit still runs on the Arduino.
- The dashboard polls every **2 seconds**. No device contact for **10 seconds** disables controls; stale or missing sensor readings alone do not. Unavailable sensor values show a dash and never enter history. Failed commands are never queued or automatically retried.
- ON/OFF is the output state reported by firmware; it is not a separate physical measurement of the actuator.
- Charts keep one reading per minute while the tab is open, up to 24 hours. Activity is limited to recent controls from that tab. **Reloading clears this session history.** There is no stored database or browser data store.
- Soil moisture and water level percentages use the original, untested constants. No calibration work was added.

## Join your own Wi-Fi from the app

1. Upload the revised sketch. First-time setup uses the **Verdant-Demo** hotspot (password **plantdemo**).
2. Join that hotspot on the laptop, run the dashboard, open **the real dashboard at http://localhost:5173/**, and connect to **192.168.4.1** in Settings. The `?demo=1` page never controls hardware.
3. In **Settings → Join your Wi-Fi**, enter your SSID and password, then click **Save & join Wi-Fi**. Use your existing 2.4 GHz network. Leave the password empty only for an open network.
4. The board saves the credentials in its EEPROM, closes the old connection and joins your network. The password is not returned by the endpoint, printed to Serial, logged or stored by the app/laptop bridge.
5. Move the laptop and phone back to that same Wi-Fi. Read **Arduino local IP** in Serial Monitor at **9600 baud**, then enter that IP in Settings and click Connect Arduino again. Use the laptop Network URL on the phone.
6. Credentials survive board restart. If joining fails twice, the board returns to Verdant-Demo for setup (the retry interval is 30 seconds). Correct the credentials from that hotspot. Saved credentials take precedence over a secrets header.

Endpoints use local HTTP on port 80: Arduino `GET /api/status`, `POST /api/control`, `POST /api/wifi`. The laptop Vite server on port 5173 proxies them through its local API. No cloud endpoint, database or login is used. Setup only changes network settings when you press Save & join Wi-Fi.

## Enter Wi-Fi in the Arduino IDE instead (optional)

Copy `firmware/SmartPlant/arduino_secrets.example.h` to `arduino_secrets.h`. Set `USE_EXISTING_WIFI` to `true` and fill in `SECRET_SSID` and `SECRET_PASS`. Upload, read the assigned IP in Serial Monitor, and connect all devices to that same Wi-Fi. Use that IP in Settings.

The correctly named configuration file is **arduino_secrets.h** (underscore). An existing file named `arduino.secrets.h` is preserved and ignored by Git, but is not read by this sketch. There is no need to create any configuration file when using the default Verdant-Demo hotspot.

You can optionally set `ARDUINO_HOST=http://192.168.4.1` in `.env.local` to preselect the board address on server startup. Otherwise connect in Settings.

## Demo without hardware

- **Sample interface:** open `http://localhost:5173/?demo=1`. This is clearly labeled sample data and never contacts a device.
- **Local device simulator:** in another terminal run `npm.cmd run simulator`, then connect the normal dashboard to **127.0.0.1:8787** in Settings. It exercises real local HTTP readings and control acknowledgements and is labeled as simulated hardware. No credentials are required.

The simulator supports `PLANT_SCENARIO=normal`, `dry`, `low-water`, `dht-failure`, `no-readings` or `no-display`. For example, in PowerShell:

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
| Retired mist driver | D11 held LOW; disconnect the damaged module |
| OLED | Hardware I²C, probes 0x3C then 0x3D; ON at startup |

The irrigation pump remains on D8 and the optional ventilation fan on D5. Soil A0, reservoir A1 and DHT11 A2 keep their existing constants and thresholds. The OLED and Serial output show irrigation and ventilation. Humidity is monitoring only. The retired mist output has no API control or automatic rule; D11 stays LOW after setup.

## OLED startup and toggle

- The OLED starts **ON after every reboot**. Turning it OFF in the app does not save an OFF preference.
- Firmware probes I²C addresses **0x3C and 0x3D** before initializing the existing 128×64 SSD1306 display. It shows a startup screen, then readings and the board IP.
- Use the **OLED display** switch on Dashboard. It needs a live Arduino connection but no sensor readings. The API returns the board-confirmed display state.
- If no OLED acknowledges either address, the dashboard says **OLED not detected**, disables its switch and Serial Monitor at **9600 baud** reports what to check. Confirm the module’s power/GND and hardware SDA/SCL wiring, then restart the board. Acknowledgement does not prove visible pixels or that a different display controller is compatible with SSD1306.
- An older sketch must be replaced before the new switch can work. The sample `?demo=1` switch only changes simulated state.

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
| Laptop `POST /api/connection` | `{ "address": "192.168.4.1" }`; connects and validates board status; sensor data is optional for Manual |
| Laptop `GET /api/status` | Current board telemetry with sample timestamp |
| Laptop `POST /api/display` | `{ "enabled": true }` or false; returns confirmed display state |
| Arduino `POST /api/display` | Session-bound OLED ON/OFF; rejects if no display was detected |
| Laptop `POST /api/wifi` | `{ "ssid": "your network", "password": "your password" }`; forwards to the board, never echoes the password |
| Arduino `POST /api/wifi` | Session-bound settings saved on board; acknowledges before switching networks |
| Laptop `POST /api/control` | Current `session_id`, actuator, mode, ON/OFF, duration; returns device confirmation |
| Arduino `GET /api/status` | Sensor and output readings |
| Arduino `POST /api/control` | Applies one validated, session-bound control request and returns its output state |

`server/bridge.ts` is mounted by Vite. It keeps only the current address and latest reading in memory, validates local targets, forwards each command once, and returns the board acknowledgement. `LocalControl.h` is the Arduino HTTP/control extension. `src/control.ts` models those rules for the separately labeled simulator and tests.

This is a local demonstration setup; access is intended for people connected to the demo network. See `VERIFICATION.md` for completed checks and physical-hardware checks still needed.
