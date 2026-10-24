import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { userCommand } from "../_shared/handlers.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve((req) => userCommand(req, db));
