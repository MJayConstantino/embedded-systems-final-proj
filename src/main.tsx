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
  WifiOff,
  ChevronRight,
  Download,
  LogOut,
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
  type Actuator,
  type Snapshot,
  type HistoryRow,
  type EventRow,
  type CommandRow,
  type Sensors,
} from "./domain";
import {
  configured,
  deviceId,
  supabase,
  loadCurrent,
  loadHistory,
  sendCommand,
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
      "DHT11 relative humidity. The atomizer starts when humidity is at most 50% and soil moisture at most 35%, with enough water.",
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
    name: "Water pump",
    label: "Soil irrigation",
    icon: Waves,
    pin: "D8 · relay, active HIGH",
    rule: "On at soil ≤30% with water ≥25%. Off at soil ≥45% or water ≤15%.",
  },
  atomizer: {
    name: "Mist atomizer",
    label: "Humidity control",
    icon: Wind,
    pin: "D11 · PWM 255/255",
    rule: "On at humidity ≤50% and soil ≤35% with water ≥20%. Off at humidity ≥60%, soil ≥45%, low water, or DHT11 failure.",
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
    [session, setSession] = useState<string | null>(null),
    [authReady, setAuthReady] = useState(demo || !configured),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [history, setHistory] = useState<HistoryRow[]>([]),
    [events, setEvents] = useState<EventRow[]>([]),
    [commands, setCommands] = useState<CommandRow[]>([]),
    [online, setOnline] = useState(navigator.onLine),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState<Actuator | null>(null),
    [detail, setDetail] = useState<(typeof sensors)[number] | null>(null),
    [duration, setDuration] = useState(60000),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [installHelp, setInstallHelp] = useState(false),
    [loginBusy, setLoginBusy] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const demoDeadline = useRef<Partial<Record<Actuator, number>>>({});
  const fresh = isFresh(snapshot, now),
    connected = online && fresh,
    controlsEnabled = connected && !busy;
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const on = () => setOnline(true),
      off = () => setOnline(false),
      onInstall = (e: Event) => {
        e.preventDefault();
        setInstall(e as InstallEvent);
      };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);
  useEffect(() => {
    if (!supabase || demo) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session?.user.id ?? null);
        setAuthReady(true);
        if (error) setError("Unable to restore sign-in. Please sign in again.");
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s?.user.id ?? null);
      setAuthReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
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
    if (demo || !session || !supabase) return;
    let active = true,
      loading = false,
      lastHistory = 0;
    const cache = `verdant:${session}:${deviceId}`;
    try {
      const stored = localStorage.getItem(cache);
      if (stored) {
        const saved = JSON.parse(stored);
        if (saved.snapshot?.device_id === deviceId) setSnapshot(saved.snapshot);
      }
    } catch {
      /* Browser storage is optional. */
    }
    async function refresh() {
      if (!navigator.onLine || document.hidden || loading) return;
      loading = true;
      try {
        const current = await loadCurrent();
        if (!active) return;
        setSnapshot(current.snapshot);
        setCommands(current.commands);
        setError("");
        try {
          localStorage.setItem(
            cache,
            JSON.stringify({ snapshot: current.snapshot }),
          );
        } catch {
          /* Storage quota can be disabled. */
        }
        if (Date.now() - lastHistory > 60000) {
          const h = await loadHistory();
          if (active) {
            setHistory(h.history);
            setEvents(h.events);
          }
          lastHistory = Date.now();
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Could not refresh the cloud connection.",
          );
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [session, demo]);
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
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoginBusy(true);
    try {
      const { error } = await supabase!.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      setPassword("");
    } catch {
      setError("Sign-in failed. Check your project email and password.");
    } finally {
      setLoginBusy(false);
    }
  }
  async function logout() {
    const result = await supabase?.auth.signOut({ scope: "local" });
    if (result?.error) {
      setError(
        "Could not complete sign-out. Check your connection and try again.",
      );
      return;
    }
    if (session)
      try {
        localStorage.removeItem(`verdant:${session}:${deviceId}`);
      } catch {
        /* Optional cache. */
      }
    setSession(null);
    setSnapshot(null);
    setHistory([]);
    setCommands([]);
    setEvents([]);
  }
  async function control(a: Actuator, mode: "auto" | "manual", on = false) {
    if (!controlsEnabled || !snapshot) return;
    setBusy(a);
    setError("");
    const input = {
      device_id: demo ? snapshot.device_id : deviceId,
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
        const c = await sendCommand(input);
        setCommands((cs) => [
          c,
          ...cs.filter((x) => x.actuator !== a || x.status !== "pending"),
        ]);
        setToast("Request sent. Waiting for the Arduino to confirm.");
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
        <span className="project-label">SMART PLANT SYSTEM</span>
        <span className="avatar" aria-label="Project team">
          SP
        </span>
      </div>
    </header>
  );
  if (!authReady)
    return (
      <>
        {header}
        <main className="login">
          <LoaderCircle className="spin" />
          <p>Restoring your session…</p>
        </main>
      </>
    );
  if (!demo && !session)
    return (
      <>
        {header}
        <main className="login">
          <div className="login-art">
            <div className="orb">
              <Sprout size={80} strokeWidth={1.3} />
            </div>
            <span className="eyebrow">A LITTLE CARE. A LOT OF GROWTH.</span>
            <h1>
              Your plants,
              <br />
              <em>connected.</em>
            </h1>
            <p>
              A closer look at your growing environment.
              <br />
              Live readings. Thoughtful control.
            </p>
          </div>
          <section className="login-panel">
            <span className="eyebrow">WELCOME TO VERDANT</span>
            <h2>Your growing space</h2>
            <p>Sign in with your shared project account.</p>
            {configured ? (
              <form onSubmit={login}>
                <label>
                  Project email
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="team@example.com"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={loginBusy || !online}>
                  {loginBusy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <>
                      Sign in <ArrowUpRight size={18} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <div className="setup-note">
                <SlidersHorizontal size={22} />
                <div>
                  <strong>Your dashboard is ready to connect</strong>
                  <p>
                    Add your Supabase project settings to enable sign-in and
                    live hardware data. The setup guide includes each step.
                  </p>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <a className="demo-link" href="/?demo=1">
              Explore the interactive demo <ArrowUpRight size={16} />
            </a>
            <p className="fine">
              One plant system. A shared view for your team.
            </p>
          </section>
        </main>
      </>
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
              <p>Stay close to your plant’s environment, wherever you are.</p>
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
              <span className="eyebrow">YOUR GROWING SPACE</span>
              <h1>
                {tab === "dashboard"
                  ? "A little closer to nature."
                  : tab === "history"
                    ? "Every reading tells a story."
                    : "Make yourself at home."}
              </h1>
              <p>
                {tab === "dashboard"
                  ? "A live look at your plant’s environment, all in one place."
                  : tab === "history"
                    ? "Look back at the last 24 hours of your growing environment."
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
          {!online && (
            <div className="notice" role="status">
              <WifiOff size={18} /> You’re offline. Showing saved readings;
              remote controls are unavailable.
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
              <strong>Plant station 01</strong>
              <span>
                Arduino UNO R4 WiFi <span className="separator">/</span> Indoor
                growing system
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
              Last device reading: {dateTime(snapshot.received_at)}. Controls
              will return when fresh readings arrive.
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
                  {demo ? "Sample data" : "Synced every 10 seconds"}
                </span>
              </div>
              <div className="sensor-grid">
                {sensors.map((sensor) => {
                  const Icon = sensor.icon,
                    value = snapshot?.sensors[sensor.key],
                    invalid = value === null || value === undefined;
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
                  <h2>Plant care controls</h2>
                  <p>A helping hand, when your plants need one.</p>
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
                  const pending = commands.find(
                    (c) =>
                      c.actuator === a &&
                      c.status === "pending" &&
                      (c.delivered_at || Date.parse(c.expires_at) > now),
                  );
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
                          disabled={!controlsEnabled || !!pending}
                          className={o?.mode === "auto" ? "selected" : ""}
                          onClick={() => void control(a, "auto")}
                        >
                          <Zap size={13} /> Auto
                        </button>
                        <button
                          aria-pressed={o?.mode === "manual"}
                          disabled={!controlsEnabled || !!pending}
                          className={o?.mode === "manual" ? "selected" : ""}
                          onClick={() => void control(a, "manual", false)}
                        >
                          Manual
                        </button>
                      </div>
                      <div className="toggle-row">
                        <span>
                          {o?.mode === "auto"
                            ? "Automatic control"
                            : "Manual activation"}
                        </span>
                        <button
                          className={`toggle ${o?.on ? "checked" : ""}`}
                          role="switch"
                          aria-checked={o?.on ?? false}
                          aria-label={`Turn ${info.name} ${o?.on ? "off" : "on"}`}
                          disabled={
                            !controlsEnabled ||
                            o?.mode !== "manual" ||
                            !!pending
                          }
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
                        {busy === a || pending ? (
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
                            {o?.mode === "auto"
                              ? "Managed by sensor readings"
                              : "Manual OFF until changed"}
                          </>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
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
                      Control events will appear here when the device connects.
                    </p>
                  )}
                </section>
                <aside className="care-note">
                  <span className="eyebrow">
                    <Leaf size={14} /> GROWING, TOGETHER
                  </span>
                  <h3>
                    Care continues.
                    <br />
                    Even when you’re away.
                  </h3>
                  <p>
                    Automatic rules run on your Arduino. Timed manual controls
                    finish on the board, even if the internet disconnects.
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
                  <h2>Last 24 hours</h2>
                  <p>
                    One stored sample per minute · gaps mean no valid reading.
                  </p>
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
                          : "24 hours ago"}
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
                  <span className="subtle-tag">Last 24 hours</span>
                </div>
                {commands.map((c) => (
                  <div className="event" key={c.id}>
                    <span className="event-icon">
                      <SlidersHorizontal size={15} />
                    </span>
                    <div>
                      <strong>
                        {actuatorInfo[c.actuator].name} ·{" "}
                        {c.mode === "auto"
                          ? "Auto"
                          : c.on
                            ? "Manual ON"
                            : "Manual OFF"}
                      </strong>
                      <time>
                        {dateTime(c.created_at)} ·{" "}
                        {c.reason ??
                          "Output confirmation is reported by the board"}
                      </time>
                    </div>
                    <span className="command-status">
                      {c.status === "pending" &&
                      !c.delivered_at &&
                      Date.parse(c.expires_at) < now
                        ? "expired"
                        : c.status}
                    </span>
                  </div>
                ))}
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
                {!events.length && !commands.length && (
                  <p className="empty">
                    No control events in the last 24 hours.
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
                <h2>Your plant station</h2>
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
                    <dt>Cloud exchange</dt>
                    <dd>Every 10 seconds</dd>
                  </div>
                  <div>
                    <dt>History retention</dt>
                    <dd>24 hours</dd>
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
                  your plant station.
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
                <h3>Project account</h3>
                <p>
                  {demo
                    ? "You’re exploring the demo."
                    : email || "Shared project team account"}
                </p>
                {demo ? (
                  <a className="text-button" href="/">
                    Return to sign in <ArrowLeft size={15} />
                  </a>
                ) : (
                  <button className="text-button" onClick={() => void logout()}>
                    <LogOut size={16} /> Sign out
                  </button>
                )}
              </section>
              <section className="settings-card wide">
                <h2>How automatic care works</h2>
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
                  Manual ON bypasses activation thresholds, but retains
                  low-water and DHT11 protections. A protective stop cancels
                  manual activation and leaves it OFF until another command.
                  Restart returns all controls to Auto.
                </p>
              </section>
            </div>
          )}
          <footer className="footer">
            <span>
              <Leaf size={13} /> Made for a greener everyday.
            </span>
            <span>VERDANT / SMART PLANT SYSTEM</span>
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
                  {snapshot?.sensors[detail.key] ?? "Unavailable"} {detail.unit}
                </dd>
              </div>
              {(detail.key === "soil_percent" ||
                detail.key === "water_percent") && (
                <div>
                  <dt>Raw analog value</dt>
                  <dd>
                    {snapshot?.sensors[
                      detail.key === "soil_percent" ? "soil_raw" : "water_raw"
                    ] ?? "Unavailable"}{" "}
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
