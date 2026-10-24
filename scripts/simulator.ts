// Separate from the browser demo. This simulates one board against a real or locally served exchange endpoint.
import { randomUUID } from "node:crypto";
import { DeviceModel } from "../src/control";
import {
  validateTelemetry,
  type Sensors,
  type Telemetry,
  type Command,
} from "../src/domain";
const endpoint = process.env.PLANT_EXCHANGE_URL;
const id = process.env.PLANT_DEVICE_ID,
  token = process.env.PLANT_DEVICE_TOKEN;
if (!endpoint || !id || !token)
  throw new Error(
    "Set PLANT_EXCHANGE_URL, PLANT_DEVICE_ID, PLANT_DEVICE_TOKEN. See README.",
  );
if (
  new URL(endpoint).protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname)
)
  throw new Error("Use HTTPS outside localhost.");
const model = new DeviceModel(randomUUID()),
  start = Date.now();
let sequence = 0,
  acks: Telemetry["acks"] = [],
  lastExchange = 0,
  exchanging = false;
let sensor: Sensors;
const scenario = process.env.PLANT_SCENARIO ?? "normal";
function sample(): Sensors {
  const seconds = (Date.now() - start) / 1000;
  const soil =
    scenario === "dry" ? 25 : 60 + Math.round(5 * Math.sin(seconds / 40));
  const water = scenario === "low-water" ? 10 : 74;
  const invalid = scenario === "dht-failure";
  return {
    soil_raw: Math.round(800 - soil * 5),
    water_raw: Math.round(water * 7),
    soil_percent: soil,
    water_percent: water,
    temperature_c: invalid ? null : 28.4,
    humidity_percent: invalid ? null : 58,
    dht_valid: !invalid,
  };
}
async function exchange() {
  if (exchanging) return;
  exchanging = true;
  try {
    const payload: Telemetry = {
      device_id: id!,
      session_id: model.sessionId,
      sample_seq: sequence,
      uptime_ms: Date.now() - start,
      sensors: sensor,
      actuators: structuredClone(model.outputs),
      acks,
    };
    validateTelemetry(payload);
    const sent = Date.now();
    const response = await fetch(endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-token": token! },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Exchange HTTP ${response.status}`);
    const data = (await response.json()) as { commands: Command[] };
    acks = [];
    for (const command of data.commands) {
      command.ttl_ms -= Date.now() - sent;
      acks.push(model.apply(command, sensor, Date.now()));
    }
    console.log(
      `[SIMULATED DEVICE] soil ${sensor.soil_percent}% · water ${sensor.water_percent}% · ${JSON.stringify(model.outputs)}`,
    );
  } catch (error) {
    console.error(
      "[SIMULATOR] Cloud unavailable; local rules and manual timers continue.",
      error instanceof Error ? error.message : error,
    );
  } finally {
    exchanging = false;
  }
}
console.log(
  `[SIMULATOR ONLY] Session ${model.sessionId} · scenario ${scenario}. Do not run for the same device as a powered physical board.`,
);
sensor = sample();
sequence++;
model.tick(sensor, Date.now());
lastExchange = Date.now();
void exchange();
setInterval(() => {
  sensor = sample();
  sequence++;
  model.tick(sensor, Date.now());
}, 2000);
setInterval(() => {
  model.tick(sensor, Date.now());
  if (Date.now() - lastExchange >= 10000) {
    lastExchange = Date.now();
    void exchange();
  }
}, 250);
