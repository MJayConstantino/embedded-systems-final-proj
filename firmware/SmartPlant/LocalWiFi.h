#pragma once
#include <EEPROM.h>

// Credentials stay on this board. Never include the password in telemetry or Serial.
struct SavedWiFi { uint32_t magic; char ssid[33]; char password[64]; };
const uint32_t WIFI_CONFIG_MAGIC=0x56524432;
String configuredSSID,configuredPassword;
bool stationMode=false,networkSwitchPending=false;
unsigned long networkSwitchAt=0;
int stationAttempts=0;

bool validWiFi(const String& ssid,const String& password){
  String name=ssid;name.trim();
  if(!name.length()||ssid.length()>32)return false;
  for(unsigned int i=0;i<ssid.length();i++)if(ssid[i]==0)return false;
  for(unsigned int i=0;i<password.length();i++)if(password[i]==0)return false;
  return password.length()==0||(password.length()>=8&&password.length()<=63);
}
void loadWiFiConfig(){
  SavedWiFi saved;EEPROM.get(0,saved);
  if(saved.magic==WIFI_CONFIG_MAGIC&&saved.ssid[32]=='\0'&&saved.password[63]=='\0'){
    String ssid(saved.ssid),password(saved.password);
    if(validWiFi(ssid,password)){configuredSSID=ssid;configuredPassword=password;}
  }
  if(!configuredSSID.length()&&USE_EXISTING_WIFI&&String(SECRET_SSID)!="YOUR_WIFI_NAME"){
    configuredSSID=SECRET_SSID;configuredPassword=SECRET_PASS;
  }
  stationMode=configuredSSID.length()>0;
}
void startLocalNetwork(){
  WiFi.setTimeout(2500);
  if(stationMode){
    stationAttempts++;
    int status=configuredPassword.length()?WiFi.begin(configuredSSID.c_str(),configuredPassword.c_str()):WiFi.begin(configuredSSID.c_str());
    serverReady=status==WL_CONNECTED;
    if(!serverReady&&stationAttempts>=2){
      Serial.println(F("Could not join Wi-Fi. Returning to setup hotspot."));
      WiFi.end();stationMode=false;
    }
  }
  if(!stationMode){
    // WiFiS3 defaults the setup AP to 192.168.4.1. Do not set a static station IP.
    int status=WiFi.beginAP(DEMO_AP_SSID,DEMO_AP_PASS);
    serverReady=status==WL_AP_LISTENING||status==WL_AP_CONNECTED;
  }
  if(serverReady){
    localServer.begin();stationAttempts=0;
    Serial.print(F("Arduino local IP: "));Serial.println(WiFi.localIP());
    Serial.print(F("Wi-Fi network: "));Serial.println(stationMode?configuredSSID:String(DEMO_AP_SSID));
    Serial.println(F("Enter this IP in dashboard Settings. Wi-Fi password is never printed."));
  }else Serial.println(F("Wi-Fi unavailable. Local control continues; retry in 30 seconds."));
  nextReconnect=millis()+30000;
}
void initializeLocalWiFi(){
  randomSeed(analogRead(A3)^micros());char nonce[40];
  snprintf(nonce,sizeof(nonce),"local-%08lx-%08lx",(unsigned long)random(0x7fffffff),(unsigned long)random(0x7fffffff));
  bootSession=nonce;loadWiFiConfig();startLocalNetwork();
}
void executeWiFiConfig(){
  JsonDocument config;if(deserializeJson(config,requestBody)){sendError("Invalid JSON",400);return;}
  if(String(config["session_id"]|"")!=bootSession){sendError("Board session changed",409);return;}
  if(!config["ssid"].is<const char*>()||!config["password"].is<const char*>()) {sendError("SSID and password required",400);return;}
  if(strlen(config["ssid"].as<const char*>())!=config["ssid"].as<JsonString>().size()||
     strlen(config["password"].as<const char*>())!=config["password"].as<JsonString>().size()){
    sendError("Invalid Wi-Fi characters",400);return;
  }
  String ssid=config["ssid"].as<String>(),password=config["password"].as<String>();
  if(!validWiFi(ssid,password)){sendError("Invalid SSID or password length",400);return;}
  SavedWiFi saved={};saved.magic=WIFI_CONFIG_MAGIC;
  ssid.toCharArray(saved.ssid,sizeof(saved.ssid));password.toCharArray(saved.password,sizeof(saved.password));
  EEPROM.put(0,saved);
  configuredSSID=ssid;configuredPassword=password;
  JsonDocument response;response["accepted"]=true;sendJson(response);
  networkSwitchPending=true;networkSwitchAt=millis()+750;
}
void serviceNetworkSwitch(){
  if(networkSwitchPending&&(int32_t)(millis()-networkSwitchAt)>=0){
    networkSwitchPending=false;localClient.stop();serverReady=false;
    WiFi.end();stationMode=true;stationAttempts=0;startLocalNetwork();
  }
}
