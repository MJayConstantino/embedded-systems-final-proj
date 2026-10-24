// Smart Plant System - Starter Firmware
// Target board: Arduino UNO R4 WiFi

#include <Wire.h>
#include <DHT.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ===================== USER SETTINGS =====================

// Change this value, then select the same baud rate in Serial Monitor.
const unsigned long SERIAL_BAUD_RATE = 9600;

// Serial values are printed continuously once every second.
// This is a non-blocking interval, so the actuators and sensors can still run.
const unsigned long SERIAL_PRINT_INTERVAL_MS = 1000;

// OLED refresh rate. Change this value to control how often the screen updates.
// 500 ms = twice per second, 1000 ms = once per second.
const unsigned long OLED_UPDATE_INTERVAL_MS = 2000;

// Sensor sampling. DHT11 should not be read faster than about once per second.
const unsigned long SENSOR_READ_INTERVAL_MS = 2000;
const unsigned long SENSOR_STABILIZATION_MS = 3000;

// === Sensor Pins ===
#define soilMoistureSensor A0
#define dhtSensorPin       A2
#define waterLevelSensor   A1

// === Actuator Pins ===
#define fanPin             5
#define atomizerPin        11
#define relayWaterPump     8

// === Display Pins (UNO R4 hardware I2C) ===
#define oledSDA            18
#define oledSCL            19

// === Sensor and display types ===
#define DHT_TYPE DHT11
const uint8_t OLED_ADDRESS = 0x3C;
const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;

// === Analog calibration ===
// Replace these after observing the RAW values in Serial Monitor.
// Typical capacitive soil sensors produce a lower value when wet.
const int SOIL_RAW_WET = 300;
const int SOIL_RAW_DRY = 800;

const int WATER_RAW_EMPTY = 0;
const int WATER_RAW_FULL = 700;

// === Fan thresholds (with hysteresis) ===
// Fan turns ON at or above FAN_ON_TEMPERATURE_C and turns OFF at or below
// FAN_OFF_TEMPERATURE_C. Two thresholds prevent rapid ON/OFF switching.
const float FAN_ON_TEMPERATURE_C = 30.0;
const float FAN_OFF_TEMPERATURE_C = 28.0;
const uint8_t FAN_PWM_VALUE = 220;       // 0 = off, 255 = full speed

// === Pump behavior ===
// IRRIGATION_PUMP: waters dry soil and stops if the reservoir is too low.
// REFILL_PUMP: fills a reservoir when its water level is low.
enum PumpControlMode { IRRIGATION_PUMP, REFILL_PUMP };
const PumpControlMode PUMP_MODE = IRRIGATION_PUMP;

// Irrigation-pump thresholds
const int PUMP_ON_SOIL_PERCENT = 30;
const int PUMP_OFF_SOIL_PERCENT = 45;
const int PUMP_MIN_WATER_ON_PERCENT = 25;
const int PUMP_LOW_WATER_STOP_PERCENT = 15;

// Reservoir-refill thresholds (used only when PUMP_MODE is REFILL_PUMP)
const int REFILL_PUMP_ON_PERCENT = 25;
const int REFILL_PUMP_OFF_PERCENT = 75;

// Many relay boards are active LOW. Change to false if yours is active HIGH.
const bool RELAY_ACTIVE_LOW = false;

// === Atomizer thresholds (with hysteresis) ===
// It starts only when BOTH the air humidity and soil moisture are low.
// It stops when EITHER reading has recovered, or the reservoir is too low.
const float ATOMIZER_ON_HUMIDITY_PERCENT = 50.0;
const float ATOMIZER_OFF_HUMIDITY_PERCENT = 60.0;
const int ATOMIZER_ON_SOIL_PERCENT = 35;
const int ATOMIZER_OFF_SOIL_PERCENT = 45;
const int ATOMIZER_MIN_WATER_PERCENT = 20;
const uint8_t ATOMIZER_PWM_VALUE = 255;

// ===================== OBJECTS AND STATE =====================

DHT dht(dhtSensorPin, DHT_TYPE);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);

bool oledReady = false;
bool fanIsOn = false;
bool pumpIsOn = false;
bool atomizerIsOn = false;

int soilRaw = 0;
int waterRaw = 0;
int soilPercent = 0;
int waterPercent = 0;
float temperatureC = NAN;
float humidityPercent = NAN;

unsigned long lastSensorReadMillis = 0;
unsigned long lastSerialPrintMillis = 0;
unsigned long lastOLEDUpdateMillis = 0;
unsigned long serialPrintCount = 0;

// ===================== HELPER FUNCTIONS =====================

int percentageFromRaw(int rawValue, int rawAtZero, int rawAtHundred) {
  long percentage = map(rawValue, rawAtZero, rawAtHundred, 0, 100);
  return constrain(percentage, 0, 100);
}

void setFan(bool turnOn) {
  fanIsOn = turnOn;
  analogWrite(fanPin, turnOn ? FAN_PWM_VALUE : 0);
}

void setAtomizer(bool turnOn) {
  atomizerIsOn = turnOn;
  analogWrite(atomizerPin, turnOn ? ATOMIZER_PWM_VALUE : 0);
}

void setPump(bool turnOn) {
  pumpIsOn = turnOn;

  if (RELAY_ACTIVE_LOW) {
    digitalWrite(relayWaterPump, turnOn ? LOW : HIGH);
  } else {
    digitalWrite(relayWaterPump, turnOn ? HIGH : LOW);
  }
}

void turnAllActuatorsOff() {
  setFan(false);
  setAtomizer(false);
  setPump(false);
}

void readSensors() {
  soilRaw = analogRead(soilMoistureSensor);
  waterRaw = analogRead(waterLevelSensor);

  soilPercent = percentageFromRaw(soilRaw, SOIL_RAW_DRY, SOIL_RAW_WET);
  waterPercent = percentageFromRaw(waterRaw, WATER_RAW_EMPTY, WATER_RAW_FULL);

  float newHumidity = dht.readHumidity();
  float newTemperature = dht.readTemperature();

  if (isnan(newHumidity) || isnan(newTemperature)) {
    humidityPercent = NAN;
    temperatureC = NAN;
    Serial.println(F("WARNING: DHT11 reading failed; fan and atomizer forced OFF."));
  } else {
    humidityPercent = newHumidity;
    temperatureC = newTemperature;
  }
}

void updateFan() {
  if (isnan(temperatureC)) {
    setFan(false);
    return;
  }

  if (!fanIsOn && temperatureC >= FAN_ON_TEMPERATURE_C) {
    setFan(true);
  } else if (fanIsOn && temperatureC <= FAN_OFF_TEMPERATURE_C) {
    setFan(false);
  }
}

void updatePump() {
  if (PUMP_MODE == REFILL_PUMP) {
    // Use this only when the pump ADDS water to the measured reservoir.
    if (!pumpIsOn && waterPercent <= REFILL_PUMP_ON_PERCENT) {
      setPump(true);
    } else if (pumpIsOn && waterPercent >= REFILL_PUMP_OFF_PERCENT) {
      setPump(false);
    }
    return;
  }

  // Default: irrigation pump. Water level acts as a dry-run safety lockout.
  if (!pumpIsOn &&
      soilPercent <= PUMP_ON_SOIL_PERCENT &&
      waterPercent >= PUMP_MIN_WATER_ON_PERCENT) {
    setPump(true);
  } else if (pumpIsOn &&
             (soilPercent >= PUMP_OFF_SOIL_PERCENT ||
              waterPercent <= PUMP_LOW_WATER_STOP_PERCENT)) {
    setPump(false);
  }
}

void updateAtomizer() {
  if (isnan(humidityPercent)) {
    setAtomizer(false);
    return;
  }

  if (!atomizerIsOn &&
      humidityPercent <= ATOMIZER_ON_HUMIDITY_PERCENT &&
      soilPercent <= ATOMIZER_ON_SOIL_PERCENT &&
      waterPercent >= ATOMIZER_MIN_WATER_PERCENT) {
    setAtomizer(true);
  } else if (atomizerIsOn &&
             (humidityPercent >= ATOMIZER_OFF_HUMIDITY_PERCENT ||
              soilPercent >= ATOMIZER_OFF_SOIL_PERCENT ||
              waterPercent < ATOMIZER_MIN_WATER_PERCENT)) {
    setAtomizer(false);
  }
}

void updateActuators() {
  updateFan();
  updatePump();
  updateAtomizer();
}

void printSerialMonitor() {
  serialPrintCount++;
  Serial.println(F("----------------------------------------"));

  Serial.print(F("Serial update #"));
  Serial.print(serialPrintCount);
  Serial.print(F(" | Uptime: "));
  Serial.print(millis() / 1000);
  Serial.println(F(" s"));

  Serial.print(F("Soil moisture: "));
  Serial.print(soilPercent);
  Serial.print(F("% (raw: "));
  Serial.print(soilRaw);
  Serial.println(F(")"));

  Serial.print(F("Water level:   "));
  Serial.print(waterPercent);
  Serial.print(F("% (raw: "));
  Serial.print(waterRaw);
  Serial.println(F(")"));

  Serial.print(F("Temperature:   "));
  if (isnan(temperatureC)) Serial.print(F("ERROR"));
  else {
    Serial.print(temperatureC, 1);
    Serial.print(F(" C"));
  }
  Serial.println();

  Serial.print(F("Humidity:      "));
  if (isnan(humidityPercent)) Serial.print(F("ERROR"));
  else {
    Serial.print(humidityPercent, 1);
    Serial.print(F("%"));
  }
  Serial.println();

  Serial.print(F("Fan: "));
  Serial.print(fanIsOn ? F("ON") : F("OFF"));
  Serial.print(F(" | Pump: "));
  Serial.print(pumpIsOn ? F("ON") : F("OFF"));
  Serial.print(F(" | Atomizer: "));
  Serial.println(atomizerIsOn ? F("ON") : F("OFF"));
}

void updateOLED() {
  if (!oledReady) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  display.print(F("Soil:  "));
  display.print(soilPercent);
  display.println(F("%"));

  display.print(F("Water: "));
  display.print(waterPercent);
  display.println(F("%"));

  display.print(F("Temp:  "));
  if (isnan(temperatureC)) display.println(F("ERROR"));
  else {
    display.print(temperatureC, 1);
    display.println(F(" C"));
  }

  display.print(F("Hum:   "));
  if (isnan(humidityPercent)) display.println(F("ERROR"));
  else {
    display.print(humidityPercent, 1);
    display.println(F("%"));
  }

  display.print(F("Fan:"));
  display.print(fanIsOn ? F("ON ") : F("OFF"));
  display.print(F(" Pump:"));
  display.println(pumpIsOn ? F("ON") : F("OFF"));

  display.print(F("Atomizer: "));
  display.println(atomizerIsOn ? F("ON") : F("OFF"));

  display.display();
}

#include "LocalControl.h"

// ===================== ARDUINO SETUP AND LOOP =====================

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  // Configure outputs and immediately place every actuator in its OFF state.
  pinMode(fanPin, OUTPUT);
  pinMode(atomizerPin, OUTPUT);
  pinMode(relayWaterPump, OUTPUT);
  turnAllActuatorsOff();

  // Give the USB Serial Monitor a short opportunity to connect, but never
  // block the system permanently when it is running without a computer.
  unsigned long serialWaitStarted = millis();
  while (!Serial && millis() - serialWaitStarted < 3000) {
    // Wait for up to three seconds only.
  }

  analogReadResolution(10); // UNO R4: use a 0-1023 range for this calibration.
  dht.begin();

  // UNO R4 uses its fixed hardware SDA/SCL pins when Wire.begin() is called.
  Wire.begin();
  oledReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);

  if (!oledReady) {
    Serial.println(F("WARNING: OLED not detected. Check address and wiring."));
  } else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println(F("System starting..."));
    display.println(F("Actuators: OFF"));
    display.display();
  }

  Serial.println(F("Smart plant system starting."));
  Serial.print(F("Serial baud rate: "));
  Serial.println(SERIAL_BAUD_RATE);
  Serial.println(F("Sensor values will print continuously every 1 second."));
  Serial.print(F("OLED refresh interval: "));
  Serial.print(OLED_UPDATE_INTERVAL_MS);
  Serial.println(F(" ms"));
  Serial.println(F("Actuators remain OFF while sensors stabilize."));
  initializeLocalWiFi();
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - lastSensorReadMillis >= SENSOR_READ_INTERVAL_MS) {
    lastSensorReadMillis = currentMillis;

    readSensors();
    sampleSequence++;

    if (currentMillis >= SENSOR_STABILIZATION_MS) {
      applyLocalControl();
    } else {
      turnAllActuatorsOff();
    }
  }

  serviceManualTimers();
  serviceLocalServer();

  // Print continuously every second, independently of the DHT11 read rate.
  // The DHT11 values update every two seconds, while their latest values are
  // still shown here once per second.
  if (currentMillis - lastSerialPrintMillis >= SERIAL_PRINT_INTERVAL_MS) {
    lastSerialPrintMillis = currentMillis;
    printSerialMonitor();
  }

  // Refresh the OLED on its own independent, non-blocking timer.
  if (currentMillis - lastOLEDUpdateMillis >= OLED_UPDATE_INTERVAL_MS) {
    lastOLEDUpdateMillis = currentMillis;
    updateOLED();
  }
}
