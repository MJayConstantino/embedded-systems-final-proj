import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { demoData } from "../src/demo";
const db = new PGlite();
const owner = randomUUID(),
  stranger = randomUUID();
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}'),('${stranger}');`,
  );
  await db.exec(
    await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  );
});
after(async () => {
  await db.close();
});
async function setup() {
  const id = randomUUID();
  await db.query("insert into devices(id,owner_id) values($1,$2)", [id, owner]);
  return id;
}
function payload(id: string, seq = 1, session = "session-first") {
  return {
    ...demoData().snapshot,
    device_id: id,
    session_id: session,
    sample_seq: seq,
    acks: [],
  };
}
async function exchange(id: string, packet = payload(id)) {
  const r = await db.query<{ result: { commands: unknown[] } }>(
    "select exchange_device($1,$2::jsonb) result",
    [id, JSON.stringify(packet)],
  );
  return r.rows[0].result;
}
async function issue(id: string, on = true) {
  const r = await db.query<{ result: { id: string; status: string } }>(
    `select issue_command($1,$2,'fan','manual',$3,$4) result`,
    [owner, id, on, on ? 60000 : 0],
  );
  return r.rows[0].result;
}
test("first telemetry creates latest state and one sample per minute", async () => {
  const id = await setup();
  await exchange(id);
  await exchange(id, payload(id, 2));
  assert.equal(
    (await db.query("select * from history where device_id=$1", [id])).rows
      .length,
    1,
  );
  assert.equal(
    (
      await db.query<{ seq: string }>(
        `select payload->>'sample_seq' seq from latest_telemetry where device_id=$1`,
        [id],
      )
    ).rows[0].seq,
    "2",
  );
});
test("commands are delivered and acknowledged, duplicates do not duplicate events", async () => {
  const id = await setup();
  await exchange(id);
  const c = await issue(id);
  const delivered = await exchange(id, payload(id, 2));
  assert.equal(delivered.commands.length, 1);
  const ack = {
    ...payload(id, 3),
    acks: [{ id: c.id, status: "applied", reason: null }],
  };
  await exchange(id, ack);
  await exchange(id, ack);
  const state = await db.query<{ status: string }>(
    "select status from commands where id=$1",
    [c.id],
  );
  assert.equal(state.rows[0].status, "applied");
  assert.equal(
    (
      await db.query(
        `select * from control_events where device_id=$1 and kind='applied'`,
        [id],
      )
    ).rows.length,
    1,
  );
});
test("newer phone request supersedes pending command atomically", async () => {
  const id = await setup();
  await exchange(id);
  const [first, second] = await Promise.all([issue(id), issue(id, false)]);
  const rows = await db.query<{ id: string; status: string }>(
    "select id,status from commands where device_id=$1 order by revision",
    [id],
  );
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0].status, "expired");
  assert.equal(rows.rows[1].status, "pending");
  assert.notEqual(first.id, second.id);
});
test("expired undelivered command is never returned", async () => {
  const id = await setup();
  await exchange(id);
  const c = await issue(id);
  await db.query(
    `update commands set expires_at=now()-interval '1 second' where id=$1`,
    [c.id],
  );
  const result = await exchange(id, payload(id, 2));
  assert.equal(result.commands.length, 0);
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from commands where id=$1",
        [c.id],
      )
    ).rows[0].status,
    "expired",
  );
});
test("reboot retires old session and expires its commands", async () => {
  const id = await setup();
  await exchange(id);
  await issue(id);
  await exchange(id, payload(id, 1, "session-new"));
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from commands where device_id=$1",
        [id],
      )
    ).rows[0].status,
    "expired",
  );
  await assert.rejects(
    exchange(id, payload(id, 4, "session-first")),
    /Retired/,
  );
});
test("stale and unauthorized requests cannot issue a command", async () => {
  const id = await setup();
  await exchange(id);
  await assert.rejects(
    db.query(`select issue_command($1,$2,'fan','manual',true,60000)`, [
      stranger,
      id,
    ]),
    /access denied/,
  );
  await db.query(
    `update devices set last_seen=now()-interval '31 seconds' where id=$1`,
    [id],
  );
  await assert.rejects(issue(id), /stale/);
});
test("authenticated reads enforce ownership and writes and RPCs are denied", async () => {
  const id = await setup();
  await exchange(id);
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${stranger}',false);`,
  );
  try {
    assert.equal(
      (await db.query("select * from devices where id=$1", [id])).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from latest_telemetry where device_id=$1", [
          id,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select * from device_credentials"),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`select issue_command($1,$2,'fan','manual',true,60000)`, [
        owner,
        id,
      ]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role;");
  }
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`,
  );
  try {
    assert.equal(
      (
        await db.query("select * from latest_telemetry where device_id=$1", [
          id,
        ])
      ).rows.length,
      1,
    );
    await assert.rejects(
      db.query("delete from devices where id=$1", [id]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role;");
  }
});
test("out-of-order samples cannot replace latest state; old data is pruned", async () => {
  const id = await setup();
  await exchange(id, payload(id, 3));
  await assert.rejects(exchange(id, payload(id, 2)), /Out-of-order/);
  await db.query(
    `insert into history values($1,now()-interval '25 hours','{}')`,
    [id],
  );
  await db.exec("select prune_plant_history()");
  assert.equal(
    (
      await db.query(
        `select * from history where device_id=$1 and recorded_at<now()-interval '24 hours'`,
        [id],
      )
    ).rows.length,
    0,
  );
});
test("repeated sample never makes old readings fresh", async () => {
  const id = await setup();
  await exchange(id);
  await db.query(
    `update devices set last_seen=now()-interval '31 seconds' where id=$1`,
    [id],
  );
  await exchange(id);
  await assert.rejects(issue(id), /stale/);
});
test("delivered but unacknowledged command eventually releases pending control", async () => {
  const id = await setup();
  await exchange(id);
  const c = await issue(id);
  await exchange(id, payload(id, 2));
  await db.query(
    `update commands set delivered_at=now()-interval '46 seconds' where id=$1`,
    [c.id],
  );
  await exchange(id, payload(id, 3));
  const row = (
    await db.query<{ status: string; reason: string }>(
      "select status,reason from commands where id=$1",
      [c.id],
    )
  ).rows[0];
  assert.equal(row.status, "expired");
  assert.match(row.reason, /consult reported output/);
});
test("schema bootstrap matches the generated core migration", async () => {
  assert.equal(
    await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    await readFile(
      new URL(
        "../supabase/migrations/20261024075408_smart_plant.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
test("anonymous callers and a null owner cannot bypass authorization", async () => {
  const id = await setup();
  await exchange(id);
  await assert.rejects(
    db.query(`select issue_command(null,$1,'fan','manual',true,60000)`, [id]),
    /access denied/,
  );
  await db.exec("set role anon");
  try {
    await assert.rejects(
      db.query("select * from devices"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select exchange_device($1,$2::jsonb)", [
        id,
        JSON.stringify(payload(id)),
      ]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});
