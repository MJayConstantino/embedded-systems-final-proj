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
test("manual watering is accepted even without usable water readings", async () => {
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
    assert.equal(response.command.status, "applied");
    assert.equal(response.command.reason, null);
    assert.equal(response.snapshot.actuators.pump.on, true);
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

test("retired actuator requests cannot activate an output through either HTTP interface", async () => {
  const s = await setup();
  try {
    const c = await (
      await post(s.url + "/api/connection", { address: s.deviceUrl })
    ).json();
    assert.deepEqual(Object.keys(c.snapshot.actuators).sort(), ["fan", "pump"]);
    const input = {
      session_id: c.snapshot.session_id,
      actuator: "atomizer",
      mode: "manual",
      on: true,
      duration_ms: 30000,
    };
    assert.equal(
      (
        await post(s.deviceUrl + "/api/control", {
          ...input,
          id: "00000000-0000-4000-8000-000000000001",
        })
      ).status,
      400,
    );
    assert.notEqual((await post(s.url + "/api/control", input)).status, 200);
    const current = await (await fetch(s.url + "/api/status")).json();
    assert.equal(current.actuators.pump.on, false);
    assert.equal(current.actuators.fan.on, false);
  } finally {
    await s.dispose();
  }
});
test("dry soil starts irrigation automatically through the local HTTP bridge", async () => {
  const s = await setup("dry");
  try {
    const c = await (
      await post(s.url + "/api/connection", { address: s.deviceUrl })
    ).json();
    assert.equal(c.snapshot.actuators.pump.mode, "auto");
    assert.equal(c.snapshot.actuators.pump.on, true);
    assert.equal(c.snapshot.actuators.fan.on, false);
  } finally {
    await s.dispose();
  }
});

test("a reachable device without sensors still accepts manual ON and OFF", async () => {
  const s = await setup("no-readings");
  try {
    const c = await (
      await post(s.url + "/api/connection", { address: s.deviceUrl })
    ).json();
    assert.equal(c.snapshot.readings_valid, false);
    assert.equal(c.snapshot.sample_seq, 0);
    assert.ok(c.snapshot.contacted_at);
    for (const actuator of ["pump", "fan"]) {
      const on = await (
        await post(s.url + "/api/control", {
          session_id: c.snapshot.session_id,
          actuator,
          mode: "manual",
          on: true,
          duration_ms: 30000,
        })
      ).json();
      assert.equal(on.command.status, "applied");
      assert.equal(on.snapshot.actuators[actuator].on, true);
      const off = await (
        await post(s.url + "/api/control", {
          session_id: c.snapshot.session_id,
          actuator,
          mode: "manual",
          on: false,
          duration_ms: 0,
        })
      ).json();
      assert.equal(off.snapshot.actuators[actuator].on, false);
    }
  } finally {
    await s.dispose();
  }
});
test("Wi-Fi configuration validates credentials, forwards them once and never echoes the password", async () => {
  const base = await setup();
  const reading = await (await fetch(base.deviceUrl + "/api/status")).json();
  let sent: any = null;
  const board = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/status") {
      res.end(JSON.stringify(reading));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    sent = JSON.parse(raw);
    res.end(JSON.stringify({ accepted: true }));
  });
  const boardUrl = await listen(board);
  try {
    await post(base.url + "/api/connection", { address: boardUrl });
    assert.equal(
      (
        await post(base.url + "/api/wifi", {
          ssid: "Test Network",
          password: "short",
        })
      ).status,
      400,
    );
    assert.equal(sent, null);
    const response = await post(base.url + "/api/wifi", {
      ssid: "Test Network",
      password: "test-pass-123",
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes("test-pass-123"), false);
    assert.deepEqual(sent, {
      ssid: "Test Network",
      password: "test-pass-123",
      session_id: reading.session_id,
    });
  } finally {
    await close(board);
    await base.dispose();
  }
});
test("Wi-Fi configuration requires a board connection and rejects foreign website origins", async () => {
  const s = await setup();
  try {
    assert.equal(
      (
        await post(s.url + "/api/wifi", {
          ssid: "Test",
          password: "password123",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post(
          s.url + "/api/wifi",
          { ssid: "Test", password: "password123" },
          { origin: "https://another.example" },
        )
      ).status,
      403,
    );
  } finally {
    await s.dispose();
  }
});

test("OLED starts ON, toggles independently without readings, and defaults ON in a new board session", async () => {
  const s = await setup("no-readings");
  try {
    const c = await (
      await post(s.url + "/api/connection", { address: s.deviceUrl })
    ).json();
    assert.deepEqual(c.snapshot.display, {
      ready: true,
      enabled: true,
      address: 60,
    });
    const off = await (
      await post(s.url + "/api/display", { enabled: false })
    ).json();
    assert.equal(off.snapshot.display.enabled, false);
    assert.equal(off.snapshot.actuators.pump.on, false);
    const on = await (
      await post(s.url + "/api/display", { enabled: true })
    ).json();
    assert.equal(on.snapshot.display.enabled, true);
    assert.equal(
      (await post(s.url + "/api/display", { enabled: "yes" })).status,
      400,
    );
  } finally {
    await s.dispose();
  }
  const reboot = await setup();
  try {
    assert.equal(
      (await (await fetch(reboot.deviceUrl + "/api/status")).json()).display
        .enabled,
      true,
    );
  } finally {
    await reboot.dispose();
  }
});
test("a missing OLED is reported as undetected instead of accepting a fake toggle", async () => {
  const s = await setup("no-display");
  try {
    const c = await (
      await post(s.url + "/api/connection", { address: s.deviceUrl })
    ).json();
    assert.deepEqual(c.snapshot.display, {
      ready: false,
      enabled: false,
      address: null,
    });
    const response = await post(s.url + "/api/display", { enabled: true });
    assert.notEqual(response.status, 200);
    assert.match((await response.json()).error, /OLED not detected/);
  } finally {
    await s.dispose();
  }
});
