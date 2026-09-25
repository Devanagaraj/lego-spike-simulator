# LEGO SPIKE Simulator

A browser-based Blockly simulator for LEGO SPIKE robots built from LDraw (`.ldr`/`.mpd`) or BrickLink Studio (`.io`) models. It includes a 3D scene, yaw and motion sensors, motor-driven wheels and linked rotating attachments. The physics model is a flat-ground differential drive, not a full rigid-body or gear-contact solver.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To make a standalone build, run `npm run build` and open `dist/index.html`. The production build inlines its assets.

## First run

The simulator opens with **1. Simple Bot** and a short movement program. Use **Wire map** in the simulation toolbar when you want the supplied BIOGLOW field image, or use the scene editor to load another mat. The robot menu loads **2. FLL Attachment Bot** or your own `.ldr`, `.mpd`, or `.io` file. The same menu downloads either preset or the currently configured robot. The bundled models live in `src/lib/assets/robots/` as `DifferentialDriveBot.mpd` and `DriveAndAttachmentBot.io`.

All bundled robots use **A for the left drive motor and B for the right**, viewed from the gear-facing back view. The colour sensor uses C; attachment motors keep E/F. The front of every bundled robot is the end with the gears. The supplied **3. FLL Attachment Bot (MPD)** is the metadata-based MPD variant and is available beside the original Studio `.io` bot. Each bot loads with the gear-facing back view and zero heading, and the default movement program selects AB, so forward drives toward the gear end. Wheel-panel ratios are A=1 and B=-1; the movement blocks compensate motor direction so both wheels still drive forward together. Existing saved preset wiring and old AC/CD movement-pair settings migrate to AB once; later custom wiring is retained on reload. The wheel panel shows the motor attached to each tire and includes an explanation button beside the ratio. Check **Connect ports** and **Connect wheels** if you change the robot.

When any loaded robot needs parts that are not bundled in its model, the simulator reuses the saved LDraw ZIP or downloads the [official complete library](https://library.ldraw.org/updates) automatically, then keeps it in browser storage. If the download fails (for example, because a browser blocks the cross-origin request), use the Library button to choose a ZIP manually.

The gear/attachment panel links a moving part to a motor port, rotation axis, and signed speed ratio. Coaxial 4519 axles in the attachment robot animate with their connected gears; arbitrary gear trains and torque are not inferred. Drag the wheel/gear preview to orbit it and scroll to zoom. Moving a motor onto another occupied hub port swaps the two motor connections and preserves their wheel/attachment links. The mappings are saved in the browser and in exported `.mpd` metadata. The Studio `.io` preset download is the original Studio file; use **Download current robot** to export configured simulator metadata.

Press **Space** or the Play/Stop button to run or stop. Drag the scene to orbit and use the mouse wheel to zoom. Running code preserves the camera view. The heading sensor starts at 0° for a newly loaded robot; the camera's 45° *tilt* is a viewing angle, not robot yaw.

The virtual-hub drawing shows the hub layout and LED pattern. Its center button starts/stops the program; left/right buttons send press/release events while it runs, for programs using hub-button blocks. Hide or restore the entire side rail to give the 3D view more room. The separate LED matrix is hidden initially; reopen it from **Panels**. The gyroscope is an overlay at the top right of the scene, showing simulated yaw, turn rate, and planar acceleration. Pitch and roll stay at 0° because the ground model is flat.

The simulator toolbar includes a **Wire map** button that loads the supplied BIOGLOW wireframe at the official 2360 x 1140 mm mat dimensions. It clears the placeholder scene objects so the robot is measured directly against the field artwork. The **Robot view / Map view** button toggles framing without opening the camera menu. In the scene editor, select **Robot start -> Choose position and heading** to place the robot on the mat (coordinates are in millimetres from the mat centre).

## Verify changes

```sh
npm run test:simulation
npm run check
npm run build
```

The simulation suite covers both presets' ground contact, straight drive, one-wheel arcs, 90° turns, port reassignment, and attachment motors. `npm run check` validates Svelte and TypeScript. For codebase orientation and regression invariants, see [docs/CONTEXT.md](docs/CONTEXT.md) and [docs/REGRESSION.md](docs/REGRESSION.md).

## Limits

Only a two-wheel differential-drive base is physically modeled. The simulator does not model slip, collisions, load-dependent acceleration, gear backlash, or automatic attachment motion from visual contact. Map artwork is a measurement aid, not a collision mesh.
