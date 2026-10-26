# Manual, Wi-Fi and OLED revision · October 26, 2026

- **26 automated tests pass**, covering Auto hysteresis and low-water/DHT protection, sensor-independent Manual ON/OFF, local timer expiry, duplicates, stale connections, reboot sessions, retired controls, absent sensor payloads, SSID/password validation, Wi-Fi forwarding without password echo, OLED startup ON, OLED ON/OFF acknowledgement and missing-display rejection.
- Production frontend build passes. Browser checks with intercepted test responses verify Manual operation with no readings, dashes for absent sensors, OLED toggling, missing-display messaging, offline disabling, SSID/password submission, password clearing, no browser credential storage, phone layout and no page errors. These are software checks, not real board results.
- Arduino UNO R4 WiFi compilation passes with its normal sketchbook libraries, including the installed ArduinoJson 7.4.2. No temporary --libraries override is needed. Board package: 1.6.0. Compiled size: **110,028 bytes flash (41%)**, **11,056 bytes static RAM (33%)**, **21,712 bytes remaining** for stack and heap. Runtime allocations use some remaining RAM.
- D8 irrigation pump and D5 fan remain. D11 stays LOW. Soil A0, reservoir A1 and DHT11 A2 keep existing constants. Calibration remains untested.
- Manual deliberately ignores sensor thresholds and sensor-based lockouts. A reachable board, valid boot session and an allowed duration are still required. Manual OFF persists until changed; timers run locally and return to Auto. Auto retains the original low-water and DHT11 protections.
- The board stores user-entered Wi-Fi credentials in EEPROM, acknowledges before switching, and returns to its setup hotspot after two failed station attempts. No password is included in telemetry/Serial or intentionally persisted by the laptop/browser. Actual EEPROM persistence and network switching still need hardware verification.
- OLED startup probes 0x3C then 0x3D, initializes SSD1306 only on acknowledgement and explicitly enables the panel. Remote OFF is not persisted. `ready` reports I²C detection plus library initialization, not physical pixel feedback.

## Physical checks still required

1. Disconnect the damaged mist module with power off. Upload the revised sketch. No upload or actuator activation was performed during this revision.
2. At startup, confirm the OLED splash and Serial message `OLED detected at 0x...`. If unavailable, check module power/GND, hardware SDA/SCL, SSD1306 compatibility and address. Compare actual screen output with dashboard status.
3. Join Verdant-Demo on the laptop, open the real dashboard without `?demo=1`, and connect to 192.168.4.1. Check OLED OFF/ON from the app and verify that reboot always restores ON.
4. Save your SSID/password through Settings. Rejoin that network from laptop and phone, read the board IP from Serial/OLED and reconnect in Settings. Verify persistence after reboot and setup-hotspot fallback for an incorrect password.
5. With an appropriate water supply, verify Manual pump/fan activation without relying on sensor readings. Check physical outputs, relay polarity, Manual OFF and timers through a lost laptop/phone connection.
6. Verify Auto soil ≤30% / water ≥25% starts watering, soil ≥45% / water ≤15% stops it, and DHT failure stops the Auto fan. Auto may activate immediately after a manual timer ends if start conditions hold.
7. Verify stale device contact disables controls and old-session requests fail after reboot. Missing sensor readings alone should not disable Manual or OLED controls.

No physical OLED operation, water delivery, router connectivity or EEPROM persistence is claimed until these checks pass on the actual board. The laptop serves the phone dashboard. No database or hosted backend is used.
