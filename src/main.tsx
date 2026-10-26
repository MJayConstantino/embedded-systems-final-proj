import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Leaf,
  LayoutDashboard,
  ChartNoAxesCombined,
  Settings,
  Droplets,
  Thermometer,
  Wind,
  Waves,
  Fan,
  Sprout,
  ArrowUpRight,
  ArrowLeft,
  CircleHelp,
  Clock3,
  Wifi,
  ChevronRight,
  Download,
  X,
  Check,
  LoaderCircle,
  CircleAlert,
  Activity,
  Radio,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ACTUATORS,
  isFresh,
  isOnline,
  type Actuator,
  type Snapshot,
  type HistoryRow,
  type EventRow,
  type Sensors,
} from "./domain";
import {
  loadCurrent,
  sendCommand,
  loadConnection,
  connectDevice,
  configureWiFi,
  setDisplay,
} from "./api";
import { demoData } from "./demo";
import "./style.css";

const sensors: {
  key: keyof Sensors;
  name: string;
  subtitle: string;
  unit: string;
  icon: LucideIcon;
  color: string;
  description: string;
  pin: string;
}[] = [
  {
    key: "soil_percent",
    name: "Soil moisture",
    subtitle: "Root environment",
    unit: "%",
    icon: Sprout,
    color: "green",
    description:
      "Estimated moisture using the existing firmware mapping: dry 800 → 0%, wet 300 → 100%. Calibration has not been tested.",
    pin: "A0 · analog",
  },
  {
    key: "temperature_c",
    name: "Temperature",
    subtitle: "Ambient air",
    unit: "°C",
    icon: Thermometer,
    color: "orange",
    description:
      "DHT11 ambient temperature. Automatic fan control turns on at 30°C and off at 28°C.",
    pin: "A2 · DHT11",
  },
  {
    key: "humidity_percent",
    name: "Air humidity",
    subtitle: "Ambient air",
    unit: "%",
    icon: Wind,
    color: "blue",
    description:
      "DHT11 relative humidity for monitoring only. Irrigation depends on soil moisture and reservoir level, not air humidity.",
    pin: "A2 · DHT11",
  },
  {
    key: "water_percent",
    name: "Water reservoir",
    subtitle: "Available water",
    unit: "%",
    icon: Droplets,
    color: "teal",
    description:
      "Estimated level using the existing firmware mapping: raw 0 → 0%, raw 700 → 100%. Calibration has not been tested.",
    pin: "A1 · analog",
  },
];
const actuatorInfo: Record<
  Actuator,
  { name: string; label: string; icon: LucideIcon; pin: string; rule: string }
> = {
  fan: {
    name: "Ventilation fan",
    label: "Air circulation",
    icon: Fan,
    pin: "D5 · PWM 220/255",
    rule: "On at 30°C; off at 28°C. DHT11 failure forces OFF.",
  },
  pump: {
    name: "Irrigation pump",
    label: "Soil irrigation",
    icon: Waves,
    pin: "D8 · relay, active HIGH",
    rule: "On at soil ≤30% with water ≥25%. Off at soil ≥45% or water ≤15%.",
  },
};
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const dateTime = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const age = (value: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : `${Math.floor(seconds / 3600)}h ago`;
};
function Chart({
  rows,
  sensor,
  large = false,
}: {
  rows: HistoryRow[];
  sensor: (typeof sensors)[number];
  large?: boolean;
}) {
  const valid = rows
    .map((r) => ({ t: Date.parse(r.recorded_at), v: r.sensors[sensor.key] }))
    .filter((p) => typeof p.v === "number") as { t: number; v: number }[];
  if (valid.length < 2)
    return (
      <div className="chart-empty">History appears as readings arrive.</div>
    );
  const min = Math.min(...valid.map((p) => p.v)) - 2,
    max = Math.max(...valid.map((p) => p.v)) + 2;
  const start = Date.parse(rows[0].recorded_at),
    end = Date.parse(rows.at(-1)!.recorded_at);
  // Separate paths at invalid readings and network gaps rather than implying continuous data.
  let segments: string[] = [];
  let path = "";
  let previous = 0;
  for (const row of rows) {
    const t = Date.parse(row.recorded_at),
      v = row.sensors[sensor.key];
    if (typeof v !== "number") {
      if (path) segments.push(path);
      path = "";
      previous = 0;
      continue;
    }
    const x = 4 + ((t - start) / Math.max(1, end - start)) * 392,
      y = 76 - ((v - min) / (max - min)) * 65;
    if (previous && t - previous > 180000) {
      segments.push(path);
      path = "";
    }
    path += `${path ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    previous = t;
  }
  if (path) segments.push(path);
  return (
    <svg
      className={`chart ${sensor.color} ${large ? "large" : ""}`}
      viewBox="0 0 400 88"
      role="img"
      aria-label={`${sensor.name} history, ${Math.min(...valid.map((p) => p.v)).toFixed(1)} to ${Math.max(...valid.map((p) => p.v)).toFixed(1)} ${sensor.unit}`}
      preserveAspectRatio="none"
    >
      <path className="chart-grid" d="M0 22H400M0 50H400M0 78H400" />
      {segments.map((p, i) => (
        <path key={i} d={p} className="chart-line" />
      ))}
    </svg>
  );
}
function App() {
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  const [tab, setTab] = useState("dashboard"),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [history, setHistory] = useState<HistoryRow[]>([]),
    [events, setEvents] = useState<EventRow[]>([]),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState<Actuator | null>(null),
    [detail, setDetail] = useState<(typeof sensors)[number] | null>(null),
    [duration, setDuration] = useState(60000),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [installHelp, setInstallHelp] = useState(false),
    [address, setAddress] = useState(""),
    [addressInput, setAddressInput] = useState(""),
    [connecting, setConnecting] = useState(false),
    [wifiSSID, setWifiSSID] = useState(""),
    [wifiPassword, setWifiPassword] = useState(""),
    [savingWiFi, setSavingWiFi] = useState(false),
    [displayBusy, setDisplayBusy] = useState(false),
    [wifiMessage, setWifiMessage] = useState(""),
    [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const dialogRef = useRef<HTMLDialogElement>(null),
    demoDeadline = useRef<Partial<Record<Actuator, number>>>({}),
    epoch = useRef(0);
  const fresh = isFresh(snapshot, now),
    connected = isOnline(snapshot, now) && networkOnline,
    controlsEnabled =
      connected && !busy && !connecting && !savingWiFi && !displayBusy;
  function acceptSnapshot(reading: Snapshot) {
    setSnapshot(reading);
    if (!isFresh(reading)) return;
    const minute = Math.floor(Date.parse(reading.received_at) / 60000);
    setHistory((rows) =>
      rows.at(-1) &&
      Math.floor(Date.parse(rows.at(-1)!.recorded_at) / 60000) === minute
        ? rows
        : [
            ...rows.filter(
              (r) => Date.parse(r.recorded_at) > Date.now() - 86400000,
            ),
            { recorded_at: reading.received_at, sensors: reading.sensors },
          ],
    );
  }
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      clearInterval(tick);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);
  useEffect(() => {
    if (demo) return;
    let active = true;
    loadConnection()
      .then((c) => {
        if (active) {
          setAddress(c.address ?? "");
          setAddressInput(c.address ?? "");
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Start the dashboard with npm run dev so the local Arduino connection is available.",
          );
      });
    return () => {
      active = false;
    };
  }, [demo]);
  useEffect(() => {
    if (!demo) return;
    const data = demoData();
    setSnapshot(data.snapshot);
    setHistory(data.history);
    setEvents(data.events);
    const timer = setInterval(
      () =>
        setSnapshot((s) => {
          if (!s) return s;
          const actuators = { ...s.actuators };
          for (const a of ACTUATORS) {
            const end = demoDeadline.current[a];
            if (end && Date.now() >= end) {
              actuators[a] = {
                mode: "auto",
                on: false,
                remaining_ms: 0,
                blocked: null,
              };
              delete demoDeadline.current[a];
            } else if (end)
              actuators[a] = {
                ...actuators[a],
                remaining_ms: end - Date.now(),
              };
          }
          return { ...s, actuators, received_at: new Date().toISOString() };
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [demo]);
  useEffect(() => {
    if (demo || !address) return;
    let active = true,
      loading = false;
    async function refresh() {
      if (document.hidden || loading) return;
      loading = true;
      const generation = epoch.current;
      try {
        const reading = await loadCurrent();
        if (active && generation === epoch.current) {
          acceptSnapshot(reading);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Cannot reach the Arduino.",
          );
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [demo, address]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (detail && dialog && !dialog.open) dialog.showModal();
    else if (!detail && dialog?.open) dialog.close();
  }, [detail]);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError("");
    epoch.current++;
    try {
      const result = await connectDevice(addressInput.trim());
      setHistory([]);
      setEvents([]);
      setAddress(result.address);
      setAddressInput(result.address);
      acceptSnapshot(result.snapshot);
      setToast(
        result.snapshot.simulated
          ? "Connected to the local simulator."
          : "Connected to the Arduino.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setConnecting(false);
    }
  }
  async function toggleDisplay() {
    if (!controlsEnabled || !snapshot?.display?.ready) return;
    setDisplayBusy(true);
    setError("");
    epoch.current++;
    const enabled = !snapshot.display.enabled;
    try {
      if (demo) {
        setSnapshot((s) =>
          s ? { ...s, display: { ...s.display!, enabled } } : s,
        );
        setToast("Demo OLED updated. No hardware is connected.");
      } else {
        const result = await setDisplay(enabled);
        acceptSnapshot(result.snapshot);
        setToast(`Arduino confirmed OLED ${enabled ? "ON" : "OFF"}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set OLED state");
    } finally {
      setDisplayBusy(false);
    }
  }
  async function saveWiFi(e: React.FormEvent) {
    e.preventDefault();
    if (demo || !connected || snapshot?.simulated || savingWiFi) return;
    setSavingWiFi(true);
    setError("");
    setWifiMessage("");
    try {
      const result = await configureWiFi({
        ssid: wifiSSID,
        password: wifiPassword,
      });
      epoch.current++;
      setWifiMessage(result.message);
      setSnapshot(null);
      setAddress("");
      setAddressInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not configure Wi-Fi");
    } finally {
      setWifiPassword("");
      setSavingWiFi(false);
    }
  }
  useEffect(() => {
    const online = () => setNetworkOnline(navigator.onLine);
    addEventListener("online", online);
    addEventListener("offline", online);
    return () => {
      removeEventListener("online", online);
      removeEventListener("offline", online);
    };
  }, []);
  async function control(a: Actuator, mode: "auto" | "manual", on = false) {
    if (!controlsEnabled || !snapshot) return;
    epoch.current++;
    setBusy(a);
    setError("");
    const input = {
      session_id: snapshot.session_id,
      actuator: a,
      mode,
      on,
      duration_ms: mode === "manual" && on ? duration : 0,
    };
    try {
      if (demo) {
        if (on) demoDeadline.current[a] = Date.now() + duration;
        else delete demoDeadline.current[a];
        setSnapshot((s) =>
          s
            ? {
                ...s,
                actuators: {
                  ...s.actuators,
                  [a]: {
                    mode,
                    on,
                    remaining_ms: input.duration_ms,
                    blocked: null,
                  },
                },
              }
            : s,
        );
        setEvents((es) => [
          {
            id: Date.now(),
            created_at: new Date().toISOString(),
            kind: "demo",
            message: `Demo · ${actuatorInfo[a].name} → ${mode === "auto" ? "Auto" : on ? "ON" : "OFF"}`,
          },
          ...es,
        ]);
        setToast("Demo control updated. No hardware is connected.");
      } else {
        const result = await sendCommand(input);
        acceptSnapshot(result.snapshot);
        setEvents((es) =>
          [
            {
              id: Date.now(),
              created_at: result.command.created_at,
              kind: result.command.status,
              message: `${actuatorInfo[a].name} · ${mode === "auto" ? "Auto" : on ? "Manual ON" : "Manual OFF"} · ${result.command.status}${result.command.reason ? " · " + result.command.reason : ""}`,
            },
            ...es,
          ].slice(0, 30),
        );
        setToast(
          result.command.status === "applied"
            ? "Arduino confirmed the output."
            : (result.command.reason ?? "Arduino rejected the activation."),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Command failed.");
    } finally {
      setBusy(null);
    }
  }
  const header = (
    <header className="topbar">
      <a className="brand" href={demo ? "/?demo=1" : "/"}>
        <span className="brand-mark">
          <Leaf size={22} />
        </span>
        <span>
          verdant<span className="brand-dot">.</span>
        </span>
      </a>
      <div className="top-right">
        <span className="project-label">SMART IRRIGATION</span>
        <span className="avatar" aria-label="Project team">
          SP
        </span>
      </div>
    </header>
  );
  return (
    <>
      {header}
      <div className="app-layout">
        <aside className="sidebar">
          <span className="nav-caption">WORKSPACE</span>
          {[
            ["dashboard", "Overview", LayoutDashboard],
            ["history", "Sensor history", ChartNoAxesCombined],
            ["settings", "Settings", Settings],
          ].map(([key, label, Icon]) => {
            const I = Icon as LucideIcon;
            return (
              <button
                key={String(key)}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(String(key))}
              >
                <I size={19} />
                {String(label)}
                {tab === key && <span className="nav-indicator" />}
              </button>
            );
          })}
          <div className="sidebar-bottom">
            <div className="mini-plant">
              <Sprout size={30} />
              <strong>
                Small system.
                <br />
                Room to grow.
              </strong>
              <p>Check soil moisture and control watering over local Wi-Fi.</p>
            </div>
            <span className="version">
              <Radio size={13} /> UNO R4 WiFi · v1.0
            </span>
          </div>
        </aside>
        <main className="workspace">
          {demo && (
            <div className="demo-banner">
              <span>
                <Radio size={15} />
                <strong>Interactive demo</strong> · Sample readings, no hardware
                connected
              </span>
              <a href="/">
                Exit demo <X size={14} />
              </a>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR IRRIGATION STATION</span>
              <h1>
                {tab === "dashboard"
                  ? "Watering, with a clearer view."
                  : tab === "history"
                    ? "Every reading tells a story."
                    : "Make yourself at home."}
              </h1>
              <p>
                {tab === "dashboard"
                  ? "Soil moisture, reservoir supply and watering controls in one place."
                  : tab === "history"
                    ? "Sensor readings collected while this dashboard is open."
                    : "Your system, connection, and control preferences."}
              </p>
            </div>
            <span className="today">
              {new Date(now).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          {!demo && !address && (
            <div className="notice">
              <Wifi size={18} />
              <span>Connect your Arduino to start the local demo.</span>
              <button
                className="text-button"
                onClick={() => setTab("settings")}
              >
                Connect device <ChevronRight size={15} />
              </button>
              <a className="text-button" href="/?demo=1">
                Sample demo
              </a>
            </div>
          )}
          {!demo && snapshot?.simulated && (
            <div className="demo-banner">
              <strong>Local simulator · no physical hardware connected</strong>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <CircleAlert size={18} />
              {error}
            </div>
          )}
          <section className="system-strip">
            <div className="device-symbol">
              <Sprout size={24} />
            </div>
            <div className="system-name">
              <strong>Irrigation station 01</strong>
              <span>
                Arduino UNO R4 WiFi <span className="separator">/</span>{" "}
                Soil-based irrigation system
              </span>
            </div>
            <div className={`connection ${connected ? "live" : ""}`}>
              <span className="status-dot" />
              {demo
                ? "Demo device"
                : connected
                  ? "Device online"
                  : snapshot
                    ? "Readings stale"
                    : "Awaiting device"}
            </div>
            <span className="last-sync">
              <Clock3 size={14} />
              {snapshot
                ? `Updated ${age(snapshot.received_at, now)}`
                : "No readings yet"}
            </span>
          </section>
          {snapshot && !fresh && (
            <p className="stale-date">
              Sensor readings are unavailable or stale.
              {snapshot.sample_seq > 0 && (
                <> Last sensor update: {dateTime(snapshot.received_at)}.</>
              )}
              {connected
                ? " Manual controls are available while the Arduino is connected."
                : " Reconnect the Arduino to use controls."}
            </p>
          )}
          {tab === "dashboard" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>Environment overview</h2>
                  <p>The essentials, at a glance.</p>
                </div>
                <span className="subtle-tag">
                  <Activity size={13} />{" "}
                  {demo ? "Sample data" : "Updated every 2 seconds"}
                </span>
              </div>
              <div className="sensor-grid">
                {sensors.map((sensor) => {
                  const Icon = sensor.icon,
                    value = snapshot?.sensors[sensor.key],
                    invalid =
                      snapshot?.readings_valid === false ||
                      !snapshot?.sample_seq ||
                      value === null ||
                      value === undefined;
                  return (
                    <button
                      className={`sensor-card ${sensor.color}`}
                      key={sensor.key}
                      onClick={() => setDetail(sensor)}
                      aria-label={`View ${sensor.name} details`}
                    >
                      <div className="sensor-top">
                        <span className="sensor-icon">
                          <Icon size={21} />
                        </span>
                        <ArrowUpRight className="card-arrow" size={17} />
                      </div>
                      <span className="sensor-name">{sensor.name}</span>
                      <div className="sensor-value">
                        {invalid
                          ? "—"
                          : typeof value === "number"
                            ? value.toFixed(
                                sensor.key === "temperature_c" ? 1 : 0,
                              )
                            : "—"}
                        <span>{sensor.unit}</span>
                      </div>
                      <span className="sensor-sub">
                        {invalid
                          ? snapshot
                            ? "Reading unavailable"
                            : "Waiting for first reading"
                          : sensor.subtitle}
                      </span>
                      <Chart rows={history.slice(-72)} sensor={sensor} />
                      <div className="sensor-footer">
                        <span
                          className={`tiny-dot ${invalid ? "muted" : ""}`}
                        />
                        {invalid
                          ? "No valid reading"
                          : sensor.key === "soil_percent" ||
                              sensor.key === "water_percent"
                            ? "Estimated percentage"
                            : "DHT11 reading"}
                        <ChevronRight size={13} />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="section-heading controls-heading">
                <div>
                  <h2>Irrigation & ventilation</h2>
                  <p>Automatic watering with an optional ventilation fan.</p>
                </div>
                <span className="subtle-tag">
                  <SlidersHorizontal size={13} /> Independent control
                </span>
              </div>
              <div className="actuator-grid">
                {ACTUATORS.map((a) => {
                  const info = actuatorInfo[a],
                    Icon = info.icon,
                    o = snapshot?.actuators[a];
                  return (
                    <section
                      key={a}
                      className={`actuator-card ${o?.on ? "running" : ""}`}
                    >
                      <div className="actuator-top">
                        <span className="actuator-icon">
                          <Icon size={23} />
                        </span>
                        <span className={`output-tag ${o?.on ? "on" : ""}`}>
                          {o ? (o.on ? "ON" : "OFF") : "—"}
                        </span>
                      </div>
                      <h3>{info.name}</h3>
                      <p>{info.label}</p>
                      <div
                        className="segmented"
                        aria-label={`${info.name} control mode`}
                      >
                        <button
                          aria-pressed={o?.mode === "auto"}
                          disabled={!controlsEnabled}
                          className={o?.mode === "auto" ? "selected" : ""}
                          onClick={() => void control(a, "auto")}
                        >
                          <Zap size={13} /> Auto
                        </button>
                        <button
                          aria-pressed={o?.mode === "manual"}
                          disabled={!controlsEnabled}
                          className={o?.mode === "manual" ? "selected" : ""}
                          onClick={() => void control(a, "manual", false)}
                        >
                          Manual
                        </button>
                      </div>
                      {o?.mode === "manual" && (
                        <p className="fine manual-warning">
                          Sensor-independent control.{" "}
                          {a === "pump"
                            ? "Check the reservoir before watering."
                            : "Temperature protection applies in Auto only."}
                        </p>
                      )}
                      <div className="toggle-row">
                        <span>
                          {!o
                            ? "Awaiting device"
                            : o.mode === "auto"
                              ? "Automatic control"
                              : "Manual activation"}
                        </span>
                        <button
                          className={`toggle ${o?.on ? "checked" : ""}`}
                          role="switch"
                          aria-checked={o?.on ?? false}
                          aria-label={`Turn ${info.name} ${o?.on ? "off" : "on"}`}
                          disabled={!controlsEnabled || o?.mode !== "manual"}
                          onClick={() => void control(a, "manual", !o?.on)}
                        >
                          <span />
                        </button>
                      </div>
                      {o?.mode === "manual" && (
                        <label className="duration">
                          Run for
                          <select
                            aria-label={`${info.name} activation duration`}
                            value={duration}
                            onChange={(e) =>
                              setDuration(Number(e.target.value))
                            }
                          >
                            <option value={30000}>30 seconds</option>
                            <option value={60000}>1 minute</option>
                            <option value={300000}>5 minutes</option>
                          </select>
                        </label>
                      )}
                      <div
                        className={`control-note ${o?.blocked ? "blocked" : ""}`}
                      >
                        {busy === a ? (
                          <>
                            <LoaderCircle size={13} className="spin" />
                            Waiting for device confirmation
                          </>
                        ) : o?.blocked ? (
                          <>
                            <CircleAlert size={13} />
                            {o.blocked}
                          </>
                        ) : o?.remaining_ms ? (
                          <>
                            <Clock3 size={13} />
                            Auto resumes in{" "}
                            {Math.ceil(
                              Math.max(
                                0,
                                o.remaining_ms -
                                  (now - Date.parse(snapshot!.received_at)),
                              ) / 1000,
                            )}
                            s
                          </>
                        ) : (
                          <>
                            <span className="tiny-dot" />
                            {!o
                              ? "Awaiting device readings"
                              : o.mode === "auto"
                                ? "Managed by sensor readings"
                                : "Manual OFF until changed"}
                          </>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
              <section className="settings-card display-card">
                <div className="panel-title">
                  <h2>OLED display</h2>
                  <button
                    className={`toggle ${snapshot?.display?.enabled ? "checked" : ""}`}
                    role="switch"
                    aria-label="OLED display"
                    aria-checked={snapshot?.display?.enabled ?? false}
                    disabled={!controlsEnabled || !snapshot?.display?.ready}
                    onClick={() => void toggleDisplay()}
                  >
                    <span />
                  </button>
                </div>
                <p>
                  {displayBusy
                    ? "Waiting for board confirmation…"
                    : !connected
                      ? "Connect the Arduino to control its display."
                      : !snapshot?.display
                        ? "Upload the latest firmware for OLED controls."
                        : !snapshot.display.ready
                          ? "OLED not detected at 0x3C or 0x3D. Check its power, GND and SDA/SCL wiring."
                          : `Board reports OLED ${snapshot.display.enabled ? "ON" : "OFF"} at 0x${snapshot.display.address?.toString(16).toUpperCase()}.`}
                </p>
                <p className="fine">
                  Starts ON after every reboot. Sensor readings are not
                  required. The board checks I²C detection; this does not
                  confirm that pixels are visible.
                </p>
              </section>
              <div className="bottom-grid">
                <section className="activity-panel">
                  <div className="panel-title">
                    <h2>Recent activity</h2>
                    <button
                      className="text-button"
                      onClick={() => setTab("history")}
                    >
                      View history <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {events.length ? (
                    events.slice(0, 3).map((e) => (
                      <div className="event" key={e.id}>
                        <span className="event-icon">
                          <Activity size={15} />
                        </span>
                        <div>
                          <strong>{e.message}</strong>
                          <time>{dateTime(e.created_at)}</time>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty">
                      Controls you use during this session will appear here.
                    </p>
                  )}
                </section>
                <aside className="care-note">
                  <span className="eyebrow">
                    <Leaf size={14} /> GROWING, TOGETHER
                  </span>
                  <h3>
                    Watering runs locally.
                    <br />
                    Your Arduino stays in control.
                  </h3>
                  <p>
                    Automatic rules run on your Arduino. Timed manual controls
                    finish on the board, even if the local connection drops.
                  </p>
                  <Sprout
                    className="note-sprout"
                    size={115}
                    strokeWidth={0.8}
                  />
                </aside>
              </div>
              <p className="estimate-note">
                <CircleHelp size={14} /> Soil moisture and water level are
                estimates using the existing firmware constants.
              </p>
            </>
          )}
          {tab === "history" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>This demo session</h2>
                  <p>One chart point per minute while this tab is open.</p>
                </div>
                <span className="subtle-tag">
                  <Clock3 size={13} />
                  {history.length} samples
                </span>
              </div>
              <div className="history-grid">
                {sensors.map((sensor) => (
                  <section className="history-card" key={sensor.key}>
                    <div className="panel-title">
                      <h3>{sensor.name}</h3>
                      <span>{sensor.unit}</span>
                    </div>
                    <Chart rows={history} sensor={sensor} large />
                    <div className="chart-axis">
                      <span>
                        {history[0]
                          ? dateTime(history[0].recorded_at)
                          : "Session started"}
                      </span>
                      <span>
                        {history.length
                          ? dateTime(history.at(-1)!.recorded_at)
                          : "Now"}
                      </span>
                    </div>
                  </section>
                ))}
              </div>
              <section className="activity-panel history-events">
                <div className="panel-title">
                  <h2>Control activity</h2>
                  <span className="subtle-tag">This demo session</span>
                </div>
                {events.map((e) => (
                  <div className="event" key={e.id}>
                    <span className="event-icon">
                      <Activity size={15} />
                    </span>
                    <div>
                      <strong>{e.message}</strong>
                      <time>{dateTime(e.created_at)}</time>
                    </div>
                  </div>
                ))}
                {!events.length && (
                  <p className="empty">
                    No controls used during this session yet.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "settings" && (
            <div className="settings-grid">
              <section className="settings-card">
                <span className="setting-icon">
                  <Settings size={22} />
                </span>
                <h2>Connect your Arduino</h2>
                {demo ? (
                  <p>
                    This is the sample demo.{" "}
                    <a className="text-button" href="/">
                      Open the real dashboard <ArrowLeft size={15} />
                    </a>
                  </p>
                ) : (
                  <form onSubmit={connect}>
                    <label>
                      Arduino IP address
                      <input
                        inputMode="url"
                        value={addressInput}
                        onChange={(e) => setAddressInput(e.target.value)}
                        placeholder="192.168.4.1"
                        required
                      />
                    </label>
                    <button className="primary" disabled={connecting}>
                      {connecting ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <Wifi size={17} />
                      )}{" "}
                      {connecting ? "Connecting…" : "Connect Arduino"}
                    </button>
                    <p className="fine">
                      Use the IP printed in Serial Monitor. Your laptop, phone
                      and Arduino must share the same Wi-Fi. No internet is
                      needed.
                    </p>
                  </form>
                )}
                <dl>
                  <div>
                    <dt>Board</dt>
                    <dd>Arduino UNO R4 WiFi</dd>
                  </div>
                  <div>
                    <dt>Sensor sampling</dt>
                    <dd>Every 2 seconds</dd>
                  </div>
                  <div>
                    <dt>Local refresh</dt>
                    <dd>Every 2 seconds</dd>
                  </div>
                  <div>
                    <dt>Chart history</dt>
                    <dd>Current browser session</dd>
                  </div>
                  <div>
                    <dt>Sensor calibration</dt>
                    <dd>Existing constants · untested</dd>
                  </div>
                  <div>
                    <dt>Output feedback</dt>
                    <dd>Board-reported pin state</dd>
                  </div>
                </dl>
                <p className="fine">
                  ON confirms the Arduino output state. The system has no
                  physical actuator feedback sensor.
                </p>
              </section>
              <section className="settings-card">
                <span className="setting-icon">
                  <Download size={22} />
                </span>
                <h2>Keep Verdant close</h2>
                <p>
                  Install the dashboard on your home screen for quick access to
                  your irrigation station.
                </p>
                <button
                  className="primary"
                  onClick={async () => {
                    if (install) {
                      await install.prompt();
                      setInstall(null);
                    } else setInstallHelp(true);
                  }}
                >
                  <Download size={17} /> Install app
                </button>
                {installHelp && (
                  <p className="install-help">
                    On Android, open this site in Chrome and select “Install
                    app” or “Add to Home screen” from the menu. On iPhone, use
                    Safari → Share → Add to Home Screen. Installation requires
                    HTTPS.
                  </p>
                )}
                <hr />
                <h3>Local demo</h3>
                <p>
                  No account, cloud service or database is used. Chart samples
                  and control activity stay in this browser tab and reset when
                  it closes or reloads.
                </p>{" "}
              </section>
              <section className="settings-card wide">
                <h2>Join your Wi-Fi</h2>
                <p>
                  First connect your laptop to Verdant-Demo (password:
                  plantdemo) and connect this dashboard to 192.168.4.1. Enter
                  your own 2.4 GHz Wi-Fi below. The Arduino remembers it after
                  restart.
                </p>
                <form onSubmit={saveWiFi} className="wifi-form">
                  <fieldset
                    disabled={
                      demo ||
                      !connected ||
                      !!snapshot?.simulated ||
                      savingWiFi ||
                      displayBusy ||
                      !!busy
                    }
                  >
                    <label>
                      Wi-Fi network name (SSID)
                      <input
                        value={wifiSSID}
                        onChange={(e) => setWifiSSID(e.target.value)}
                        maxLength={32}
                        required
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Wi-Fi password
                      <input
                        type="password"
                        value={wifiPassword}
                        onChange={(e) => setWifiPassword(e.target.value)}
                        minLength={8}
                        maxLength={63}
                        autoComplete="new-password"
                      />
                    </label>
                    <p className="fine">
                      Leave the password empty only for an open network.
                      Credentials go to the Arduino and are not stored in this
                      browser or the laptop bridge.
                    </p>
                    <button className="primary" disabled={savingWiFi}>
                      {savingWiFi ? "Saving…" : "Save & join Wi-Fi"}
                    </button>
                  </fieldset>
                </form>
                {(demo || snapshot?.simulated || !connected) && (
                  <p className="fine">
                    Connect a real Arduino to enable Wi-Fi setup. The sample
                    demo cannot change hardware Wi-Fi.
                  </p>
                )}
                {wifiMessage && (
                  <p role="status" className="notice">
                    {wifiMessage}
                  </p>
                )}
                <p className="fine">
                  Saving changes the board’s network and disconnects this
                  session. Put the laptop and phone back on your network, read
                  the Arduino’s new IP in Serial Monitor at 9600 baud, then
                  reconnect above. If joining fails, the setup hotspot returns
                  after two connection attempts.
                </p>
                <h3>Local endpoints</h3>
                <p className="fine">
                  Board:{" "}
                  <code>GET {address || "http://ARDUINO_IP"}/api/status</code>,{" "}
                  <code>POST /api/control</code>, <code>POST /api/display</code>
                  , <code>POST /api/wifi</code>. This laptop forwards requests
                  from the dashboard. Manual commands require a live connection,
                  not sensor readings.
                </p>
              </section>
              <section className="settings-card wide">
                <h2>How irrigation and ventilation work</h2>
                {ACTUATORS.map((a) => (
                  <div className="rule" key={a}>
                    <strong>
                      {actuatorInfo[a].name}
                      <span>{actuatorInfo[a].pin}</span>
                    </strong>
                    <p>{actuatorInfo[a].rule}</p>
                  </div>
                ))}
                <p className="fine">
                  Manual ON ignores sensor thresholds and sensor-based lockouts,
                  so it works without readings. Check the reservoir before
                  running the pump. Timers finish on the Arduino and return the
                  control to Auto. Auto retains low-water and DHT11 protections.
                  Restart returns both controls to Auto. Humidity is monitoring
                  only; it does not trigger watering.
                </p>
              </section>
            </div>
          )}
          <footer className="footer">
            <span>
              <Leaf size={13} /> Made for a greener everyday.
            </span>
            <span>VERDANT / SMART IRRIGATION</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">
        {[
          ["dashboard", "Dashboard", LayoutDashboard],
          ["history", "History", ChartNoAxesCombined],
          ["settings", "Settings", Settings],
        ].map(([key, label, Icon]) => {
          const I = Icon as LucideIcon;
          return (
            <button
              key={String(key)}
              aria-current={tab === key ? "page" : undefined}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(String(key));
                window.scrollTo({ top: 0 });
              }}
            >
              <I size={21} />
              <span>{String(label)}</span>
            </button>
          );
        })}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="sensor-dialog"
        onCancel={() => setDetail(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setDetail(null);
        }}
      >
        {detail && (
          <>
            <button
              className="close"
              aria-label="Close sensor details"
              onClick={() => setDetail(null)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">SENSOR DETAILS</span>
            <h2>{detail.name}</h2>
            <p>{detail.description}</p>
            <dl>
              <div>
                <dt>Connection</dt>
                <dd>{detail.pin}</dd>
              </div>
              <div>
                <dt>Current reading</dt>
                <dd>
                  {snapshot?.readings_valid === false || !snapshot?.sample_seq
                    ? "Unavailable"
                    : (snapshot?.sensors[detail.key] ?? "Unavailable")}{" "}
                  {detail.unit}
                </dd>
              </div>
              {(detail.key === "soil_percent" ||
                detail.key === "water_percent") && (
                <div>
                  <dt>Raw analog value</dt>
                  <dd>
                    {snapshot?.readings_valid === false || !snapshot?.sample_seq
                      ? "Unavailable"
                      : (snapshot?.sensors[
                          detail.key === "soil_percent"
                            ? "soil_raw"
                            : "water_raw"
                        ] ?? "Unavailable")}{" "}
                    / 1023
                  </dd>
                </div>
              )}
              <div>
                <dt>Last update</dt>
                <dd>
                  {snapshot
                    ? dateTime(snapshot.received_at)
                    : "Awaiting device"}
                </dd>
              </div>
            </dl>
            <Chart rows={history} sensor={detail} large />
          </>
        )}
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* App remains available when service workers are blocked. */
    });
  });
