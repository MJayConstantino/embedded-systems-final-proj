# Verification · October 24, 2026

## Completed software checks

- **25 automated tests passed**, including the separate simulator process exchanging commands over local HTTP. That process test required running outside the restricted sandbox so its child could reach the local test server.
- Production React/TypeScript build succeeds. Hashed JavaScript, CSS and locally bundled fonts are included in the generated PWA precache.
- Supabase Edge Function TypeScript check succeeds against the installed, pinned Supabase SDK types.
- Automated tests cover the original hysteresis rules; independent manual/Auto states; local expiry; persistent manual OFF; low-water and DHT failure handling; duplicate, expired and superseded commands; boot-session rejection; stale sensor detection; and protocol validation.
- PostgreSQL integration tests run the actual core schema and transactional RPCs in PGlite. They verify one sample per minute, command delivery/acknowledgement, concurrent requests, ownership policies, anonymous-access denial, denied client writes, service-only RPCs, retention cleanup, retired sessions, stale-packet rejection and acknowledgement timeout.
- HTTP tests exercise the same handlers used by the deployed Edge Functions, including missing/invalid device credentials, token hashing, verified-user authorization, input-size limits and invalid durations. The hosted Supabase API is not involved in these local HTTP tests.
- A separate process test launches the supplied device simulator against a local HTTP endpoint and verifies telemetry, command reception, and the following exchange's output acknowledgement.
- Browser checks covered desktop and a 390 × 844 phone viewport, sensor details and raw readings, keyboard Escape to close the modal, independent Manual mode, duration selection, activation, history navigation, settings and installation guidance.
- A production service worker was observed in the activated state. With browser network emulation offline, the app reloaded from its cache, showed the offline notice and disabled all actuator controls. Restoring the network re-enabled the sample controls. Temporary network/viewport overrides were restored.
- A final compile of the companion sketch succeeded for `arduino:renesas_uno:unor4wifi`, board package 1.6.0: **106,048 bytes flash (40%)**, **10,608 bytes static RAM (32%)**, leaving 22,160 bytes for stack/heap. Dynamic JSON/network allocations consume some of the remaining RAM at runtime.

## Delivery boundaries

- **Live deployment is pending.** Supabase refused a new free project because organization members have reached their free-project limits. No existing application was changed to make room. Cloudflare Pages deployment credentials are not configured in this workspace.
- The source includes migrations, both Edge Functions, provisioning scripts, firmware and exact deployment instructions. No paid hosting, user account, device credential or live database was created.
- The minute-based pg_cron job is supplied as a hosted migration. Its cleanup function is tested locally; the hosted scheduler itself awaits an available Supabase project.
- Live shared-account login/logout, hosted function deployment, Cloudflare headers, provider quotas and phone home-screen installation still require the configured deployment. They are not claimed as live-verified.
- **Physical hardware validation is pending.** Compilation and a software model do not verify real sensor readings, wiring, actuator outputs, HTTPS/TLS compatibility, disconnect timing or memory use on the board. No sketch was uploaded and no physical actuator was activated during development.
- Calibration constants were preserved. Sensor calibration/accuracy was not tested, as requested. Soil and reservoir percentages are labeled estimates.

## Hardware acceptance checklist

1. Configure and flash the companion sketch, then confirm the original 9600-baud Serial output and OLED readings.
2. Confirm all four cloud readings match the current Serial/OLED sample, including raw analog readings in sensor details.
3. On each actuator independently, select Manual, wait for acknowledgement, activate for 30 seconds and observe its real output. Confirm expiry returns it to Auto.
4. Check the existing low-water and invalid-DHT behavior, including manual cancellation and no automatic resumption of a cancelled manual activation.
5. Disconnect internet during a timed activation. Confirm local timer completion and continuing automatic operation.
6. Reboot the board with a pending command and confirm Auto startup and rejection of old-session requests.
7. Test with the current board connectivity firmware and the deployed Supabase HTTPS hostname. Keep its TLS stack current.

See README.md for commands, account setup and deployment steps.
