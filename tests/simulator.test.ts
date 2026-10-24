import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { validateTelemetry, type Telemetry } from "../src/domain";
test(
  "separate simulator uploads telemetry and acknowledges an HTTP command",
  { timeout: 18000 },
  async () => {
    const id = randomUUID(),
      commandId = randomUUID(),
      token = "b".repeat(64);
    let requests = 0;
    let output = "";
    let resolveAck!: (value: Telemetry) => void,
      rejectAck!: (reason: unknown) => void;
    const ack = new Promise<Telemetry>((resolve, reject) => {
      resolveAck = resolve;
      rejectAck = reject;
    });
    const server = createServer(async (req, res) => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const packet = JSON.parse(body);
        validateTelemetry(packet);
        assert.equal(req.headers["x-device-token"], token);
        assert.equal(packet.device_id, id);
        requests++;
        if (packet.acks.some((a) => a.id === commandId)) resolveAck(packet);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            commands:
              requests === 1
                ? [
                    {
                      id: commandId,
                      device_id: id,
                      session_id: packet.session_id,
                      actuator: "fan",
                      mode: "manual",
                      on: true,
                      duration_ms: 30000,
                      revision: 1,
                      expires_at: new Date(Date.now() + 30000).toISOString(),
                      ttl_ms: 30000,
                    },
                  ]
                : [],
          }),
        );
      } catch (error) {
        rejectAck(error);
        res.statusCode = 400;
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/simulator.ts"],
      {
        cwd: new URL("../", import.meta.url),
        env: {
          ...process.env,
          PLANT_EXCHANGE_URL: `http://127.0.0.1:${address.port}`,
          PLANT_DEVICE_ID: id,
          PLANT_DEVICE_TOKEN: token,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (b) => (output += String(b)));
    child.stderr.on("data", (b) => (output += String(b)));
    child.on("error", rejectAck);
    const timer = setTimeout(
      () => rejectAck(new Error(`Simulator exchange timed out: ${output}`)),
      15000,
    );
    try {
      const packet = await ack;
      assert.equal(packet.acks[0].status, "applied");
      assert.equal(packet.actuators.fan.mode, "manual");
      assert.equal(packet.actuators.fan.on, true);
      assert.ok(
        packet.actuators.fan.remaining_ms > 0 &&
          packet.actuators.fan.remaining_ms < 30000,
      );
      assert.match(output, /SIMULATOR ONLY/);
    } finally {
      clearTimeout(timer);
      child.kill();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
