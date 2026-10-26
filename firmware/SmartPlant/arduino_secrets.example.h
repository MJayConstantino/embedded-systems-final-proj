#pragma once
// First-time setup: join Verdant-Demo, then use dashboard Settings to enter your own Wi-Fi.
// The board remembers app-configured credentials in EEPROM; they take precedence over this file.
// Optional existing-router mode: copy to arduino_secrets.h, set true, then enter Wi-Fi credentials.
#define USE_EXISTING_WIFI false
#define SECRET_SSID "YOUR_WIFI_NAME"
#define SECRET_PASS "YOUR_WIFI_PASSWORD"
#define DEMO_AP_SSID "Verdant-Demo"
#define DEMO_AP_PASS "plantdemo"
