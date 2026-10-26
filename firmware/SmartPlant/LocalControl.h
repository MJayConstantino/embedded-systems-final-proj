#pragma once
#include <WiFiS3.h>
#include <ArduinoJson.h>
#if __has_include("arduino_secrets.h")
#include "arduino_secrets.h"
#else
#include "arduino_secrets.example.h"
#endif
#ifndef USE_EXISTING_WIFI
#define USE_EXISTING_WIFI false
#endif
#ifndef DEMO_AP_SSID
#define DEMO_AP_SSID "Verdant-Demo"
#define DEMO_AP_PASS "plantdemo"
#endif

// Local demo only. Sensors, actuator timers, OLED and Serial remain owned by the board.
const int ACTUATOR_COUNT = 2;
const char* actuatorNames[ACTUATOR_COUNT] = {"fan", "pump"};
struct ManualState {
  bool manual=false,requestedOn=false;
  unsigned long deadline=0;
  String blocked,lastId,lastStatus,lastReason;
};
ManualState manualState[ACTUATOR_COUNT];
unsigned long sampleSequence=0;
String bootSession;
WiFiServer localServer(80);
WiFiClient localClient;
String requestHeader,requestBody;
unsigned long requestStarted=0,nextReconnect=0;
int bodyLength=0;
bool headersComplete=false,serverReady=false;

bool outputOn(int i){return i==0?fanIsOn:pumpIsOn;}
void writeOutput(int i,bool on){if(i==0)setFan(on);else if(i==1)setPump(on);}
String protectiveReason(int i,bool starting){
  if(i==0&&(isnan(temperatureC)||isnan(humidityPercent)))return "DHT11 reading failed";
  if(i==1&&waterPercent<(starting?PUMP_MIN_WATER_ON_PERCENT:PUMP_LOW_WATER_STOP_PERCENT+1))return "Reservoir too low";
  return "";
}
void serviceManualTimers(){
  for(int i=0;i<ACTUATOR_COUNT;i++){
    ManualState& m=manualState[i];if(!m.manual||!m.requestedOn)continue;
    if((int32_t)(millis()-m.deadline)>=0){m.manual=false;m.requestedOn=false;m.blocked="";writeOutput(i,false);continue;}
  }
}
void applyLocalControl(){
  serviceManualTimers();
  bool ready=millis()>=SENSOR_STABILIZATION_MS&&sampleSequence>0;
  if(manualState[0].manual)setFan(manualState[0].requestedOn);else if(ready)updateFan();else setFan(false);
  if(manualState[1].manual)setPump(manualState[1].requestedOn);else if(ready)updatePump();else setPump(false);
}
void fillTelemetry(JsonObject doc){
  JsonObject screen=doc["display"].to<JsonObject>();screen["ready"]=oledReady;screen["enabled"]=oledReady&&oledEnabled;
  if(oledReady)screen["address"]=oledAddress;else screen["address"]=nullptr;
  doc["device_id"]="plant-station-01";doc["session_id"]=bootSession;doc["sample_seq"]=sampleSequence;doc["uptime_ms"]=millis();doc["sample_age_ms"]=sampleSequence?millis()-lastSensorReadMillis:millis();doc["simulated"]=false;
  JsonObject s=doc["sensors"].to<JsonObject>();s["soil_raw"]=soilRaw;s["water_raw"]=waterRaw;s["soil_percent"]=soilPercent;s["water_percent"]=waterPercent;
  bool valid=!isnan(temperatureC)&&!isnan(humidityPercent);s["dht_valid"]=valid;
  if(valid){s["temperature_c"]=temperatureC;s["humidity_percent"]=humidityPercent;}else{s["temperature_c"]=nullptr;s["humidity_percent"]=nullptr;}
  for(int i=0;i<ACTUATOR_COUNT;i++){
    ManualState& m=manualState[i];JsonObject o=doc["actuators"][actuatorNames[i]].to<JsonObject>();o["mode"]=m.manual?"manual":"auto";o["on"]=outputOn(i);
    o["remaining_ms"]=m.manual&&m.requestedOn?(unsigned long)max(0L,(long)(m.deadline-millis())):0;
    String blocked=m.manual?m.blocked:protectiveReason(i,!outputOn(i));if(blocked.length())o["blocked"]=blocked;else o["blocked"]=nullptr;
  }
}
void sendJson(JsonDocument& doc,int status=200){
  String body;serializeJson(doc,body);
  localClient.print(F("HTTP/1.1 "));localClient.print(status);localClient.println(status==200?F(" OK"):F(" Error"));
  localClient.println(F("Content-Type: application/json"));localClient.println(F("Cache-Control: no-store"));localClient.println(F("Connection: close"));
  localClient.print(F("Content-Length: "));localClient.println(body.length());localClient.println();localClient.print(body);localClient.stop();
}
void sendError(const char* message,int status){JsonDocument error;error["error"]=message;sendJson(error,status);}
bool validRequestId(const String& id){if(id.length()!=36)return false;for(unsigned int i=0;i<id.length();i++)if(!isxdigit(id[i])&&id[i]!='-')return false;return true;}
void executeControl(){
  JsonDocument command;if(deserializeJson(command,requestBody)){sendError("Invalid JSON",400);return;}
  String actuator=command["actuator"]|"",mode=command["mode"]|"",id=command["id"]|"";
  int i=-1;for(int j=0;j<ACTUATOR_COUNT;j++)if(actuator==actuatorNames[j])i=j;
  if(i<0||!validRequestId(id)||(mode!="auto"&&mode!="manual")||!command["on"].is<bool>()||!command["duration_ms"].is<unsigned long>()){sendError("Invalid control request",400);return;}
  bool on=command["on"];unsigned long duration=command["duration_ms"];
  if((mode=="auto"&&on)||((mode=="auto"||!on)&&duration!=0)||(mode=="manual"&&on&&duration!=30000&&duration!=60000&&duration!=300000)){sendError("Invalid activation duration",400);return;}
  ManualState& m=manualState[i];
  if(id!=m.lastId){
    String reason;
    if(String(command["session_id"]|"")!=bootSession)reason="Board session changed";
    if(!reason.length()){m.manual=mode=="manual";m.requestedOn=m.manual&&on;m.deadline=millis()+duration;m.blocked="";writeOutput(i,m.requestedOn);applyLocalControl();}
    m.lastId=id;m.lastStatus=reason.length()?"rejected":"applied";m.lastReason=reason;
    Serial.print(F("Local control "));Serial.print(actuator);Serial.print(F(": "));Serial.println(m.lastStatus);
  }
  JsonDocument response;response["id"]=id;response["status"]=m.lastStatus;if(m.lastReason.length())response["reason"]=m.lastReason;else response["reason"]=nullptr;
  fillTelemetry(response["telemetry"].to<JsonObject>());sendJson(response);
}
void executeDisplayControl(){
  JsonDocument input;if(deserializeJson(input,requestBody)){sendError("Invalid JSON",400);return;}
  if(String(input["session_id"]|"")!=bootSession){sendError("Board session changed",409);return;}
  if(!input["enabled"].is<bool>()){sendError("Invalid display state",400);return;}
  if(!setOLEDEnabled(input["enabled"].as<bool>())){sendError("OLED not detected at 0x3C or 0x3D",409);return;}
  JsonDocument response;fillTelemetry(response["telemetry"].to<JsonObject>());sendJson(response);
}
#include "LocalWiFi.h"
void serviceLocalServer(){
  serviceNetworkSwitch();
  if(stationMode&&WiFi.status()!=WL_CONNECTED){serverReady=false;localClient.stop();}
  if(!serverReady){if((int32_t)(millis()-nextReconnect)>=0)startLocalNetwork();return;}
  if(!localClient){localClient=localServer.available();if(!localClient)return;requestStarted=millis();requestHeader="";requestBody="";bodyLength=0;headersComplete=false;}
  if(millis()-requestStarted>1000){localClient.stop();return;}
  // Incremental, bounded parsing returns to loop() so sampling and manual timers keep running.
  int budget=256;
  while(budget-->0&&localClient.available()){
    char ch=(char)localClient.read();
    if(!headersComplete){
      requestHeader+=ch;if(requestHeader.length()>1024){sendError("Header too large",413);return;}
      if(requestHeader.endsWith("\r\n\r\n")){
        headersComplete=true;String lower=requestHeader;lower.toLowerCase();
        if(lower.indexOf("transfer-encoding:")>=0){sendError("Content-Length required",400);return;}
        int at=lower.indexOf("\r\ncontent-length:");if(at>=0)bodyLength=requestHeader.substring(at+17).toInt();
        if(bodyLength<0||bodyLength>640){sendError("Body too large",413);return;}
      }
    }else requestBody+=ch;
    if(headersComplete&&(int)requestBody.length()>=bodyLength){
      if(requestHeader.startsWith("GET /api/status ")){JsonDocument doc;fillTelemetry(doc.to<JsonObject>());sendJson(doc);}
      else if(requestHeader.startsWith("POST /api/control "))executeControl();
      else if(requestHeader.startsWith("POST /api/wifi "))executeWiFiConfig();
      else if(requestHeader.startsWith("POST /api/display "))executeDisplayControl();
      else sendError("Use /api/status, /api/control, /api/display or /api/wifi",404);
      return;
    }
  }
}
