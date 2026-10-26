import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { DeviceModel } from "../src/control.ts";
import {
  validateCommand,
  type Sensors,
  type Telemetry,
} from "../src/domain.ts";
export function createSimulator(scenario = "normal") {
  const start = Date.now(),
    model = new DeviceModel(randomUUID());
  let sequence = 1,
    lastSample = Date.now();
  let displayEnabled = true;
  function sensors(): Sensors {
    const soil = scenario === "dry" ? 25 : 60,
      water =
        scenario === "no-readings" ? 0 : scenario === "low-water" ? 10 : 74,
      valid = scenario !== "dht-failure" && scenario !== "no-readings";
    return {
      soil_raw: 800 - soil * 5,
      water_raw: water * 7,
      soil_percent: soil,
      water_percent: water,
      temperature_c: valid ? 28.4 : null,
      humidity_percent: valid ? 58 : null,
      dht_valid: valid,
    };
  }
  const telemetry = (): Omit<Telemetry, "sensors"> & {
    sensors: Sensors | null;
  } => ({
    device_id: "simulated-plant",
    session_id: model.sessionId,
    sample_seq: scenario === "no-readings" ? 0 : sequence,
    uptime_ms: Date.now() - start,
    sample_age_ms: Date.now() - lastSample,
    sensors: scenario === "no-readings" ? null : sensors(),
    actuators: structuredClone(model.outputs),
    simulated: true,
    display: {
      ready: scenario !== "no-display",
      enabled: scenario !== "no-display" && displayEnabled,
      address: scenario === "no-display" ? null : 60,
    },
  });
  model.tick(sensors(), Date.now());
  const timer = setInterval(() => {
    if (Date.now() - lastSample >= 2000) {
      sequence++;
      lastSample = Date.now();
    }
    model.tick(sensors(), Date.now());
  }, 100);
  const server = createServer(async (req, res) => {
    const reply = (body: unknown, status = 200) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/api/status")
        return reply(telemetry());
      if (req.method === "POST" && req.url === "/api/display") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 640)
            return reply({ error: "Request too large" }, 413);
        }
        const input = JSON.parse(raw);
        if (input.session_id !== model.sessionId)
          return reply({ error: "Board session changed" }, 409);
        if (typeof input.enabled !== "boolean")
          return reply({ error: "Invalid display state" }, 400);
        if (scenario === "no-display")
          return reply({ error: "OLED not detected at 0x3C or 0x3D" }, 409);
        displayEnabled = input.enabled;
        return reply({ telemetry: telemetry() });
      }
      if (req.method === "POST" && req.url === "/api/control") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2048)
            return reply({ error: "Request too large" }, 413);
        }
        const command = JSON.parse(raw);
        const id: unknown = command?.id;
        validateCommand(command);
        if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
          return reply({ error: "Invalid request ID" }, 400);
        const receipt = model.apply({ ...command, id }, sensors(), Date.now());
        return reply({ ...receipt, telemetry: telemetry() });
      }
      reply({ error: "Unknown simulator route" }, 404);
    } catch (e) {
      reply({ error: e instanceof Error ? e.message : "Invalid request" }, 400);
    }
  });
  server.on("close", () => clearInterval(timer));
  return server;
}
