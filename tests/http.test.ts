import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviceExchange,
  userCommand,
} from "../supabase/functions/_shared/handlers";
import { hashSecret } from "../supabase/functions/_shared/http";
import { demoData } from "../src/demo";
type Db = Parameters<typeof deviceExchange>[1];
const token = "a".repeat(64);
const packet = () => ({ ...demoData().snapshot, acks: [] });
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://plant.example/functions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
test("device route rejects missing or wrong credentials without running exchange", async () => {
  let called = false;
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const db = {
    from: () => chain,
    rpc: async () => {
      called = true;
      return { data: { commands: [] }, error: null };
    },
  } as unknown as Db;
  assert.equal((await deviceExchange(request(packet()), db)).status, 401);
  assert.equal(
    (await deviceExchange(request(packet(), { "x-device-token": token }), db))
      .status,
    401,
  );
  assert.equal(called, false);
});
test("device route hashes token and returns commands only after credential match", async () => {
  let hash = "";
  const chain = {
    select: () => chain,
    eq: (key: string, value: string) => {
      if (key === "secret_hash") hash = value;
      return chain;
    },
    maybeSingle: async () => ({
      data: { device_id: packet().device_id },
      error: null,
    }),
  };
  const db = {
    from: () => chain,
    rpc: async (name: string) => {
      assert.equal(name, "exchange_device");
      return { data: { commands: [] }, error: null };
    },
  } as unknown as Db;
  const response = await deviceExchange(
    request(packet(), { "x-device-token": token }),
    db,
  );
  assert.equal(response.status, 200);
  assert.equal(hash, await hashSecret(token));
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("invalid telemetry and oversized bodies are rejected before database writes", async () => {
  const db = {
    from: () => {
      throw new Error("Must not call database");
    },
  } as unknown as Db;
  assert.equal(
    (
      await deviceExchange(
        request({ ...packet(), sample_seq: -1 }, { "x-device-token": token }),
        db,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await deviceExchange(
        request({ padding: "x".repeat(13000) }, { "x-device-token": token }),
        db,
      )
    ).status,
    400,
  );
});
test("user route rejects anonymous or invalid sign-in and authorizes with server-verified user", async () => {
  let owner = "";
  const db = {
    auth: {
      getUser: async (t: string) => ({
        data: { user: t === "valid" ? { id: "verified-owner" } : null },
        error: null,
      }),
    },
    rpc: async (_name: string, args: { p_owner: string }) => {
      owner = args.p_owner;
      return { data: { id: "issued" }, error: null };
    },
  } as unknown as Db;
  const command = {
    device_id: packet().device_id,
    actuator: "fan",
    mode: "manual",
    on: true,
    duration_ms: 60000,
  };
  assert.equal((await userCommand(request(command), db)).status, 401);
  assert.equal(
    (
      await userCommand(
        request(command, { authorization: "Bearer invalid" }),
        db,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await userCommand(
        request(
          { ...command, p_owner: "spoofed" },
          { authorization: "Bearer valid" },
        ),
        db,
      )
    ).status,
    200,
  );
  assert.equal(owner, "verified-owner");
});
test("user route enforces allowed durations and propagates stale/access denial", async () => {
  const db = {
    auth: {
      getUser: async () => ({ data: { user: { id: "owner" } }, error: null }),
    },
    rpc: async () => ({ data: null, error: { message: "stale" } }),
  } as unknown as Db;
  const c = {
    device_id: packet().device_id,
    actuator: "pump",
    mode: "manual",
    on: true,
    duration_ms: 123,
  };
  assert.equal(
    (await userCommand(request(c, { authorization: "Bearer valid" }), db))
      .status,
    400,
  );
  assert.equal(
    (
      await userCommand(
        request(
          { ...c, duration_ms: 60000 },
          { authorization: "Bearer valid" },
        ),
        db,
      )
    ).status,
    409,
  );
});
