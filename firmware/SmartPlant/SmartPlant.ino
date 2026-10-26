// Verdant Smart Irrigation - Arduino UNO R4 WiFi
// Target board: Arduino UNO R4 WiFi

#include <Wire.h>
#include <WiFiS3.h>
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
// Retired mist driver: keep D11 LOW. Disconnect the damaged module.
const uint8_t RETIRED_MIST_PIN = 11;
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

const int PUMP_ON_SOIL_PERCENT = 30;
const int PUMP_OFF_SOIL_PERCENT = 45;
const int PUMP_MIN_WATER_ON_PERCENT = 25;
const int PUMP_LOW_WATER_STOP_PERCENT = 15;

// Many relay boards are active LOW. Change to false if yours is active HIGH.
const bool RELAY_ACTIVE_LOW = false;

// ===================== OBJECTS AND STATE =====================

DHT dht(dhtSensorPin, DHT_TYPE);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);

bool oledReady = false;
bool oledEnabled = true; // Always ON after reboot; remote OFF is not persisted.
uint8_t oledAddress = OLED_ADDRESS;
bool fanIsOn = false;
bool pumpIsOn = false;

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
    Serial.println(F("WARNING: DHT11 reading failed; fan forced OFF. Soil-based irrigation remains available."));
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

void updateActuators() {
  updateFan();
  updatePump();
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
  Serial.println(pumpIsOn ? F("ON") : F("OFF"));
  Serial.print(F("OLED: "));Serial.println(!oledReady?F("NOT DETECTED"):oledEnabled?F("ON"):F("OFF"));
}

void updateOLED() {
  if (!oledReady || !oledEnabled) return;

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

  display.print(F("IP:"));
  display.println(WiFi.localIP());

  display.display();
}

bool setOLEDEnabled(bool enabled) {
  if(!oledReady)return false;
  oledEnabled=enabled;
  display.ssd1306_command(enabled?SSD1306_DISPLAYON:SSD1306_DISPLAYOFF);
  if(enabled)updateOLED();
  return true;
}
bool oledResponds(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission()==0;
}
#include "LocalControl.h"

// ===================== ARDUINO SETUP AND LOOP =====================

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  // Configure outputs and immediately place every actuator in its OFF state.
  pinMode(fanPin, OUTPUT);
  digitalWrite(RETIRED_MIST_PIN, LOW);
  pinMode(RETIRED_MIST_PIN, OUTPUT);
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
  oledEnabled = true;
  const bool foundDefault=oledResponds(OLED_ADDRESS);
  oledAddress=foundDefault?OLED_ADDRESS:0x3D;
  const bool detected=foundDefault||oledResponds(oledAddress);
  oledReady = detected && display.begin(SSD1306_SWITCHCAPVCC, oledAddress);
  if(oledReady){
    display.ssd1306_command(SSD1306_DISPLAYON);
    Serial.print(F("OLED detected at 0x"));Serial.println(oledAddress, HEX);
  }

  if (!oledReady) {
    Serial.println(F("OLED unavailable. Checked 0x3C and 0x3D. Check power, GND and hardware SDA/SCL wiring."));
  } else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println(F("System starting..."));
    display.println(F("Actuators: OFF"));
    display.display();
  }

  Serial.println(F("Verdant irrigation system starting."));
  Serial.print(F("Serial baud rate: "));
  Serial.println(SERIAL_BAUD_RATE);
  Serial.println(F("Sensor values will print continuously every 1 second."));
  Serial.print(F("OLED refresh interval: "));
  Serial.print(OLED_UPDATE_INTERVAL_MS);
  Serial.println(F(" ms"));
  Serial.println(F("Auto waits for sensors. Timed Manual control is available without readings."));
  initializeLocalWiFi();
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - lastSensorReadMillis >= SENSOR_READ_INTERVAL_MS) {
    lastSensorReadMillis = currentMillis;

    readSensors();
    sampleSequence++;

    applyLocalControl(); // Manual remains available while sensors stabilize.
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
