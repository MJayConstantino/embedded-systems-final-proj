import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createBridge, normalizeAddress } from "../server/bridge";
import { createSimulator } from "../server/simulator";
const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}`);
    }),
  );
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
async function setup(scenario = "normal") {
  const device = createSimulator(scenario),
    deviceUrl = await listen(device);
  const handler = createBridge();
  const app = createServer(
    (req, res) =>
      void handler(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
  );
  const url = await listen(app);
  return {
    device,
    deviceUrl,
    app,
    url,
    async dispose() {
      await close(app);
      await close(device);
    },
  };
}
const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
test("only local IPv4 demo targets are accepted", () => {
  assert.equal(normalizeAddress("192.168.4.1"), "http://192.168.4.1");
  assert.equal(normalizeAddress("127.0.0.1:8787"), "http://127.0.0.1:8787");
  for (const address of [
    "https://192.168.4.1",
    "8.8.8.8",
    "example.com",
    "http://name:pass@192.168.4.1",
    "192.168.4.1/path",
  ])
    assert.throws(() => normalizeAddress(address));
});
test("dashboard starts without an account or database and requires a device for controls", async () => {
  const s = await setup();
  try {
    assert.deepEqual(await (await fetch(s.url + "/api/connection")).json(), {
      address: null,
    });
    assert.equal((await fetch(s.url + "/api/status")).status, 503);
    assert.equal((await post(s.url + "/api/control", {})).status, 409);
  } finally {
    await s.dispose();
  }
});
test("real local HTTP flow connects, reads, activates and confirms the output", async () => {
  const s = await setup();
  try {
    const connected = await (
      await post(s.url + "/api/connection", { address: s.deviceUrl })
    ).json();
    assert.equal(connected.address, s.deviceUrl);
    assert.equal(connected.snapshot.simulated, true);
    const reading = await (await fetch(s.url + "/api/status")).json();
    const response = await post(s.url + "/api/control", {
      session_id: reading.session_id,
      actuator: "fan",
      mode: "manual",
      on: true,
      duration_ms: 30000,
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.command.status, "applied");
    assert.equal(result.snapshot.actuators.fan.on, true);
    assert.equal(result.snapshot.actuators.pump.mode, "auto");
    const off = await (
      await post(s.url + "/api/control", {
        session_id: reading.session_id,
        actuator: "fan",
        mode: "manual",
        on: false,
        duration_ms: 0,
      })
    ).json();
    assert.equal(off.snapshot.actuators.fan.on, false);
  } finally {
    await s.dispose();
  }
});
test("low water is rejected by the device and stays reported OFF", async () => {
  const s = await setup("low-water");
  try {
    const c = await (
      await post(s.url + "/api/connection", { address: s.deviceUrl })
    ).json();
    const response = await (
      await post(s.url + "/api/control", {
        session_id: c.snapshot.session_id,
        actuator: "pump",
        mode: "manual",
        on: true,
        duration_ms: 30000,
      })
    ).json();
    assert.equal(response.command.status, "rejected");
    assert.equal(response.command.reason, "Reservoir too low");
    assert.equal(response.snapshot.actuators.pump.on, false);
  } finally {
    await s.dispose();
  }
});
test("invalid and old-session controls are rejected without changing outputs", async () => {
  const s = await setup();
  try {
    await post(s.url + "/api/connection", { address: s.deviceUrl });
    const response = await post(s.url + "/api/control", {
      session_id: "previous-boot",
      actuator: "fan",
      mode: "manual",
      on: true,
      duration_ms: 60000,
    });
    assert.equal(response.status, 409);
    const bad = await post(s.url + "/api/control", {
      session_id: "previous-boot",
      actuator: "fan",
      mode: "manual",
      on: true,
      duration_ms: 3,
    });
    assert.equal(bad.status, 502);
    assert.equal(
      (await (await fetch(s.url + "/api/status")).json()).actuators.fan.on,
      false,
    );
  } finally {
    await s.dispose();
  }
});
test("another website cannot send controls through the local demo server", async () => {
  const s = await setup();
  try {
    assert.equal(
      (
        await post(
          s.url + "/api/connection",
          { address: s.deviceUrl },
          { origin: "https://another.example" },
        )
      ).status,
      403,
    );
  } finally {
    await s.dispose();
  }
});
test("unavailable device returns a connection error and never queues a command", async () => {
  const s = await setup();
  try {
    await post(s.url + "/api/connection", { address: s.deviceUrl });
    await close(s.device);
    const response = await fetch(s.url + "/api/status");
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Cannot reach/);
  } finally {
    await close(s.app);
  }
});
