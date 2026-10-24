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
  function sensors(): Sensors {
    const soil = scenario === "dry" ? 25 : 60,
      water = scenario === "low-water" ? 10 : 74,
      valid = scenario !== "dht-failure";
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
  const telemetry = (): Telemetry => ({
    device_id: "simulated-plant",
    session_id: model.sessionId,
    sample_seq: sequence,
    uptime_ms: Date.now() - start,
    sample_age_ms: Date.now() - lastSample,
    sensors: sensors(),
    actuators: structuredClone(model.outputs),
    simulated: true,
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
