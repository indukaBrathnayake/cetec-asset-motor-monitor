/*
 * ============================================================
 * CETEC Asset Motor Monitor — ESP32 WiFi Telemetry Sender
 * ============================================================
 * Replaces the old Bluetooth (BLE) link. Each pump's ESP32
 * connects to the site WiFi router and pushes vibration /
 * frequency data to Firebase Realtime Database over HTTPS.
 *
 * Cloud path written:
 *   /telemetry/{PUMP_ID}/latest = { v, freq, fault, sev, ts }
 *
 * Libraries (Arduino IDE → Library Manager):
 *   - WiFi.h            (built into ESP32 core)
 *   - HTTPClient.h      (built into ESP32 core)
 *   - ArduinoJson       (by Benoit Blanchon)
 *
 * NOTE: while the frequency-capture front-end hardware is under
 * construction, set SIMULATE_SENSOR to 1 to stream synthetic
 * data — this lets you verify the full ESP32 → WiFi → Firebase
 * → dashboard chain end-to-end.
 * ============================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ---------------- CONFIGURATION ----------------
#define SIMULATE_SENSOR 1              // 1 = synthetic data, 0 = real sensor

const char* WIFI_SSID     = "SITE_ROUTER_SSID";
const char* WIFI_PASSWORD = "SITE_ROUTER_PASSWORD";

// Firebase (Realtime Database REST API)
const char* FIREBASE_HOST = "YOUR_PROJECT-default-rtdb.firebaseio.com";
const char* FIREBASE_AUTH = "YOUR_DATABASE_SECRET_OR_ID_TOKEN"; // see README security notes

const char* PUMP_ID       = "p01";     // must match the pump ID created in the admin panel

const float  VIB_WARN     = 4.5;       // mm/s (ISO 10816 Zone C, typical)
const float  VIB_ALERT    = 7.1;       // mm/s (ISO 10816 Zone D, typical)
const uint32_t SEND_INTERVAL_MS = 2000;

// ---------------- STATE ----------------
uint32_t lastSend = 0;

void setup() {
  Serial.begin(115200);
  connectWiFi();
}

void connectWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi OK  IP: %s\n", WiFi.localIP().toString().c_str());
}

// ---------------- SENSOR ----------------
// Replace this with the real frequency-capture device driver
// (e.g. MPU6050 / ADXL355 FFT pipeline) when hardware is ready.
float readVibrationRMS() {
#if SIMULATE_SENSOR
  static float drift = 0;
  if (random(0, 1000) < 3) drift += 0.8;          // occasional degradation
  if (drift > 0) drift -= 0.02;
  return 1.5 + drift + (random(-40, 40) / 100.0);
#else
  // TODO: return RMS velocity (mm/s) from the sensor front-end
  return 0.0;
#endif
}

float readDominantFreq() {
#if SIMULATE_SENSOR
  return 48.0 + random(0, 40) / 10.0;
#else
  // TODO: return dominant frequency (Hz) from FFT
  return 0.0;
#endif
}

// Simple on-device classification. Later this can be replaced /
// augmented by the CNN-LSTM model server-side.
const char* classifyFault(float v, const char*& sev) {
  if (v >= VIB_ALERT) { sev = "ALERT"; return "Severe Vibration"; }
  if (v >= VIB_WARN)  { sev = "WARN";  return "Elevated Vibration"; }
  sev = "OK";
  return "Normal";
}

// ---------------- CLOUD PUSH ----------------
void pushTelemetry(float v, float freq, const char* fault, const char* sev) {
  if (WiFi.status() != WL_CONNECTED) { connectWiFi(); return; }

  StaticJsonDocument<256> doc;
  doc["v"]     = round(v * 100) / 100.0;
  doc["freq"]  = round(freq * 10) / 10.0;
  doc["fault"] = fault;
  doc["sev"]   = sev;
  doc["ts"]    = (uint64_t)time(nullptr) * 1000ULL; // ms epoch (enable NTP for accuracy)

  String body;
  serializeJson(doc, body);

  String url = String("https://") + FIREBASE_HOST +
               "/telemetry/" + PUMP_ID + "/latest.json?auth=" + FIREBASE_AUTH;

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(body);
  Serial.printf("[%s] v=%.2f sev=%s → HTTP %d\n", PUMP_ID, v, sev, code);
  http.end();
}

void loop() {
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    float v    = readVibrationRMS();
    float freq = readDominantFreq();
    const char* sev;
    const char* fault = classifyFault(v, sev);
    pushTelemetry(v, freq, fault, sev);
  }
}
