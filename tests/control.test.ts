import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DeviceModel } from "../src/control";
import { demoData } from "../src/demo";
import {
  ACTUATORS,
  isFresh,
  isOnline,
  validateWiFi,
  validateDeviceStatus,
  validateCommand,
  validateTelemetry,
  type Command,
} from "../src/domain";
const session = "board-session-a";
const sensor = () => ({ ...demoData().snapshot.sensors });
const command = (overrides: Partial<Command> = {}): Command => ({
  id: randomUUID(),
  session_id: session,
  actuator: "fan",
  mode: "manual",
  on: true,
  duration_ms: 60000,
  ...overrides,
});
test("automatic hysteresis matches the working firmware", () => {
  const d = new DeviceModel(session),
    s = sensor();
  s.temperature_c = 31;
  d.tick(s, 0);
  assert.equal(d.outputs.fan.on, true);
  s.temperature_c = 29;
  d.tick(s, 1);
  assert.equal(d.outputs.fan.on, true);
  s.temperature_c = 28;
  d.tick(s, 2);
  assert.equal(d.outputs.fan.on, false);
  s.soil_percent = 25;
  s.humidity_percent = 40;
  d.tick(s, 3);
  assert.equal(d.outputs.pump.on, true);
  s.soil_percent = 45;
  d.tick(s, 4);
  assert.equal(d.outputs.pump.on, false);
});
test("manual timer finishes locally and duplicate requests never extend it", () => {
  const d = new DeviceModel(session),
    s = sensor(),
    c = command();
  d.apply(c, s, 0);
  d.apply(c, s, 40000);
  d.tick(s, 59999);
  assert.equal(d.outputs.fan.on, true);
  d.tick(s, 60000);
  assert.equal(d.outputs.fan.mode, "auto");
  assert.equal(d.outputs.fan.on, false);
});
test("manual OFF persists independently until Auto is selected", () => {
  const d = new DeviceModel(session),
    s = sensor();
  s.temperature_c = 35;
  d.apply(command({ on: false, duration_ms: 0 }), s, 0);
  d.tick(s, 1000000);
  assert.equal(d.outputs.fan.on, false);
  assert.equal(d.outputs.fan.mode, "manual");
  assert.equal(d.outputs.pump.mode, "auto");
  d.apply(command({ mode: "auto", on: false, duration_ms: 0 }), s, 1000001);
  assert.equal(d.outputs.fan.on, true);
});
test("manual outputs ignore missing sensor readings but retain local timers", () => {
  const d = new DeviceModel(session),
    s = sensor();
  s.water_percent = 0;
  s.soil_percent = 0;
  s.dht_valid = false;
  s.temperature_c = null;
  s.humidity_percent = null;
  for (const actuator of ["fan", "pump"] as const) {
    assert.equal(
      d.apply(command({ actuator, duration_ms: 30000 }), s, 0).status,
      "applied",
    );
  }
  d.tick(s, 20000);
  assert.equal(d.outputs.pump.on, true);
  assert.equal(d.outputs.fan.on, true);
  d.tick(s, 30000);
  assert.equal(d.outputs.pump.mode, "auto");
  assert.equal(d.outputs.pump.on, false);
  assert.equal(d.outputs.fan.mode, "auto");
  assert.equal(d.outputs.fan.on, false);
});
test("Auto still blocks low-water irrigation and a failed DHT fan", () => {
  const d = new DeviceModel(session),
    s = sensor();
  s.soil_percent = 20;
  s.water_percent = 10;
  s.dht_valid = false;
  s.temperature_c = null;
  s.humidity_percent = null;
  d.tick(s, 0);
  assert.equal(d.outputs.pump.on, false);
  assert.equal(d.outputs.fan.on, false);
  assert.equal(d.outputs.pump.blocked, "Reservoir too low");
  assert.equal(d.outputs.fan.blocked, "DHT11 reading failed");
});
test("board restart rejects controls prepared for the old boot session", () => {
  const d = new DeviceModel("new-session");
  assert.equal(d.outputs.fan.mode, "auto");
  assert.equal(d.apply(command(), sensor(), 0).status, "rejected");
});
test("sensor freshness and payload validation remain separate from device connectivity", () => {
  const snapshot = demoData().snapshot;
  assert.equal(
    isFresh(snapshot, Date.parse(snapshot.received_at) + 9999),
    true,
  );
  assert.equal(
    isFresh(snapshot, Date.parse(snapshot.received_at) + 10000),
    false,
  );
  validateTelemetry(snapshot);
  assert.throws(() =>
    validateTelemetry({
      ...snapshot,
      sensors: { ...snapshot.sensors, soil_raw: 1024 },
    }),
  );
  assert.throws(() =>
    validateTelemetry({
      ...snapshot,
      sensors: { ...snapshot.sensors, dht_valid: false },
    }),
  );
  assert.throws(() => validateCommand(command({ duration_ms: 999 })));
  validateCommand(command());
});

test("irrigation exposes only the pump and fan and rejects retired controls", () => {
  assert.deepEqual(ACTUATORS, ["pump", "fan"]);
  const snapshot = demoData().snapshot;
  assert.deepEqual(Object.keys(snapshot.actuators).sort(), ["fan", "pump"]);
  assert.throws(() => validateCommand({ ...command(), actuator: "atomizer" }));
  validateTelemetry(snapshot);
});
test("irrigation ignores air humidity and respects reservoir start and stop boundaries", () => {
  const d = new DeviceModel(session),
    s = sensor();
  s.soil_percent = 30;
  s.water_percent = 24;
  s.humidity_percent = 10;
  d.tick(s, 0);
  assert.equal(d.outputs.pump.on, false);
  s.water_percent = 25;
  s.humidity_percent = 99;
  d.tick(s, 1);
  assert.equal(d.outputs.pump.on, true);
  s.soil_percent = 44;
  s.water_percent = 16;
  d.tick(s, 2);
  assert.equal(d.outputs.pump.on, true);
  s.water_percent = 15;
  d.tick(s, 3);
  assert.equal(d.outputs.pump.on, false);
});
test("a pump timer returns to Auto without extending on duplicate delivery", () => {
  const d = new DeviceModel(session),
    s = sensor();
  const c = command({ actuator: "pump", duration_ms: 30000 });
  d.apply(c, s, 0);
  d.apply(c, s, 20000);
  d.tick(s, 29999);
  assert.equal(d.outputs.pump.on, true);
  d.tick(s, 30000);
  assert.equal(d.outputs.pump.mode, "auto");
  assert.equal(d.outputs.pump.on, false);
});

test("device connectivity stays independent from missing or stale sensors and expires after 10 seconds", () => {
  const snapshot = {
    ...demoData().snapshot,
    sample_seq: 0,
    readings_valid: false,
    received_at: new Date(0).toISOString(),
    contacted_at: new Date(100000).toISOString(),
  };
  assert.equal(isFresh(snapshot, 100001), false);
  assert.equal(isOnline(snapshot, 109999), true);
  assert.equal(isOnline(snapshot, 110000), false);
  validateDeviceStatus({ ...snapshot, sensors: null });
  assert.throws(() => validateDeviceStatus({ ...snapshot, actuators: {} }));
});
test("Wi-Fi validation supports open networks and rejects oversized or embedded-NUL credentials", () => {
  validateWiFi({ ssid: "My Network", password: "" });
  validateWiFi({ ssid: "My Network", password: "password123" });
  for (const input of [
    { ssid: "", password: "password123" },
    { ssid: "x".repeat(33), password: "password123" },
    { ssid: "My Network", password: "short" },
    { ssid: "My Network", password: "x".repeat(64) },
    { ssid: "My\u0000Network", password: "password123" },
  ])
    assert.throws(() => validateWiFi(input));
});
