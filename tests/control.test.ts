import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DeviceModel } from "../src/control";
import { demoData } from "../src/demo";
import {
  isFresh,
  validateCommand,
  validateTelemetry,
  type Command,
} from "../src/domain";
const session = "board-session-a";
const sensor = () => ({ ...demoData().snapshot.sensors });
const command = (overrides: Partial<Command> = {}): Command => ({
  id: randomUUID(),
  device_id: demoData().snapshot.device_id,
  session_id: session,
  actuator: "fan",
  mode: "manual",
  on: true,
  duration_ms: 60000,
  revision: 1,
  expires_at: new Date(Date.now() + 30000).toISOString(),
  ttl_ms: 30000,
  ...overrides,
});
test("automatic hysteresis and independent outputs match supplied rules", () => {
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
  assert.equal(d.outputs.atomizer.on, true);
  s.soil_percent = 45;
  d.tick(s, 4);
  assert.equal(d.outputs.pump.on, false);
  assert.equal(d.outputs.atomizer.on, false);
});
test("manual timer expires locally and duplicate delivery cannot extend it", () => {
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
test("manual OFF is independent and persists until changed", () => {
  const d = new DeviceModel(session),
    s = sensor();
  s.temperature_c = 35;
  d.apply(command({ on: false, duration_ms: 0 }), s, 0);
  d.tick(s, 1000000);
  assert.equal(d.outputs.fan.mode, "manual");
  assert.equal(d.outputs.fan.on, false);
  assert.equal(d.outputs.pump.mode, "auto");
  d.apply(
    command({ mode: "auto", on: false, duration_ms: 0, revision: 2 }),
    s,
    1000001,
  );
  assert.equal(d.outputs.fan.on, true);
});
test("low-water rejects activation; protective stop stays off after recovery", () => {
  const d = new DeviceModel(session),
    s = sensor();
  s.water_percent = 10;
  assert.equal(d.apply(command({ actuator: "pump" }), s, 0).status, "rejected");
  s.water_percent = 74;
  d.apply(command({ actuator: "pump", revision: 2 }), s, 1);
  assert.equal(d.outputs.pump.on, true);
  s.water_percent = 15;
  d.tick(s, 2);
  assert.equal(d.outputs.pump.on, false);
  s.water_percent = 74;
  d.tick(s, 3);
  assert.equal(d.outputs.pump.on, false);
  assert.equal(d.outputs.pump.mode, "manual");
});
test("invalid DHT cancels fan and atomizer but permits pump operation", () => {
  const d = new DeviceModel(session),
    s = sensor();
  for (const actuator of ["fan", "pump", "atomizer"] as const)
    d.apply(command({ actuator }), s, 0);
  s.dht_valid = false;
  s.temperature_c = null;
  s.humidity_percent = null;
  d.tick(s, 1);
  assert.equal(d.outputs.fan.on, false);
  assert.equal(d.outputs.atomizer.on, false);
  assert.equal(d.outputs.pump.on, true);
});
test("new boot, expired and out-of-order commands are rejected", () => {
  const d = new DeviceModel(session),
    s = sensor();
  assert.equal(
    d.apply(command({ session_id: "old-session" }), s, 0).status,
    "rejected",
  );
  assert.equal(d.apply(command({ ttl_ms: 0 }), s, 0).status, "rejected");
  d.apply(command({ revision: 3 }), s, 0);
  assert.equal(
    d.apply(command({ revision: 2, on: false, duration_ms: 0 }), s, 1).status,
    "rejected",
  );
  const restarted = new DeviceModel("new-session");
  assert.equal(restarted.outputs.fan.mode, "auto");
  assert.equal(restarted.apply(command(), s, 0).status, "rejected");
});
test("freshness and payload validation reject invalid sensor and command values", () => {
  const snapshot = demoData().snapshot;
  assert.equal(
    isFresh(snapshot, Date.parse(snapshot.received_at) + 29999),
    true,
  );
  assert.equal(
    isFresh(snapshot, Date.parse(snapshot.received_at) + 30000),
    false,
  );
  validateTelemetry({ ...snapshot, acks: [] });
  assert.throws(() =>
    validateTelemetry({
      ...snapshot,
      acks: [],
      sensors: { ...snapshot.sensors, soil_raw: 1024 },
    }),
  );
  assert.throws(() =>
    validateTelemetry({
      ...snapshot,
      acks: [],
      sensors: { ...snapshot.sensors, dht_valid: false },
    }),
  );
  assert.throws(() => validateCommand(command({ duration_ms: 999 })));
  validateCommand(command());
});
