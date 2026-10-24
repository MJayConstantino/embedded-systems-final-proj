# Local demo verification · October 24, 2026

- Supabase, cloud authentication, database migrations, account provisioning, hosted retention and deployment configuration have been removed.
- The dashboard opens directly. The local Arduino connection is configured in Settings; no app account or device cloud credential is required.
- All **14 automated tests pass**, covering local HTTP connection, reading validation, acknowledged controls, low-water rejection, unavailable devices, old boot sessions, independent actuator modes, timers, duplicate requests, DHT11 failure, manual OFF and stale readings.
- The production frontend build passes. A browser check connected through Settings to the local simulator, received current readings, entered Manual mode and confirmed a timed activation through the local HTTP API. The dashboard opens without a sign-in screen.
- The actual local bridge is tested against the separately labeled device simulator over HTTP. These are software integration checks, not physical-device checks.
- Arduino compilation succeeded with the UNO R4 WiFi board package 1.6.0: **104,604 bytes flash (39%)**, **10,644 bytes static RAM (32%)**, leaving 22,124 bytes for stack and heap. Runtime network/JSON allocations use some of the remaining RAM.
- Pin assignments, calibration constants, automatic thresholds, Serial output and OLED routines are preserved. Calibration remains untested as requested.

## Before presenting with physical hardware

1. Upload the companion sketch; join Verdant-Demo from the laptop and phone.
2. Confirm the IP in Serial Monitor and connect through dashboard Settings.
3. Compare the four sensor readings and raw analog values with Serial/OLED output.
4. Check each actuator's Manual OFF, timed ON and return to Auto on the real outputs.
5. Verify low-water and DHT11 protective stops and restart behavior.
6. Disconnect the phone/laptop during a timed activation and confirm the board finishes its timer.
7. Confirm the phone can open the laptop's Network URL on the demo Wi-Fi.

No sketch was uploaded or physical actuator activated during development. Hotspot connectivity, actual readings and physical actuator behavior still need these hardware checks. The laptop must stay running for the phone dashboard. No deployment is needed.
