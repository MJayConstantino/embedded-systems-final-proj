import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = process.env.CODEX_RUNTIME_MODULES || 'C:/Users/mjcon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { Presentation, PresentationFile } = await import(pathToFileURL(path.join(runtime, '@oai/artifact-tool/dist/artifact_tool.mjs')));
const { default: sharp } = await import(pathToFileURL(path.join(runtime, 'sharp/dist/index.mjs')));
const root = path.resolve(import.meta.dirname, '..');
const build = path.join(root, 'work/pitch-irrigation');
const out = path.join(root, 'pitch-deck');
await fs.mkdir(build, { recursive: true });
const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const C = { green: '#205C45', dark: '#143B30', cream: '#F5F7F0', ink: '#183E32', muted: '#536C60', lime: '#CDE5AA', white: '#FFFFFF' };
const script = [];
function txt(s, text, x, y, w, h, size=28, color=C.ink, bold=false) {
  const t = s.shapes.add({name:`text-${s.shapes.items.length}`,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  t.text=text; t.text.style={typeface:'Arial',fontSize:size,color,bold,verticalAlignment:'top'}; return t;
}
function slide(title, label, notes, dark=false) {
  const s=p.slides.add(); s.background.fill=dark?C.dark:C.cream;
  const n=p.slides.items.length;
  txt(s,label.toUpperCase(),64,35,1120,30,17,dark?C.lime:C.green,true);
  if(title) txt(s,title,64,92,1152,112,46,dark?C.white:C.ink,true);
  txt(s,'VERDANT / SMART IRRIGATION',64,675,900,24,13,dark?'#BDD2C4':C.muted);
  txt(s,String(n).padStart(2,'0'),1160,675,56,24,14,dark?C.lime:C.muted);
  s.speakerNotes.text=notes;
  script.push(`## ${n}. ${title || 'Verdant'}\n\n${notes}\n`);
  return s;
}
function block(s,head,body,x,y,w=520,dark=false) {
  txt(s,head,x,y,w,52,30,dark?C.lime:C.green,true);
  txt(s,body,x,y+61,w,126,25,dark?C.white:C.muted);
}
async function image(s,filename,rect,frame,alt) {
  const bytes=await sharp(path.join(root,filename)).extract(rect).png().toBuffer();
  s.images.add({blob:bytes,contentType:'image/png',position:frame,fit:'contain',alt});
}
const source='Product source: README.md; firmware/SmartPlant/SmartPlant.ino; firmware/SmartPlant/LocalControl.h; server/bridge.ts. Repository: https://github.com/MJayConstantino/embedded-systems-final-proj';
let s=slide('', 'Embedded Systems Final Project',
  'Imagine checking your plant station from your phone, seeing the soil and reservoir readings, and running a short watering cycle without leaving the screen. That is Verdant: a soil-based irrigation and monitoring prototype built around Arduino UNO R4 WiFi. The irrigation pump delivers water to soil while the reservoir reading provides a low-water lockout. Its main promise is visibility and convenient control, with automatic operation running on the board. Today we are presenting a local demonstration, not a commercially validated growing system.\n\n'+source,true);
txt(s,'verdant.',64,175,960,134,112,C.white,true);
txt(s,'Watering you can see\nand control.',70,332,1050,158,58,C.lime,true);
txt(s,'Arduino automation with a dashboard for your phone.',72,542,1060,70,28,C.white);
s.images.add({blob:await fs.readFile(path.join(root,'public/icon-192.png')),contentType:'image/png',position:{left:1100,top:40,width:88,height:88},alt:'Verdant plant logo'});

s=slide('A care routine leaves unanswered questions.', 'The problem',
  'Our starting use case is a person looking after a small irrigation station for potted plants. Looking at the leaves does not show every condition the project measures. The owner still needs to check the soil and reservoir and decide when to water and whether enough water remains in the reservoir. When those checks happen separately, the owner has no single view of conditions or controls. These are design scenarios, not findings from customer interviews. We have not measured how often they occur.');
block(s,'“Does it need water?”','Soil condition and reservoir supply need separate checks.',64,245);
block(s,'“What needs attention?”','Separate checks make it harder to see the growing conditions together.',680,245);
txt(s,'The opportunity: put the readings and the response in one place.',64,540,1120,88,35,C.green,true);

s=slide('Soil moisture and water supply guide irrigation', 'The product',
  'Verdant brings soil moisture, reservoir level, temperature and air humidity into one dashboard. The irrigation pump is the main actuator, with an optional fan for ventilation. Temperature and humidity provide supporting context. Humidity does not trigger irrigation. This screen is the actual application connected to its labeled software simulator, so the displayed numbers demonstrate the interface rather than physical sensor results. Soil and reservoir percentages use the original firmware constants and remain estimates.\n\nVisual: desktop-preview.png, updated irrigation screenshot dated October 26, 2026. Simulator values, no physical hardware connected.\n\n'+source);
txt(s,'Soil moisture\nReservoir level\n\nAir conditions for context',64,246,465,230,36,C.green,true);
txt(s,'Automatic or timed watering.\nOptional ventilation control.',64,507,475,105,25,C.muted);
await image(s,'desktop-preview.png',{left:0,top:0,width:1280,height:1000},{left:600,top:213,width:590,height:405},'Actual Verdant dashboard screenshot with simulated readings');
txt(s,'Actual dashboard with simulator data',620,629,560,30,18,C.muted);

s=slide('A phone becomes the control panel.', 'The experience',
  'The owner opens the dashboard in a mobile browser and checks soil moisture and reservoir level first. Automatic mode follows the board rules. To run manual watering, select the irrigation pump and Manual, wait for the OFF acknowledgement, choose a duration and switch it on. Durations are thirty seconds, one minute or five minutes. The timer lives on the Arduino. When it finishes, that actuator returns to Auto even if the phone disconnects. The current demonstration requires the phone and laptop to share the board network. It does not offer internet remote access.\n\nVisual: mobile-preview.png, actual application screenshot with simulator data.\n\n'+source);
block(s,'Check conditions','Read current values and reported output states.',64,231,650);
block(s,'Choose the response','Keep soil-based Auto, or run the pump for a limited time.',64,423,650);
await image(s,'mobile-preview.png',{left:0,top:0,width:390,height:844},{left:863,top:194,width:283,height:435},'Mobile Verdant dashboard displaying simulated sensor readings');
txt(s,'Simulator screen',870,638,290,28,18,C.muted);

s=slide('One Arduino connects sensing and action.', 'How it is built · hardware',
  'The Arduino UNO R4 WiFi is the local controller. Analog sensors supply soil and reservoir readings, while a DHT11 supplies temperature and humidity. The relay connects the irrigation pump and a MOSFET controls the optional fan. The retired mist driver on D11 stays LOW and has no command path. The original OLED and Serial readings remain available. We preserved the working sketch assignments shown here, which take precedence over conflicting pins in the project document. These components form the prototype architecture, not a finalized consumer enclosure or certified electrical design.\n\n'+source);
const rows=[['Component','Role','Connection'],['Soil + reservoir sensors','Measure moisture and available water','A0 + A1'],['DHT11','Measure temperature and humidity','A2'],['Ventilation fan','Optional air circulation','D5 · MOSFET'],['Irrigation pump','Water the soil','D8 · relay'],['OLED display','Show readings locally','I²C · 0x3C']];
const table=s.tables.add({rows:6,columns:3,left:64,top:225,width:1152,height:394,columnWidths:[340,535,277],values:rows});
for(let r=0;r<6;r++)for(let c=0;c<3;c++){const cell=table.getCell(r,c);cell.fill=r===0?C.green:(r%2?C.white:C.cream);cell.text.style={typeface:'Arial',fontSize:r===0?23:22,bold:r===0,color:r===0?C.white:C.ink};}

s=slide('Local Wi-Fi keeps the demo simple.', 'How it is built · software',
  'The board creates the Verdant-Demo Wi-Fi hotspot. Both the laptop and the phone join that network. The laptop runs the React, TypeScript and Vite application. Its local bridge forwards HTTP requests to the Arduino for sensor readings and commands. The Arduino owns automatic decisions, protective stops and manual timers. No database, account or hosted service is required. The laptop must remain running for dashboard access, while local automatic control remains on the board. Phone access uses the laptop Network URL rather than the Arduino address.\n\n'+source,true);
block(s,'01   Arduino','Reads sensors, runs Auto rules, applies outputs and timed commands.',64,248,350,true);
block(s,'02   Laptop','Serves the React dashboard and forwards local HTTP requests.',464,248,350,true);
block(s,'03   Phone','Shows readings and sends control requests through the browser.',864,248,350,true);
txt(s,'Same local Wi-Fi. No internet or database needed during the demo.',64,535,1120,90,32,C.lime,true);
txt(s,'The laptop stays on. Automatic control runs on the Arduino.',64,621,1120,35,22,C.white);

s=slide('Soil-based watering with manual override', 'Control behavior',
  'Auto uses the original thresholds. For example, the pump starts at soil moisture thirty percent or lower when reservoir level is at least twenty-five percent. It stops at soil forty-five percent or reservoir fifteen percent or lower. The fan uses temperature rules. Humidity is monitoring only and does not control watering. DHT11 failure stops the fan while irrigation continues from soil and reservoir readings. These are existing project thresholds, not a recommendation for every plant. Manual ON bypasses normal activation thresholds but retains the existing low-water and DHT-failure protections where applicable. A protective stop cancels that activation and leaves the output off. Manual OFF stays active until another command, Auto or reboot. Reboot restores Auto.\n\n'+source);
block(s,'Auto','Pump ON: soil ≤30% and water ≥25%.\nPump OFF: soil ≥45% or water ≤15%.',64,240,520);
block(s,'Manual','30 seconds, 1 minute or 5 minutes. The board ends the timer and returns to Auto.',680,240,520);
txt(s,'Built-in limits',64,485,1120,45,29,C.green,true);
txt(s,'Existing protective stops remain active. Stale readings disable new controls.\nThe board reports output state without separate physical actuator feedback.',64,548,1130,93,25,C.muted);

s=slide('Watering visibility for small growing spaces', 'Why someone would choose Verdant',
  'The product is aimed first at owners of small potted-plant irrigation setups and at classrooms demonstrating embedded systems. That audience is a starting hypothesis, not a validated customer segment. The value proposition is straightforward: inspect several conditions together, let the controller respond locally and intervene from the same screen. It gives an owner a clearer way to interact with the irrigation station and gives students a visible connection between sensor inputs and actuator outputs. We are not claiming improved plant growth or measured water savings.');
txt(s,'For a plant owner',64,248,500,50,33,C.green,true);
txt(s,'One view replaces separate checks.\nA timed action avoids leaving a\nmanual activation running indefinitely.',64,325,535,180,28,C.muted);
txt(s,'For a classroom',680,248,500,50,33,C.green,true);
txt(s,'Sensor readings connect directly\nto observable control decisions\nin a mobile interface.',680,325,535,180,28,C.muted);
txt(s,'Initial audiences to test, not confirmed buyers.',64,586,1130,40,23,C.muted);

s=slide('An irrigation kit with guided setup', 'Product direction · proposal',
  'A possible commercial offering is a complete kit containing the controller, soil and water sensors, pump, tubing and the required output driver, accompanied by setup guidance and the dashboard software. This is a proposal rather than an available product. We would start with a small pilot among indoor plant owners or teaching labs. We would ask whether the controls are useful, what setup effort is acceptable and whether users would pay for the complete kit. A bill of materials and assembly cost must come before pricing or margin claims. There is no target price, revenue forecast or validated market size in this pitch.');
block(s,'The proposed offer','A proposed irrigation kit with a pump, soil and water sensors, and dashboard setup.',64,245,520);
block(s,'The first sales test','Show the prototype to indoor plant owners and teaching labs. Test usefulness and willingness to pay.',680,245,520);
txt(s,'Price follows a bill of materials and pilot feedback.',64,549,1130,78,36,C.green,true);

s=slide('The software works in simulation. Hardware checks come next.', 'Prototype status',
  'The recorded software verification from October 26 includes nineteen automated tests, a passing production frontend build and successful compilation for Arduino UNO R4 WiFi. The actual dashboard and local bridge exchanged readings and acknowledged controls with the separately labeled software simulator. That evidence supports software integration, not physical hardware operation. The companion integration has not been uploaded or validated against real sensor reporting and actuator behavior during this work. Before claiming a physical end-to-end demonstration, check real readings, outputs, hotspot connectivity, protective stops and timer behavior on the board. Sensor calibration remains untested and outside the requested scope.\n\nSource: VERIFICATION.md, October 26, 2026. '+source);
block(s,'Completed software checks','19 automated tests passed.\nFrontend built. Companion sketch compiled.\nDashboard and simulator exchanged data.',64,254,550);
block(s,'Before the physical demonstration','Confirm real sensor readings and outputs.\nCheck protective stops and disconnects.\nVerify phone access over the hotspot.',680,254,530);
txt(s,'Calibration remains untested. Soil and reservoir percentages are estimates.',64,575,1130,72,25,C.muted);

s=slide('The demonstration makes the product tangible.', 'Live demo · about 90 seconds',
  'Start with the normal dashboard connected through Settings. If using the simulator, explicitly say that the demonstration uses simulated hardware. Show soil moisture and reservoir supply, then select the pump and explain its reported output state. Select Manual, wait for the OFF acknowledgement and choose thirty seconds for a short presentation. Activate the output and show its confirmation and countdown. Let the timer finish and show its return to Auto. In a simulator-only demo, this demonstrates software behavior without proving a physical actuator moved. A low-water simulator scenario can demonstrate a rejected pump request if time permits. For physical hardware, verify the circuit and outputs before presenting.\n\nDemo setup and scenarios: README.md. '+source);
const demo=[['01','Connect','Join the demo Wi-Fi and open the laptop dashboard URL.'],['02','Observe','Show the four sensor readings and actuator states.'],['03','Activate','Select the pump, then run a 30-second watering action.'],['04','Return','Watch the board timer finish and Auto resume.']];
for(let i=0;i<4;i++){const y=238+i*99;txt(s,demo[i][0],64,y,70,60,36,C.green,true);txt(s,demo[i][1],165,y,230,56,30,C.ink,true);txt(s,demo[i][2],420,y+3,790,76,25,C.muted);}

s=slide('Verdant makes watering visible', 'The next step',
  'Verdant combines a view of plant conditions with soil-based irrigation and optional ventilation. The software prototype is ready to demonstrate with clearly labeled simulation. The next step is physical integration testing, followed by a small user pilot. Our invitation is to try the dashboard and help answer one concrete question: does this make managing a small irrigation station easier? That feedback, together with verified hardware operation and component costs, will shape the first kit. Thank you.\n\n'+source,true);
txt(s,'See the soil.\nControl the watering.',64,245,1120,185,63,C.white,true);
txt(s,'Try the prototype. Help shape the first irrigation kit.',64,493,1130,104,33,C.lime,true);
txt(s,'Next: physical integration checks, then a small user pilot.',64,609,1130,40,23,C.white);

await fs.writeFile(path.join(out,'irrigation-presenter-notes.md'),'# Verdant irrigation product pitch\n\nSuggested delivery: 6–8 minutes, plus a short live demo.\n\n'+script.join('\n'));
await fs.writeFile(path.join(build,'deck.json'),JSON.stringify(p.toProto()));
for(let i=0;i<p.slides.items.length;i++){
 const png=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
}
await (await PresentationFile.exportPptx(p)).save(path.join(build,'candidate.pptx'));
console.log('Built 12 slides, notes, previews and draft PowerPoint.');
if(process.env.CODEX_PRESENTATION_SKILL){
 const skill=process.env.CODEX_PRESENTATION_SKILL;
 const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')));
 const result=await finalizePresentation({workspaceDir:root,candidatePath:path.join(build,'candidate.pptx'),finalPath:path.join(out,'Verdant-Irrigation-Pitch.pptx'),pythonExecutable:process.env.CODEX_RUNTIME_PYTHON,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(build,'validation.json')});
 console.log(JSON.stringify(result));
}

