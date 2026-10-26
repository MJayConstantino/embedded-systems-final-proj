# Verdant irrigation product pitch

Suggested delivery: 6–8 minutes, plus a short live demo.

## 1. Verdant

Imagine checking your plant station from your phone, seeing the soil and reservoir readings, and running a short watering cycle without leaving the screen. That is Verdant: a soil-based irrigation and monitoring prototype built around Arduino UNO R4 WiFi. The irrigation pump delivers water to soil while the reservoir reading provides a low-water lockout. Its main promise is visibility and convenient control, with automatic operation running on the board. Today we are presenting a local demonstration, not a commercially validated growing system.

Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 2. A care routine leaves unanswered questions.

Our starting use case is a person looking after a small irrigation station for potted plants. Looking at the leaves does not show every condition the project measures. The owner still needs to check the soil and reservoir and decide when to water and whether enough water remains in the reservoir. When those checks happen separately, the owner has no single view of conditions or controls. These are design scenarios, not findings from customer interviews. We have not measured how often they occur.

## 3. Soil moisture and water supply guide irrigation

Verdant brings soil moisture, reservoir level, temperature and air humidity into one dashboard. The irrigation pump is the main actuator, with an optional fan for ventilation. Temperature and humidity provide supporting context. Humidity does not trigger irrigation. This screen is the actual application connected to its labeled software simulator, so the displayed numbers demonstrate the interface rather than physical sensor results. Soil and reservoir percentages use the original firmware constants and remain estimates.

Visual: desktop-preview.png, updated irrigation screenshot dated October 26, 2026. Simulator values, no physical hardware connected.

Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 4. A phone becomes the control panel.

The owner opens the dashboard in a mobile browser and checks soil moisture and reservoir level first. Automatic mode follows the board rules. To run manual watering, select the irrigation pump and Manual, wait for the OFF acknowledgement, choose a duration and switch it on. Durations are thirty seconds, one minute or five minutes. The timer lives on the Arduino. When it finishes, that actuator returns to Auto even if the phone disconnects. The current demonstration requires the phone and laptop to share the board network. It does not offer internet remote access.

Visual: mobile-preview.png, actual application screenshot with simulator data.

Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 5. One Arduino connects sensing and action.

The Arduino UNO R4 WiFi is the local controller. Analog sensors supply soil and reservoir readings, while a DHT11 supplies temperature and humidity. The relay connects the irrigation pump and a MOSFET controls the optional fan. The retired mist driver on D11 stays LOW and has no command path. The original OLED and Serial readings remain available. We preserved the working sketch assignments shown here, which take precedence over conflicting pins in the project document. These components form the prototype architecture, not a finalized consumer enclosure or certified electrical design.

Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 6. Local Wi-Fi keeps the demo simple.

The board creates the Verdant-Demo Wi-Fi hotspot. Both the laptop and the phone join that network. The laptop runs the React, TypeScript and Vite application. Its local bridge forwards HTTP requests to the Arduino for sensor readings and commands. The Arduino owns automatic decisions, protective stops and manual timers. No database, account or hosted service is required. The laptop must remain running for dashboard access, while local automatic control remains on the board. Phone access uses the laptop Network URL rather than the Arduino address.

Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 7. Soil-based watering with manual override

Auto uses the original thresholds. For example, the pump starts at soil moisture thirty percent or lower when reservoir level is at least twenty-five percent. It stops at soil forty-five percent or reservoir fifteen percent or lower. The fan uses temperature rules. Humidity is monitoring only and does not control watering. DHT11 failure stops the fan while irrigation continues from soil and reservoir readings. These are existing project thresholds, not a recommendation for every plant. Manual ON bypasses normal activation thresholds but retains the existing low-water and DHT-failure protections where applicable. A protective stop cancels that activation and leaves the output off. Manual OFF stays active until another command, Auto or reboot. Reboot restores Auto.

Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 8. Watering visibility for small growing spaces

The product is aimed first at owners of small potted-plant irrigation setups and at classrooms demonstrating embedded systems. That audience is a starting hypothesis, not a validated customer segment. The value proposition is straightforward: inspect several conditions together, let the controller respond locally and intervene from the same screen. It gives an owner a clearer way to interact with the irrigation station and gives students a visible connection between sensor inputs and actuator outputs. We are not claiming improved plant growth or measured water savings.

## 9. An irrigation kit with guided setup

A possible commercial offering is a complete kit containing the controller, soil and water sensors, pump, tubing and the required output driver, accompanied by setup guidance and the dashboard software. This is a proposal rather than an available product. We would start with a small pilot among indoor plant owners or teaching labs. We would ask whether the controls are useful, what setup effort is acceptable and whether users would pay for the complete kit. A bill of materials and assembly cost must come before pricing or margin claims. There is no target price, revenue forecast or validated market size in this pitch.

## 10. The software works in simulation. Hardware checks come next.

The recorded software verification from October 26 includes nineteen automated tests, a passing production frontend build and successful compilation for Arduino UNO R4 WiFi. The actual dashboard and local bridge exchanged readings and acknowledged controls with the separately labeled software simulator. That evidence supports software integration, not physical hardware operation. The companion integration has not been uploaded or validated against real sensor reporting and actuator behavior during this work. Before claiming a physical end-to-end demonstration, check real readings, outputs, hotspot connectivity, protective stops and timer behavior on the board. Sensor calibration remains untested and outside the requested scope.

Source: VERIFICATION.md, October 26, 2026. Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 11. The demonstration makes the product tangible.

Start with the normal dashboard connected through Settings. If using the simulator, explicitly say that the demonstration uses simulated hardware. Show soil moisture and reservoir supply, then select the pump and explain its reported output state. Select Manual, wait for the OFF acknowledgement and choose thirty seconds for a short presentation. Activate the output and show its confirmation and countdown. Let the timer finish and show its return to Auto. In a simulator-only demo, this demonstrates software behavior without proving a physical actuator moved. A low-water simulator scenario can demonstrate a rejected pump request if time permits. For physical hardware, verify the circuit and outputs before presenting.

Demo setup and scenarios: README.md. Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj

## 12. Verdant makes watering visible

Verdant combines a view of plant conditions with soil-based irrigation and optional ventilation. The software prototype is ready to demonstrate with clearly labeled simulation. The next step is physical integration testing, followed by a small user pilot. Our invitation is to try the dashboard and help answer one concrete question: does this make managing a small irrigation station easier? That feedback, together with verified hardware operation and component costs, will shape the first kit. Thank you.

Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj
