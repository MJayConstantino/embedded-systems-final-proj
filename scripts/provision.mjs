// Run locally with server credentials in environment variables. No administrative key is written to disk.
import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PROJECT_EMAIL",
  "PROJECT_PASSWORD",
  "SUPABASE_PUBLISHABLE_KEY",
];
for (const name of required)
  if (!process.env[name]) throw new Error(`Missing ${name}. See README.md.`);
if (process.env.PROJECT_PASSWORD.length < 12)
  throw new Error("Use a project password with at least 12 characters.");
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: user, error: userError } = await db.auth.admin.createUser({
  email: process.env.PROJECT_EMAIL,
  password: process.env.PROJECT_PASSWORD,
  email_confirm: true,
});
if (userError) throw userError;
const { data: device, error: deviceError } = await db
  .from("devices")
  .insert({ owner_id: user.user.id, name: "Plant station 01" })
  .select("id")
  .single();
if (deviceError) throw deviceError;
const token = randomBytes(32).toString("hex");
const { error } = await db
  .from("device_credentials")
  .insert({
    device_id: device.id,
    secret_hash: createHash("sha256").update(token).digest("hex"),
  });
if (error) throw error;
const quoted = (value) => JSON.stringify(value);
await writeFile(
  new URL("../firmware/SmartPlant/arduino_secrets.h", import.meta.url),
  `#pragma once\n#define SECRET_SSID ${quoted(process.env.PLANT_WIFI_SSID ?? "YOUR_WIFI_NAME")}\n#define SECRET_PASS ${quoted(process.env.PLANT_WIFI_PASSWORD ?? "YOUR_WIFI_PASSWORD")}\n#define CLOUD_HOST ${quoted(new URL(process.env.SUPABASE_URL).hostname)}\n#define DEVICE_ID ${quoted(device.id)}\n#define DEVICE_TOKEN ${quoted(token)}\n`,
);
await writeFile(
  new URL("../.env.local", import.meta.url),
  `VITE_SUPABASE_URL=${process.env.SUPABASE_URL}\nVITE_SUPABASE_PUBLISHABLE_KEY=${process.env.SUPABASE_PUBLISHABLE_KEY}\nVITE_DEVICE_ID=${device.id}\n`,
);
console.log(
  `Created plant device ${device.id}. Local frontend settings and excluded Arduino secrets are ready. Disable public registration before deployment. Administrative credentials were not saved.`,
);
