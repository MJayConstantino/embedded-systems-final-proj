# Verdant · Smart Plant Dashboard

A mobile-first PWA for one Arduino UNO R4 WiFi plant station. Read soil moisture, water reservoir level, temperature and humidity; independently control the fan, irrigation pump and mist atomizer.

## Run the dashboard now

Install Node.js 22.12+ (Node 24 is recommended). From this folder:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:5173/?demo=1** for the labeled interactive demo. Alternatively, double-click `START-DEMO.cmd`. Demo actions never contact hardware. The normal `/` page is the sign-in/setup screen. No default team password is shipped.

```powershell
npm.cmd test
npm.cmd run check:backend
npm.cmd run build
npm.cmd run preview
```

`dist/` is the deployable frontend. The supplied preview-build ZIP is intentionally unconfigured and shows setup plus the demo; rebuild after setting the cloud variables to enable live operation. Production builds generate a versioned service worker that precaches the compiled app shell. Development mode does not register a service worker.

## Architecture

```text
Phone PWA ── Supabase Auth + authorized database reads
    │
    └── user-command Edge Function ── transactional command queue
                                              │
Arduino ── HTTPS device-exchange every 10s ─────┘
    ├── sensors and automatic rules every 2s
    ├── local manual timers and protective stops
    └── OLED and USB Serial output
```

Cloudflare Pages serves the React frontend. Supabase supplies Auth, PostgreSQL, Edge Functions and a minute-by-minute retention job. No inbound Arduino server, computer bridge or router forwarding is required.

The browser holds only a Supabase publishable key. Each request is authorized for the provisioned team account. The Arduino has its own 256-bit device token; only its SHA-256 hash is stored in `device_credentials`. Database administrative keys belong only in backend environment variables and the local provisioning process.

## Connect a Supabase project

The connected organization reached its free-project limit during implementation. No existing project was paused, modified or repurposed. To deploy, use a new available Supabase project. Never apply these migrations to an unrelated existing application.

1. Create a project in your Supabase account, preferably in Southeast Asia. Obtain its project reference, URL, publishable key and server-side service role key from the dashboard. Keep the service role key private.
2. In **Authentication → Sign In / Providers → Email**, disable new user signups. The local config also disables signups, but linking a cloud project does not automatically apply local Auth settings. Leave anonymous sign-in disabled.
3. Authenticate the CLI and apply the included migrations to that project:

   ```powershell
   $env:DO_NOT_TRACK = '1'
   npx.cmd supabase login
   npx.cmd supabase link --project-ref YOUR_PROJECT_REF
   npx.cmd supabase db push
   npx.cmd supabase functions deploy device-exchange --no-verify-jwt
   npx.cmd supabase functions deploy user-command
   ```

   `device-exchange` verifies its device token itself. `user-command` retains the platform JWT check and independently verifies the user through Auth. Never disable the latter's JWT check to bypass an authentication error.

4. Provision the single team account and plant station using environment variables. In PowerShell 7:

   ```powershell
   $env:SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'
   $env:SUPABASE_PUBLISHABLE_KEY = 'YOUR_PUBLISHABLE_KEY'
   $env:SUPABASE_SERVICE_ROLE_KEY = Read-Host 'Server-side service role key' -MaskInput
   $env:PROJECT_EMAIL = Read-Host 'Shared project email'
   $env:PROJECT_PASSWORD = Read-Host 'Shared project password (12+ characters)' -MaskInput
   $env:PLANT_WIFI_SSID = Read-Host 'Arduino Wi-Fi name'
   $env:PLANT_WIFI_PASSWORD = Read-Host 'Arduino Wi-Fi password' -MaskInput
   npm.cmd run provision
   Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY,Env:PROJECT_PASSWORD,Env:PLANT_WIFI_PASSWORD
   ```

   The script creates the account and device, then writes `.env.local` and `firmware/SmartPlant/arduino_secrets.h`. Both are ignored by Git. It never saves the administrative key or team password. Run provisioning once; if interrupted, inspect the created account/device before retrying rather than repeatedly creating accounts.

5. Run `npm.cmd run dev` and sign in at `/`. Until the Arduino or separate simulator sends telemetry, the page says **Awaiting device** and controls stay disabled.
6. Check **Integrations → Data API** if tables are unexpectedly inaccessible. The migrations explicitly grant authorized reads and enable row-level security. Do not grant anonymous table access to resolve an error.
7. Confirm the `verdant-history-retention` job appears in Supabase Cron. It deletes readings, commands and control events older than 24 hours every minute. Read policies also exclude expired history. Retired boot-session IDs are intentionally retained to prevent old sessions from returning.

## Deploy to Cloudflare Pages

1. Import this source directory through a Git repository into Cloudflare Pages, or build locally and use Pages direct upload for `dist/`.
2. Build command: `npm run build`. Output directory: `dist`. Use Node 24.
3. Configure these frontend build variables from `.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_DEVICE_ID`. Never configure a `VITE_` variable containing an administrative key, team password or device token.
4. Deploy, then set the Supabase Auth site URL to the deployed HTTPS Pages URL.
5. Open the deployed site on a phone. Android Chrome offers **Install app** or **Add to Home screen**. On iPhone use Safari → Share → Add to Home Screen. Availability varies by browser.

The Pages frontend may be publicly reachable; authentication and ownership rules protect live project data and commands. `/?demo=1` is an intentionally public sample-data demo. Free-tier limits and availability apply; no paid subscription was enabled.

## Flash the companion Arduino sketch

The existing firmware is extended in `firmware/SmartPlant/SmartPlant.ino`; remote control is in `CloudControl.h`. Open the `.ino` in Arduino IDE and select **Arduino UNO R4 WiFi**.

Required board package and libraries used in validation:

| Dependency | Version |
| --- | --- |
| Arduino UNO R4 Boards (`arduino:renesas_uno`) | 1.6.0 |
| ArduinoJson | 7.4.2 |
| DHT sensor library | 1.4.7 |
| Adafruit Unified Sensor | 1.1.15 |
| Adafruit GFX Library | 1.12.6 |
| Adafruit SSD1306 | 2.5.17 |
| Adafruit BusIO | 1.17.4 |

WiFiS3 is included with the board package. Install ArduinoJson through Library Manager. If provisioning was not used, copy `arduino_secrets.example.h` to `arduino_secrets.h` and enter your Wi-Fi, project hostname, device UUID and generated device token there.

| Connection | Firmware assignment |
| --- | --- |
| Soil analog signal | A0 |
| Water-level analog signal | A1 |
| DHT11 data | A2 |
| Fan MOSFET control | D5, PWM 220 |
| Pump relay control | D8, active HIGH |
| Atomizer MOSFET control | D11, PWM 255 |
| OLED | Hardware I²C, address 0x3C |

The supplied working sketch takes precedence over conflicting pin descriptions in the project PDF. Existing calibration constants and thresholds are preserved. The pump remains in the original **IRRIGATION_PUMP** mode.

Verify and upload through Arduino IDE. Serial Monitor uses **9600 baud**. Without configured cloud credentials, the sketch continues automatic operation and prints that the cloud is unconfigured. Cloud outages trigger reconnect backoff up to two minutes; local rules and timers continue. Wi-Fi/TLS calls have bounded timeouts and can introduce brief scheduling delays; this is not a hard real-time controller.

Update the board's connectivity firmware through the Arduino IDE firmware updater when needed. Verify HTTPS against your actual project. Supabase has announced retirement of older TLS CBC cipher suites from November 10, 2026 onward; current connectivity firmware and a real device HTTPS test are part of deployment validation: https://supabase.com/changelog/cbc-tls-ciphers-deprecated

## Control behavior

- Each actuator starts in **Auto** after reboot. Selecting **Manual** first requests manual OFF; enable its switch after the device confirms.
- Manual ON runs for **30 seconds**, **1 minute** (default), or **5 minutes**, then returns to Auto. Selecting a duration affects the next activation, not an already-running timer. The same duration preference is shown for all actuator cards.
- Manual OFF stays OFF until another command or board restart. Returning to Auto can immediately turn an output on if its original thresholds are met.
- Manual activation bypasses normal activation thresholds. Low reservoir water still blocks/stops the pump and atomizer; DHT11 failure stops the fan and atomizer. A protective stop cancels manual ON and leaves manual OFF until another request.
- The pump starts only with reservoir level at least 25%; it stops at 15% or below. The atomizer needs at least 20% water. These percentages use the existing untested mappings.
- Requests wait for the next cloud exchange. They become **applied** or **rejected** when the board acknowledges them. Unreceived requests expire after 30 seconds. Delivered requests without acknowledgement expire after 45 seconds with an output-unknown explanation.
- New requests supersede pending requests for the same actuator. Per-actuator revisions and duplicate receipts prevent old delivery from restarting a timer. Commands are bound to the current board boot session.
- **ON/OFF reports the pin state set by firmware, not a separate measurement of the physical actuator.**
- Readings older than 30 seconds disable new remote commands. When the phone is offline, cached readings are dated and commands are never queued. A previously accepted timed activation still finishes on the Arduino.

## Separate device simulator

This process exchanges telemetry and commands with the actual backend. It is distinct from the browser's sample-data demo.

```powershell
$env:PLANT_EXCHANGE_URL = 'https://YOUR_PROJECT.supabase.co/functions/v1/device-exchange'
$env:PLANT_DEVICE_ID = 'YOUR_DEVICE_UUID'
$env:PLANT_DEVICE_TOKEN = Read-Host 'Device token from the excluded secrets file' -MaskInput
$env:PLANT_SCENARIO = 'normal' # normal, dry, low-water, dht-failure
npm.cmd run simulator
```

Do not run it with the same device ID as an operating Arduino; each process represents a different boot session. Use Ctrl+C to stop it. Remove the token environment variable afterward. The simulator models local controls but does not validate physical sensor accuracy, wiring or actuator behavior.

## Project contents

- `src/`: dashboard, charts, authentication, cloud reads, labeled demo and device model.
- `public/`: PWA manifest, icons, service worker and Pages headers.
- `supabase/migrations/`: schema, authorization, transactional device/command functions and scheduled retention.
- `supabase/functions/`: authenticated HTTPS routes and shared protocol validation.
- `firmware/SmartPlant/`: companion Arduino sketch and secrets template.
- `scripts/`: account/device provisioning, device simulator and PWA build finalization.
- `tests/`: control, HTTP authentication/validation and PostgreSQL/RLS integration checks.
- `VERIFICATION.md`: completed checks and deployment/hardware limits.

Keep local secrets, `node_modules`, build caches and compiled sketches out of source-control uploads. The supplied source ZIP excludes those files. Sensor calibration is deliberately outside this implementation.
