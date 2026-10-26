import { createSimulator } from "../server/simulator.ts";
const scenario = process.env.PLANT_SCENARIO ?? "normal";
if (
  ![
    "normal",
    "dry",
    "low-water",
    "dht-failure",
    "no-readings",
    "no-display",
  ].includes(scenario)
)
  throw new Error(
    "Choose normal, dry, low-water, dht-failure, no-readings, or no-display",
  );
const server = createSimulator(scenario);
server.listen(8787, "127.0.0.1", () =>
  console.log(
    `[SIMULATOR ONLY] No hardware is connected. Scenario: ${scenario}.\nOpen the dashboard Settings and connect to 127.0.0.1:8787.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
