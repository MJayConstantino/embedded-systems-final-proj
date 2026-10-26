# Verdant smart irrigation pitch

The current presentation is **Verdant-Irrigation-Pitch.pptx**, with 12 editable slides and embedded speaker notes. Use **Verdant-Irrigation-Pitch.pdf** as the viewing copy and **irrigation-presenter-notes.md** to rehearse. Suggested delivery is 6–8 minutes plus a 90-second watering demo.

The pitch explains the irrigation problem, soil and reservoir readings, automatic watering, timed manual activation, hardware connections, local Wi-Fi architecture, intended customers and a proposed irrigation kit. The optional fan remains a supporting feature. Humidity is monitoring only.

Dashboard screenshots show labeled simulation. Software checks and firmware compilation do not prove physical sensor readings or water delivery. Calibration remains untested and outside scope. There are no measured water-saving, growth, sales or pricing claims.

The earlier Verdant-Pitch-Deck filenames and presenter-notes.md now contain the same irrigation revision, so links from the previous delivery remain current.

Before a real demonstration, upload the revised sketch and complete the hardware checklist in ../VERIFICATION.md. The retired D11 mist output stays LOW. Do not use the damaged module.

## Source

build.mjs contains editable slide content, layouts and notes. It uses the bundled @oai/artifact-tool runtime and Sharp for screenshot crops. Set CODEX_RUNTIME_MODULES to the runtime Node modules folder on another machine. Intermediate files stay in work/pitch-irrigation. The optional finalizer uses CODEX_PRESENTATION_SKILL, CODEX_RUNTIME_PYTHON and RUNTIME_NODE_MODULES. Finalization refuses to overwrite existing final files, so choose a new filename for further revisions.
