#pragma once
#include <WiFiS3.h>
#include <ArduinoJson.h>
#if __has_include("arduino_secrets.h")
#include "arduino_secrets.h"
#else
#include "arduino_secrets.example.h"
#endif

// HTTPS is outbound only. No local server or router port forwarding is used.
const unsigned long CLOUD_INTERVAL_MS = 10000;
const unsigned long RESPONSE_TIMEOUT_MS = 3500;
const size_t MAX_RESPONSE = 4096;
const char* actuatorNames[3] = {"fan", "pump", "atomizer"};
struct ManualState { bool manual=false; bool requestedOn=false; unsigned long deadline=0; uint64_t revision=0; String blocked; String ackId; String ackStatus; String ackReason; };
ManualState manualState[3];
String bootSession;
unsigned long sampleSequence=0, nextNetworkAttempt=0, networkBackoff=10000;
bool cloudConfigured=false;
WiFiSSLClient cloudClient;

bool outputOn(int index) { return index==0 ? fanIsOn : index==1 ? pumpIsOn : atomizerIsOn; }
void writeOutput(int index,bool on) { if(index==0)setFan(on); else if(index==1)setPump(on); else setAtomizer(on); }
String protectiveReason(int index,bool starting) {
  if((index==0||index==2)&&(isnan(temperatureC)||isnan(humidityPercent)))return "DHT11 reading failed";
  if(index==1 && PUMP_MODE==IRRIGATION_PUMP && waterPercent < (starting?PUMP_MIN_WATER_ON_PERCENT:PUMP_LOW_WATER_STOP_PERCENT+1))return "Reservoir too low";
  if(index==2 && waterPercent<ATOMIZER_MIN_WATER_PERCENT)return "Reservoir too low";
  return "";
}
void serviceManualTimers() {
  unsigned long now=millis();
  for(int i=0;i<3;i++) {
    ManualState& m=manualState[i];
    if(!m.manual)continue;
    if(m.requestedOn && (int32_t)(now-m.deadline)>=0) {m.manual=false;m.requestedOn=false;m.blocked="";writeOutput(i,false);continue;}
    if(m.requestedOn) {String reason=protectiveReason(i,false);if(reason.length()){m.requestedOn=false;m.blocked=reason;writeOutput(i,false);}}
  }
}
void applyLocalControl() {
  serviceManualTimers();
  if(millis()<SENSOR_STABILIZATION_MS||sampleSequence==0){turnAllActuatorsOff();return;}
  if(!manualState[0].manual)updateFan();else setFan(manualState[0].requestedOn);
  if(!manualState[1].manual)updatePump();else setPump(manualState[1].requestedOn);
  if(!manualState[2].manual)updateAtomizer();else setAtomizer(manualState[2].requestedOn);
}
void serviceLocalDuringNetwork() {
  // Read and apply local control while waiting for a cloud response.
  unsigned long now=millis();
  if(now-lastSensorReadMillis>=SENSOR_READ_INTERVAL_MS){lastSensorReadMillis=now;readSensors();sampleSequence++;applyLocalControl();}
  serviceManualTimers();
}
void initializeCloud() {
  // A per-boot nonce prevents old commands crossing a restart; this is not an authentication secret.
  randomSeed(analogRead(A3)^micros());
  char nonce[40];snprintf(nonce,sizeof(nonce),"%08lx-%08lx-%08lx",(unsigned long)random(0x7fffffff),(unsigned long)random(0x7fffffff),(unsigned long)random(0x7fffffff));bootSession=nonce;
  cloudConfigured=String(SECRET_SSID)!="YOUR_WIFI_NAME" && strlen(DEVICE_TOKEN)==64;
  WiFi.setTimeout(2000);cloudClient.setConnectionTimeout(2000);cloudClient.setTimeout(100);
  nextNetworkAttempt=millis()+CLOUD_INTERVAL_MS;
  Serial.println(cloudConfigured?F("Cloud bridge enabled; automation stays local."):F("Cloud unconfigured; local automatic control remains active."));
}
void receiveCommand(JsonObject c,unsigned long elapsed) {
  String actuator=c["actuator"]|"";int i=-1;for(int j=0;j<3;j++)if(actuator==actuatorNames[j])i=j;if(i<0)return;
  ManualState& m=manualState[i];String id=c["id"]|"";
  if(id==m.ackId)return; // A repeated response never restarts a manual timer.
  String reason;uint64_t revision=c["revision"]|uint64_t(0);
  String mode=c["mode"]|"";bool on=c["on"]|false;unsigned long duration=c["duration_ms"]|0UL;long ttl=c["ttl_ms"]|0L;
  if(String(c["session_id"]|"")!=bootSession)reason="Board session changed";
  else if(ttl<=0 || elapsed>=(unsigned long)ttl)reason="Command expired";
  else if(revision<=m.revision)reason="Superseded command";
  else if(mode!="auto"&&mode!="manual")reason="Invalid control mode";
  else if(mode=="manual"&&on&&duration!=30000&&duration!=60000&&duration!=300000)reason="Invalid activation duration";
  else if(millis()<SENSOR_STABILIZATION_MS||sampleSequence==0)reason="Sensors stabilizing";
  else if(mode=="manual"&&on)reason=protectiveReason(i,true);
  if(revision>m.revision)m.revision=revision;
  if(!reason.length()) {m.manual=mode=="manual";m.requestedOn=m.manual&&on;m.blocked="";m.deadline=millis()+duration;writeOutput(i,m.requestedOn);applyLocalControl();}
  m.ackId=id;m.ackStatus=reason.length()?"rejected":"applied";m.ackReason=reason;
  Serial.print(F("Cloud command "));Serial.print(actuator);Serial.print(F(": "));Serial.println(m.ackStatus);
}
String telemetryPayload() {
  JsonDocument doc;doc["device_id"]=DEVICE_ID;doc["session_id"]=bootSession;doc["sample_seq"]=sampleSequence;doc["uptime_ms"]=millis();
  JsonObject s=doc["sensors"].to<JsonObject>();s["soil_raw"]=soilRaw;s["water_raw"]=waterRaw;s["soil_percent"]=soilPercent;s["water_percent"]=waterPercent;
  bool valid=!isnan(temperatureC)&&!isnan(humidityPercent);s["dht_valid"]=valid;
  if(valid){s["temperature_c"]=temperatureC;s["humidity_percent"]=humidityPercent;}else{s["temperature_c"]=nullptr;s["humidity_percent"]=nullptr;}
  JsonArray acks=doc["acks"].to<JsonArray>();
  for(int i=0;i<3;i++){
    ManualState& m=manualState[i];JsonObject o=doc["actuators"][actuatorNames[i]].to<JsonObject>();o["mode"]=m.manual?"manual":"auto";o["on"]=outputOn(i);
    o["remaining_ms"]=m.manual&&m.requestedOn ? (unsigned long)max(0L,(long)(m.deadline-millis())):0;
    String blocked=m.manual?m.blocked:protectiveReason(i,!outputOn(i));if(blocked.length())o["blocked"]=blocked;else o["blocked"]=nullptr;
    if(m.ackId.length()){JsonObject ack=acks.add<JsonObject>();ack["id"]=m.ackId;ack["status"]=m.ackStatus;if(m.ackReason.length())ack["reason"]=m.ackReason;else ack["reason"]=nullptr;}
  }
  String body;serializeJson(doc,body);return body;
}
bool readCloudResponse(String& body,int& status) {
  unsigned long start=millis();String line;int length=-1;bool header=true,chunked=false;
  while(millis()-start<RESPONSE_TIMEOUT_MS){
    serviceLocalDuringNetwork();
    while(cloudClient.available()){
      int ch=cloudClient.read();if(ch<0)break;
      if(header){line+=(char)ch;if(line.length()>1024)return false;if(ch=='\n'){
        line.trim();if(line.startsWith("HTTP/"))status=line.substring(9,12).toInt();
        String lower=line;lower.toLowerCase();if(lower.startsWith("content-length:"))length=line.substring(15).toInt();if(lower.indexOf("transfer-encoding: chunked")>=0)chunked=true;
        if(!line.length())header=false;line="";
      }}else {body+=(char)ch;if(body.length()>MAX_RESPONSE)return false;if(!chunked&&length>=0&&(int)body.length()>=length)return true;}
      if(millis()-start>=RESPONSE_TIMEOUT_MS)return false;
    }
    if(!cloudClient.connected()&&!cloudClient.available())break;
  }
  // Supabase commonly uses chunked HTTP. Decode bounded chunks before parsing JSON.
  if(chunked){String decoded;int pos=0;bool complete=false;while(pos<(int)body.length()){int end=body.indexOf("\r\n",pos);if(end<0)return false;long size=strtol(body.substring(pos,end).c_str(),nullptr,16);if(size<0||size>(long)MAX_RESPONSE)return false;pos=end+2;if(size==0){complete=true;break;}if(pos+size+2>(int)body.length())return false;decoded+=body.substring(pos,pos+size);pos+=size+2;}body=decoded;return complete;}
  return !header&&length>=0&&(int)body.length()==length;
}
void serviceCloud() {
  if(!cloudConfigured || (int32_t)(millis()-nextNetworkAttempt)<0 || sampleSequence==0)return;
  bool success=false;unsigned long started=millis();
  if(WiFi.status()!=WL_CONNECTED)WiFi.begin(SECRET_SSID,SECRET_PASS);
  serviceLocalDuringNetwork();
  if(WiFi.status()==WL_CONNECTED && cloudClient.connect(CLOUD_HOST,443)){
    String payload=telemetryPayload();
    cloudClient.print(F("POST /functions/v1/device-exchange HTTP/1.1\r\nHost: "));cloudClient.print(CLOUD_HOST);
    cloudClient.print(F("\r\nContent-Type: application/json\r\nAccept-Encoding: identity\r\nConnection: close\r\nX-Device-Token: "));cloudClient.print(DEVICE_TOKEN);
    cloudClient.print(F("\r\nContent-Length: "));cloudClient.print(payload.length());cloudClient.print(F("\r\n\r\n"));cloudClient.print(payload);
    String response;int status=0;
    if(readCloudResponse(response,status)&&status==200){JsonDocument data;if(!deserializeJson(data,response)){for(JsonObject c:data["commands"].as<JsonArray>())receiveCommand(c,millis()-started);success=true;}}
    cloudClient.stop();
  }
  serviceLocalDuringNetwork();
  networkBackoff=success?CLOUD_INTERVAL_MS:min(networkBackoff*2,120000UL);
  nextNetworkAttempt=started+networkBackoff;
  if(!success)Serial.println(F("Cloud unavailable; continuing local control."));
}
