<script context="module" lang="ts">
    let defaultAssetsLoaded = false;
</script>

<script lang="ts">
    import { onMount } from 'svelte';
    import * as Blockly from 'blockly/core';
    import {
        type Model,
        componentStore,
        findParts,
        findPartTransform,
        resolveFromZip,
        setRobotFromFile,
        setRobotFromContent,
        setStudioMode
    } from '$lib/ldraw/components';
    import { type CompiledModel, WebGLCompiler } from '$lib/ldraw/gl';
    import {
        VM,
        Hub,
        type Namespace,
        StringValue,
        ListValue,
        codeStore,
        type PortType,
        Port,
        Motor,
        LightSensor,
        UltraSoundSensor,
        ForceSensor,
        Wheel
    } from '$lib/spike/vm';
    import { genId } from '$lib/blockly/genid';
    import { copyScene, sceneStore } from '$lib/spike/scene';
    import { ATTACHMENT_DRIVE_NAME, DIFFERENTIAL_DRIVE_NAME, FLL_MPD_DRIVE_NAME, canonicalPresetName, configurePresetDrive, connectStudioDrive } from '$lib/spike/presets';
    import HubWidget from '$components/HubWidget.svelte';
    import LedMatrixDisplay from '$components/LedMatrixDisplay.svelte';
    import ScenePreview from '$components/ScenePreview.svelte';
    import ColourSensor from '$components/ColourSensor.svelte';
    import DistanceSensor from '$components/DistanceSensor.svelte';
    import ForceCheckSensor from '$components/ForceCheckSensor.svelte';
    import trainerMpd from '$lib/assets/robots/DifferentialDriveBot.mpd?raw';
    import attachmentBotUrl from '$lib/assets/robots/DriveAndAttachmentBot.io?url';
    import fllMpd from '$lib/assets/robots/FLLAttachmentBot.mpd?raw';
    import bioglowWireframeUrl from '$lib/assets/scenes/bioglow-wireframe.jpg?url';
    import {
        loadLibraryFromBrowser,
        downloadOfficialLibrary,
        loadRobotFromBrowser,
        saveLibraryToBrowser,
        saveRobotToBrowser
    } from '$lib/robot-cache';
    import * as m4 from '$lib/ldraw/m4';
    import JSZip from 'jszip';

    // FLL BIOGLOW launch area: left side of the lower mat edge, measured from
    // the mat centre. The scene uses X/Z internally; the scene panel exposes
    // the second coordinate as the user-facing Y axis.
    const DEFAULT_MAT_START_X = -900;
    const DEFAULT_MAT_START_Z = 430;

    function launchHeading() {
        // The mat's lower edge is at positive scene Z. Point each bundled
        // chassis toward the mat centre using its configured physical forward
        // vector instead of assuming every model shares the same mesh axis.
        return (hub.driveForward?.z ?? 1) > 0 ? 180 : 0;
    }

    export let runSimulation: boolean = false;
    export let presetToLoad: 'trainer' | 'attachments' | 'fll-mpd' | null = null;
    export let workspace: Blockly.WorkspaceSvg | undefined;
    export let connectorOpen = false;
    export let sceneOpen = false;
    export let wheelsOpen = false;
    export let attachmentsOpen = false;
    export let hub = new Hub();
    export let camera: 'top' | 'left' | 'right' | 'front' | 'back' | 'adaptive' = 'adaptive';
    export let robotFocus = true;
    export let tilt = true;
    export let resetViewRequest = 0;
    let viewYaw = 0;
    let viewPitch = 0;
    let viewZoom = 1;
    let viewPanX = 0;
    let viewPanZ = 0;
    let seenResetViewRequest = 0;

    let compiler = new WebGLCompiler();

    interface SensorView {
        id: number | 'none';
        port: PortType;
        type: string;
    }

    let numberOfLoads = 0;
    let robotLoadGeneration = 0;
    let vm: VM | undefined;
    let hubImage = '0000000000000000000000000';
    let hubCentreButtonColour = '#ffffff';
    let compiledRobot: CompiledModel | undefined = $componentStore.robotModel
        ? compiler.compileModel($componentStore.robotModel, { rescale: false })
        : undefined;
    let sensors: SensorView[] = [];
    let lastFrame: number = 0;
    let scene = copyScene($sceneStore);
    let scenePreviewReady = false;
    let scenePreviewError = '';
    let libraryStatus = '';
    let libraryError = '';
    let libraryLoading = false;
    let libraryGeneration = -1;
    let driveWarning = '';
    let usesMovementPair = false;
    type Panel = 'hub' | 'led' | 'gyro';
    type PanelState = 'expanded' | 'minimized' | 'closed';
    let panelState: Record<Panel, PanelState> = { hub: 'expanded', led: 'closed', gyro: 'expanded' };
    // Keep the model in the gear-facing robot view on startup, with a little
    // breathing room around the chassis.
    let sideRailOpen = false;
    let panelMenuOpen = false;
    let gyro = { yaw: 0, pitch: 0, roll: 0, rate: 0, accelerationX: 0, accelerationZ: 0 };
    let connectionFlags: { port: PortType; label: string; detail: string }[] = [];
    let id = genId();

    function updateConnectionFlags() {
        const ports: PortType[] = ['A', 'B', 'C', 'D', 'E', 'F'];
        connectionFlags = ports
            .filter((port) => hub.ports[port].type !== 'none')
            .map((port) => {
                const device = hub.ports[port];
                if (device.type !== 'motor') {
                    const sensorName = device.type === 'light' ? 'Colour sensor' : device.type === 'distance' ? 'Distance sensor' : 'Force sensor';
                    return { port, label: sensorName, detail: `Port ${port} · ${sensorName}` };
                }
                const wheel = hub.wheels.find((item) => item.port === port);
                const attachment = hub.attachments.find((item) => item.port === port);
                if (wheel) {
                    return { port, label: 'Motor → wheel', detail: `Port ${port} · motor → wheel · ratio ${wheel.gearing}` };
                }
                if (attachment) {
                    return { port, label: 'Motor → attachment', detail: `Port ${port} · motor → attachment · ratio ${attachment.ratio}` };
                }
                return { port, label: 'Motor', detail: `Port ${port} · motor` };
            });
    }

    $: if (hub) updateConnectionFlags();

    function setPanel(panel: Panel, state: PanelState) {
        panelState = { ...panelState, [panel]: state };
        panelMenuOpen = false;
    }

    function resetRobotView() {
        // The gear end is the front of both bundled robots. Use the same
        // back-facing camera and zero heading whenever a model is loaded.
        camera = 'back';
        // Keep the gear-facing back orientation while giving the robot a little
        // breathing room instead of filling the whole panel.
        robotFocus = true;
        tilt = true;
        viewYaw = 0;
        viewPitch = 0;
        viewZoom = 0.85;
        viewPanX = 0;
        viewPanZ = 0;
    }

    function resetSimulatorView() {
        resetRobotView();
        robotFocus = true;
    }

    $: if (resetViewRequest !== seenResetViewRequest) {
        seenResetViewRequest = resetViewRequest;
        resetSimulatorView();
    }

    function updateGyro() {
        gyro = {
            yaw: hub.yaw,
            pitch: 0,
            roll: 0,
            rate: hub.angularVelocity,
            accelerationX: hub.accelerationX,
            accelerationZ: hub.accelerationZ
        };
    }

    const partNames: Record<string, string> = {
        '54696': 'motor',
        '54696p01': 'motor',
        '68488': 'motor',
        '54675': 'motor',
        '37308': 'light',
        '37316': 'distance',
        '37312': 'force',
        '32019': 'wheel', // Studio tire, diameter 62.4mm
        '39367p01': 'wheel', // Diameter 56mm
        '49295p01': 'wheel' // Diameter 88mm
    };
    const partRadius: Record<string, number> = {
        '32019': 31.2,
        '39367p01': 28,
        '49295p01': 44
    };

    function connectPorts(hub: Hub, robot: Model) {
        for (const subpart of robot.subparts) {
            if (subpart.model) {
                if (subpart.port) {
                    // Ignore the hub for the moment, we only have one
                    const part = subpart.modelNumber.replace('.dat', '');
                    const type = partNames[part];
                    const port = subpart.port.port as PortType;
                    if (type === 'motor') {
                        hub.ports[port] = new Port('motor');
                        hub.ports[port].motor = new Motor(subpart.id);
                    } else if (type === 'light') {
                        hub.ports[port] = new Port('light');
                        hub.ports[port].light = new LightSensor(subpart.id);
                    } else if (type === 'distance') {
                        hub.ports[port] = new Port('distance');
                        hub.ports[port].ultra = new UltraSoundSensor(subpart.id);
                    } else if (type === 'force') {
                        hub.ports[port] = new Port('force');
                        hub.ports[port].force = new ForceSensor(subpart.id);
                    }
                }
                connectPorts(hub, subpart.model);
            }
        }
    }

    function connectWheels(hub: Hub, robot: Model) {
        for (const subpart of robot.subparts) {
            if (subpart.model) {
                if (subpart.port) {
                    // Ignore the hub for the moment, we only have one
                    const part = subpart.modelNumber.replace('.dat', '');
                    const type = partNames[part];
                    const port = subpart.port.port as PortType;
                    if (type === 'wheel') {
                        const radius = partRadius[part] ?? 1;
                        const gearing = subpart.gear_ratio ?? 1;
                        hub.wheels.push(
                            new Wheel(subpart.id, radius, gearing, port, m4.identity())
                        );
                    }
                }
                connectWheels(hub, subpart.model);
            }
        }
    }

    function connectAttachments(hub: Hub, robot: Model) {
        for (const part of robot.subparts) {
            if (part.port && part.rotation_axis && part.model) {
                hub.attachments.push({
                    id: part.id,
                    port: part.port.port as PortType,
                    ratio: part.gear_ratio ?? 1,
                    axis: part.rotation_axis
                });
            }
            if (part.model) connectAttachments(hub, part.model);
        }
    }

    function connectPresetGears(hub: Hub, robot: Model) {
        const gears = findParts(robot, ['32270']);
        const x = (id: number) => findPartTransform(robot, id)?.forward[12] ?? 0;
        gears.sort((a, b) => x(a.id) - x(b.id));
        // The supplied FLL MPD has a force sensor mounted on the lift arm.
        // Give that arm a physical travel range so a running motor stalls at
        // the chassis instead of spinning through the model indefinitely.
        const fllArm = gears[1];
        const hasFllForceSensor = findParts(robot, ['37312']).length > 0;
        const applyFllArmLimit = () => {
            if (!hasFllForceSensor || !fllArm) return;
            const arm = hub.attachments.find((part) => part.id === fllArm.id);
            if (arm) {
                arm.minAngle = -100;
                arm.maxAngle = 100;
            }
        };
        if (hub.attachments.length > 0) {
            applyFllArmLimit();
            return;
        }
        if (gears.length === 1 && hub.ports.E.type === 'motor') {
            hub.attachments.push({ id: gears[0].id, port: 'E', ratio: 1, axis: 'z' });
        } else if (gears.length === 2 && hub.ports.E.type === 'motor' && hub.ports.F.type === 'motor') {
            hub.attachments.push({ id: gears[0].id, port: 'E', ratio: 1, axis: 'z' });
            hub.attachments.push({ id: gears[1].id, port: 'F', ratio: 1, axis: 'z' });
        } else if (gears.length >= 2 && hub.ports.E.type === 'motor') {
            // The supplied FLL MPD has a motor-driven gear followed by a
            // meshed gear, but only one tool motor port. Keep both gears in
            // the same mechanical chain and reverse the second gear.
            hub.attachments.push({ id: gears[0].id, port: 'E', ratio: 1, axis: 'z' });
            hub.attachments.push({
                id: gears[1].id,
                port: 'E',
                ratio: -1,
                axis: 'z',
                minAngle: -100,
                maxAngle: 100
            });
        }
        applyFllArmLimit();
    }

    function loadWheelTransforms(hub: Hub, robot: Model) {
        for (const wheel of hub.wheels) {
            const result = findPartTransform(robot, wheel.id);
            if (result) {
                let matrix = m4.identity();
                if (compiledRobot) {
                    matrix = m4.translate(
                        matrix,
                        compiledRobot.recenter.x,
                        compiledRobot.recenter.y,
                        compiledRobot.recenter.z
                    );
                }
                matrix = m4.axisRotate(matrix, [1.0, 0.0, 0.0], Math.PI);
                matrix = m4.scale(matrix, 0.4, 0.4, 0.4);
                matrix = m4.multiply(matrix, result.forward);
                wheel.locationTransform = matrix;
                wheel.applyTransform();
            } else {
                console.log('Error');
            }
        }
    }

    function robotStartHeight() {
        const wheelHeights = hub.wheels
            .filter((wheel) => Number.isFinite(wheel.position.y))
            .map((wheel) => wheel.radius - wheel.position.y);
        // Wheels provide the normal ground contact, but an attachment can
        // extend below the tire centreline.  Also clamp against the compiled
        // model's lowest vertex so the FLL lift/tool can never start below the
        // mat surface when its wheel metadata is incomplete or asymmetric.
        const wheelHeight = wheelHeights.length > 0 ? Math.max(...wheelHeights) : 0;
        const geometryHeight = compiledRobot ? -compiledRobot.bbox.min.y : 0;
        return Math.max(wheelHeight, geometryHeight);
    }

    async function loadDefaultAssets() {
        if (defaultAssetsLoaded) {
            return;
        }
        defaultAssetsLoaded = true;

        try {
            const robot = setRobotFromContent(trainerMpd);
            compiledRobot = compiler.compileModel(robot, { rescale: false });
            resetRobotView();
            hub.reload();
            connectPorts(hub, robot);
            connectWheels(hub, robot);
            connectPresetGears(hub, robot);
            configurePresetDrive(hub, robot, DIFFERENTIAL_DRIVE_NAME);
            loadWheelTransforms(hub, robot);
            hub = hub;

            sceneStore.set({
                robot: {
                    anchored: false,
                    name: DIFFERENTIAL_DRIVE_NAME,
                    position: { x: DEFAULT_MAT_START_X, y: robotStartHeight(), z: DEFAULT_MAT_START_Z },
                    rotation: launchHeading(),
                    bricks: robot
                },
                objects: [],
                map: undefined,
                mapWidth: 2360,
                mapHeight: 1140
            });
            scene = copyScene($sceneStore);
            numberOfLoads++;

            // Fetch the supplied FLL BIOGLOW wire map after the robot has been
            // published. This preserves a cached robot if the image request
            // resolves at the same time as browser-cache restoration.
            try {
                const response = await fetch(bioglowWireframeUrl);
                if (response.ok) {
                    const map = await response.blob();
                    sceneStore.update((old) => ({ ...old, map, mapWidth: 2360, mapHeight: 1140 }));
                    scene = copyScene($sceneStore);
                }
            } catch (error) {
                console.warn('Could not load the default BIOGLOW wire map', error);
            }
        } catch (error) {
            defaultAssetsLoaded = false;
            console.error('Failed to load the default robot and measurement scene', error);
        }
    }

    onMount(() => {
        void loadDefaultAssets();
        void restoreBrowserCache();
    });

    function cachedPresetNeedsBackViewRepair(robot: Model, name: string) {
        const suppliedMpd = name === FLL_MPD_DRIVE_NAME;
        const attachment = name === ATTACHMENT_DRIVE_NAME;
        const trainer = name === DIFFERENTIAL_DRIVE_NAME;
        if (!suppliedMpd && !attachment && !trainer) return false;
        const motorCode = suppliedMpd ? '54696' : attachment ? '54675' : '54696';
        const tireCode = attachment && !suppliedMpd ? '32019' : '39367p01';
        const x = (id: number) => findPartTransform(robot, id)?.forward[12] ?? 0;
        const motors = findParts(robot, [motorCode]).sort((a, b) => x(b.id) - x(a.id));
        const tires = findParts(robot, [tireCode]).sort((a, b) => x(b.id) - x(a.id));
        if (motors.length !== 2 || tires.length !== 2) return false;
        const left = hub.wheels.find((wheel) => wheel.port === 'A');
        const right = hub.wheels.find((wheel) => wheel.port === 'B');
        if (!left || !right) return false;
        const invertedLegacyRatios = Math.abs(left.gearing + 1) < 1e-9 && Math.abs(right.gearing - 1) < 1e-9;
        const swappedWheels = left.id === tires[1].id && right.id === tires[0].id;
        const swappedMotors = hub.ports.A.motor?.id === motors[1].id && hub.ports.B.motor?.id === motors[0].id;
        return invertedLegacyRatios || swappedWheels || swappedMotors;
    }

    async function restoreBrowserCache() {
        const generation = robotLoadGeneration;
        try {
            const saved = await loadRobotFromBrowser();
            if (saved && generation === robotLoadGeneration) {
                const robot = setRobotFromContent(saved.content);
                const name = canonicalPresetName(saved.name);
                const oldLayout = saved.driveLayoutVersion !== 4;
                showLoadedRobot(robot, name, false, oldLayout);
                const repairBackViewLayout = !oldLayout && cachedPresetNeedsBackViewRepair(robot, name);
                if (repairBackViewLayout) showLoadedRobot(robot, name, false, true);
                if (oldLayout || repairBackViewLayout || name !== saved.name) await saveRobotToBrowser(robot, hub, name);
                if ($componentStore.unresolved.length > 0) await ensureStudioLibrary(generation);
            }
        } catch (error) {
            console.warn('Could not restore the cached robot', error);
        }
        try {
            if ($componentStore.unresolved.length > 0) {
                const library = await loadLibraryFromBrowser();
                if (library) await resolveFromZip(library);
            }
        } catch (error) {
            console.warn('Could not restore the cached LDraw library', error);
        }
    }

    function refreshResolvedRobot(generation: number) {
        if (generation !== robotLoadGeneration) return;
        const robot = $sceneStore.robot.bricks;
        if (!robot) return;
        compiledRobot = compiler.compileModel(robot, { rescale: false });
        scenePreviewReady = false;
        sceneStore.update((old) => ({
            ...old,
            robot: {
                ...old.robot,
                compiled: undefined,
                position: {
                    ...(old.robot.position ?? { x: 0, y: 0, z: 0 }),
                    y: robotStartHeight()
                }
            }
        }));
        scene = copyScene($sceneStore);
    }

    async function ensureStudioLibrary(generation: number) {
        if (libraryGeneration === generation || $componentStore.unresolved.length === 0) return;
        libraryGeneration = generation;
        libraryLoading = true;
        libraryError = '';
        try {
            libraryStatus = 'Checking saved parts library…';
            let cached: Blob | undefined;
            try {
                cached = await loadLibraryFromBrowser();
            } catch (error) {
                console.warn('Could not read the saved parts library', error);
            }
            if (generation !== robotLoadGeneration) return;
            if (cached) {
                try {
                    await resolveFromZip(cached);
                    refreshResolvedRobot(generation);
                } catch (error) {
                    console.warn('Saved parts library could not be applied', error);
                }
            }
            if ($componentStore.unresolved.length > 0) {
                libraryStatus = 'Downloading the official LDraw parts library…';
                const archive = await downloadOfficialLibrary();
                if (generation !== robotLoadGeneration) return;
                await resolveFromZip(archive);
                refreshResolvedRobot(generation);
                void saveLibraryToBrowser(archive).catch((error) =>
                    console.warn('Could not retain the downloaded parts library', error)
                );
            }
            if ($componentStore.unresolved.length > 0) {
                libraryError = `${$componentStore.unresolved.length} parts are still missing. Choose an LDraw ZIP with the Library button.`;
            }
        } catch (error) {
            console.warn('Could not load Studio robot parts automatically', error);
            libraryError = 'Automatic parts download failed. Choose an LDraw ZIP with the Library button.';
        } finally {
            if (libraryGeneration === generation) {
                libraryStatus = '';
                libraryLoading = false;
            }
        }
    }

    function showLoadedRobot(robot: Model, name: string, studio = false, remapDrive = true) {
        runSimulation = false;
        resetRobotView();
        scenePreviewReady = false;
        libraryError = '';
        compiledRobot = compiler.compileModel(robot, { rescale: false });
        hub.reload();
        updateGyro();
        connectPorts(hub, robot);
        connectWheels(hub, robot);
        if (studio) {
            connectStudioDrive(hub, robot);
        }
        connectAttachments(hub, robot);
        connectPresetGears(hub, robot);
        configurePresetDrive(hub, robot, name, remapDrive);
        loadWheelTransforms(hub, robot);
        hub = hub;
        sceneStore.update((old) => ({
            ...old,
            robot: {
                ...old.robot,
                name,
                bricks: robot,
                compiled: undefined,
                position: { x: DEFAULT_MAT_START_X, y: robotStartHeight(), z: DEFAULT_MAT_START_Z },
                rotation: launchHeading()
            }
        }));
        scene = copyScene($sceneStore);
    }

    async function loadStudioBot(data: Blob, name: string, generation: number) {
        const zipFile = await new JSZip().loadAsync(data);
        const file = zipFile.file('model2.ldr');
        if (!file) throw new Error('Studio model2.ldr was not found');
        const content = await file.async('string');
        if (generation !== robotLoadGeneration) return;
        try {
            setStudioMode(true);
            const robot = setRobotFromContent(content);
            showLoadedRobot(robot, name, true);
            void saveRobotToBrowser(robot, hub, name).catch((error) =>
                console.warn('Could not cache the loaded robot', error)
            );
        } finally {
            setStudioMode(false);
        }
        await ensureStudioLibrary(generation);
    }

    async function loadPreset(preset: 'trainer' | 'attachments' | 'fll-mpd') {
        const generation = ++robotLoadGeneration;
        try {
            if (preset === 'trainer') {
                const robot = setRobotFromContent(trainerMpd);
                showLoadedRobot(robot, DIFFERENTIAL_DRIVE_NAME);
                void saveRobotToBrowser(robot, hub, DIFFERENTIAL_DRIVE_NAME).catch((error) =>
                    console.warn('Could not cache the drive trainer', error)
                );
            } else if (preset === 'attachments') {
                const response = await fetch(attachmentBotUrl);
                if (!response.ok) throw new Error('Could not load the bundled attachment robot');
                await loadStudioBot(await response.blob(), ATTACHMENT_DRIVE_NAME, generation);
            } else {
                const robot = setRobotFromContent(fllMpd);
                showLoadedRobot(robot, FLL_MPD_DRIVE_NAME);
                void saveRobotToBrowser(robot, hub, FLL_MPD_DRIVE_NAME).catch((error) =>
                    console.warn('Could not cache the FLL MPD robot', error)
                );
                await ensureStudioLibrary(generation);
            }
        } catch (error) {
            console.error('Could not load robot preset', error);
        }
    }

    async function loadRobot() {
        const element = document.getElementById('load_robot');
        if (element) {
            const fileElement = element as HTMLInputElement;
            if (fileElement.files) {
                if (fileElement.files.length > 0) {
                    const first = fileElement.files[0];
                    const generation = ++robotLoadGeneration;
                    numberOfLoads++;
                    if (first.name.toLowerCase().endsWith('.io')) {
                        await loadStudioBot(first, first.name.replace(/\.io$/i, ''), generation);
                    } else {
                        const robot = await setRobotFromFile(first);
                        if (generation !== robotLoadGeneration) return;
                        const name = first.name.replace(/\.(ldr|mpd)$/i, '');
                        showLoadedRobot(robot, name);
                        void saveRobotToBrowser(robot, hub, name).catch((error) =>
                            console.warn('Could not cache the loaded robot', error)
                        );
                        await ensureStudioLibrary(generation);
                    }
                }
            }
        }
    }

    async function loadLibrary() {
        const element = document.getElementById('load_library');
        if (element) {
            const fileElement = element as HTMLInputElement;
            if (fileElement.files) {
                if (fileElement.files.length > 0) {
                    const first = fileElement.files[0];
                    numberOfLoads++;
                    await resolveFromZip(first);
                    libraryError = $componentStore.unresolved.length > 0
                        ? `${$componentStore.unresolved.length} parts are still missing from that ZIP.`
                        : '';
                    refreshResolvedRobot(robotLoadGeneration);
                    try {
                        await saveLibraryToBrowser(first);
                    } catch (error) {
                        console.warn('Could not cache the LDraw library ZIP', error);
                    }
                }
            }
        }
    }

    function handleHubEvent(event: string, value: string) {
        if (event == 'screen') {
            hubImage = value;
        }
        if (event == 'hubButtonColour') {
            hubCentreButtonColour = value;
        }
    }

    function stepVM(timestamp: number) {
        if (!vm) {
            return;
        }
        if (vm.id != vm.hub.id) {
            return;
        }
        const frameTime = timestamp - lastFrame;
        if (vm.state == 'running') {
            if (lastFrame > 0) {
                let seconds = frameTime / 1000.0;
                if (seconds > 2.0) {
                    // Browser must have paused us
                    // don't do more than 2 seconds
                    seconds = 2.0;
                }
                vm.step(seconds, scene);
            } else {
                vm.step(0.0, scene);
            }
            updateDriveWarning();
            updateGyro();
            requestAnimationFrame(stepVM);
        }
        lastFrame = timestamp;
    }

    function updateDriveWarning() {
        const linked = [...new Set(hub.wheels.map((wheel) => wheel.port))];
        const selected = [hub.movePair1, hub.movePair2];
        driveWarning = usesMovementPair && linked.length === 2 &&
            selected.some((port) => !linked.includes(port))
            ? `Code uses ${selected.join('/')}; drive wheels are connected to ${linked.join('/')}. An unmatched motor will not drive a wheel.`
            : '';
    }

    function startOrPauseSimulation(start: boolean) {
        if (start) {
            if (vm) {
                vm.stop();
                hubImage = '0000000000000000000000000';
                hubCentreButtonColour = '#ffffff';
            }
            const selected = Blockly.common.getSelected();
            if (selected) {
                selected.unselect();
            }
            hub.setEventHandler(handleHubEvent);
            hub.reset();
            updateGyro();
            usesMovementPair = workspace?.getAllBlocks(false).some((block) => block.type === 'flippermove_setMovementPair') ?? false;
            driveWarning = '';
            let sensorList: SensorView[] = [];
            if (hub.ports.A.type != 'none') {
                sensorList.push({ id: hub.ports.A.id(), port: 'A', type: hub.ports.A.type });
            }
            if (hub.ports.B.type != 'none') {
                sensorList.push({ id: hub.ports.B.id(), port: 'B', type: hub.ports.B.type });
            }
            if (hub.ports.C.type != 'none') {
                sensorList.push({ id: hub.ports.C.id(), port: 'C', type: hub.ports.C.type });
            }
            if (hub.ports.D.type != 'none') {
                sensorList.push({ id: hub.ports.D.id(), port: 'D', type: hub.ports.D.type });
            }
            if (hub.ports.E.type != 'none') {
                sensorList.push({ id: hub.ports.E.id(), port: 'E', type: hub.ports.E.type });
            }
            if (hub.ports.F.type != 'none') {
                sensorList.push({ id: hub.ports.F.id(), port: 'F', type: hub.ports.F.type });
            }
            sensors = sensorList;
            const globals: Namespace = {};
            if (workspace) {
                let variables = workspace.getVariablesOfType('Number');
                for (let i = 0; i < variables.length; i++) {
                    globals[variables[i].name] = new StringValue('0');
                }
                variables = workspace.getVariablesOfType('String');
                for (let i = 0; i < variables.length; i++) {
                    globals[variables[i].name] = new StringValue('0');
                }
                variables = workspace.getVariablesOfType('list');
                for (let i = 0; i < variables.length; i++) {
                    globals[variables[i].name] = new ListValue([]);
                }
            }
            hub = hub;
            scene = copyScene($sceneStore);
            vm = new VM(id, hub, globals, $codeStore.events, $codeStore.procedures, workspace);
            vm.start();
            lastFrame = 0;
            requestAnimationFrame(stepVM);
        } else {
            driveWarning = '';
            if (vm) {
                vm.stop();
                hubImage = '0000000000000000000000000';
                hubCentreButtonColour = '#ffffff';
            }
        }
    }

    function hubLeftPress() {
        if (vm) {
            vm.hub.leftPressed = true;
        }
    }

    function hubRightPress() {
        if (vm) {
            vm.hub.rightPressed = true;
        }
    }

    function hubLeftRelease() {
        if (vm) {
            vm.hub.leftPressed = false;
        }
    }

    function hubRightRelease() {
        if (vm) {
            vm.hub.rightPressed = false;
        }
    }

    $: startOrPauseSimulation(runSimulation);
    $: if (presetToLoad) {
        const preset = presetToLoad;
        presetToLoad = null;
        void loadPreset(preset);
    }
</script>

<div class="flex flex-col h-full p-2 overflow-y-scroll relative">
    {#key numberOfLoads}
        <input
            type="file"
            id="load_robot"
            class="hidden"
            accept=".ldr,.mpd,.io"
            on:change={loadRobot}
        />
        <input type="file" id="load_library" class="hidden" accept=".zip" on:change={loadLibrary} />
    {/key}
    {#if !compiledRobot && !runSimulation}
        <div class="m-2">
            Use LeoCad (<a href="https://www.leocad.org/" target="_blank">https://www.leocad.org/</a
            >) to create a model for your robot or Bricklink Studio (<a
                href="https://www.bricklink.com/v3/studio/download.page"
                target="_blank">https://www.bricklink.com/v3/studio/download.page</a
            >). Then upload the robot.
        </div>
        <div class="m-2">
            <span
                >Load the robot by clicking the
                <img class="inline mx-2" alt="robot" width="32" height="32" src="icons/Robot.svg" />
                icon. Then setup or load the scene to run the robot in by clicking on the
                <img class="inline mx-2" alt="scene" width="32" height="32" src="icons/Scene.svg" />
                icon.</span
            >
        </div>
        <div class="m-2">
            You may need to upload the component library (complete.zip) to load your model (<a
                href="https://library.ldraw.org/updates?latest"
                target="_blank">https://library.ldraw.org/updates?latest</a
            >). Check to see if there are any missing parts to see if the library needs to be
            loaded. The
            <img class="inline mx-2" alt="scene" width="32" height="32" src="icons/Library.svg" /> icon
            will bounce if additional parts are needed. Click on it to load parts.
        </div>
        <div class="m-2">
            Always load the robot before the library, only missing bricks are loaded from the
            library.
        </div>
    {/if}

    <div class="w-full h-full relative overflow-hidden" hidden={!compiledRobot && !runSimulation}>
        <div class="flex flex-row w-full h-full">
            {#if sideRailOpen}<div class="flex w-[226px] shrink-0 flex-col gap-2 overflow-y-auto px-2">
                <div class="relative">
                    <button class="w-full rounded border bg-white px-3 py-2 text-left text-sm" aria-expanded={panelMenuOpen} on:click={() => (panelMenuOpen = !panelMenuOpen)}>
                        Panels ▾
                    </button>
                    <button class="mt-1 w-full rounded border bg-white px-3 py-1 text-left text-xs" on:click={() => (sideRailOpen = false)}>Hide side panels</button>
                    {#if panelMenuOpen}
                        <div class="absolute left-0 top-full z-30 w-full rounded border bg-white p-1 shadow-lg">
                            <button class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-blue-50" on:click={() => setPanel('hub', 'expanded')}>Show virtual hub</button>
                            <button class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-blue-50" on:click={() => setPanel('led', 'expanded')}>Show LED matrix</button>
                            <button class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-blue-50" on:click={() => setPanel('gyro', 'expanded')}>Show gyroscope</button>
                        </div>
                    {/if}
                </div>
                {#if panelState.hub !== 'closed'}
                    <section class="rounded-xl border bg-gray-50 p-2">
                        <div class="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-gray-700">
                            <span class="flex-1">Virtual hub</span>
                            <button class="rounded border px-1" aria-label="Minimize virtual hub" title="Minimize" on:click={() => setPanel('hub', panelState.hub === 'expanded' ? 'minimized' : 'expanded')}>−</button>
                            <button class="rounded border px-1" aria-label="Close virtual hub" title="Close" on:click={() => setPanel('hub', 'closed')}>×</button>
                        </div>
                        {#if panelState.hub === 'expanded'}
                            <HubWidget
                                image={hubImage}
                                centreButtonColour={hubCentreButtonColour}
                                on:leftPress={hubLeftPress}
                                on:rightPress={hubRightPress}
                                on:leftRelease={hubLeftRelease}
                                on:rightRelease={hubRightRelease}
                                on:centerPress={() => (runSimulation = !runSimulation)}
                            />
                            <p class="mt-2 text-xs text-gray-600">Center starts or stops the program. Left/right buttons send program events while it runs; the 5×5 lights mirror its output.</p>
                        {/if}
                    </section>
                {/if}
                {#if panelState.led !== 'closed'}
                    <section class="rounded-xl border bg-gray-50 p-2">
                        <div class="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-gray-700">
                            <span class="flex-1">LED matrix</span>
                            <button class="rounded border px-1" aria-label="Minimize LED matrix" title="Minimize" on:click={() => setPanel('led', panelState.led === 'expanded' ? 'minimized' : 'expanded')}>−</button>
                            <button class="rounded border px-1" aria-label="Close LED matrix" title="Close" on:click={() => setPanel('led', 'closed')}>×</button>
                        </div>
                        {#if panelState.led === 'expanded'}<LedMatrixDisplay image={hubImage} />{/if}
                    </section>
                {/if}
                {#if runSimulation}
                    {#each sensors as sensor}
                        {#if sensor.type == 'light'}
                            <span class="text-sm mt-2">
                                Port {sensor.port}: Colour sensor
                            </span>
                            <ColourSensor
                                id={`sensor_view_${sensor.port}`}
                                {scene}
                                class="h-14 w-14"
                                map={$sceneStore.map}
                                lightSensorId={sensor.id}
                                {hub}
                                port={sensor.port}
                            />
                        {:else if sensor.type == 'force'}
                            <span class="text-sm mt-2">
                                Port {sensor.port}: Force sensor
                            </span>
                            <ForceCheckSensor
                                id={`sensor_view_${sensor.port}`}
                                {scene}
                                class="h-14 w-14"
                                map={$sceneStore.map}
                                forceSensorId={sensor.id}
                                {hub}
                                port={sensor.port}
                            />
                        {:else if sensor.type == 'distance'}
                            <span class="text-sm mt-2">
                                Port {sensor.port}: Distance sensor
                            </span>
                            <DistanceSensor
                                id={`sensor_view_${sensor.port}`}
                                {scene}
                                class="h-14 w-14"
                                map={$sceneStore.map}
                                distanceSensorId={sensor.id}
                                {hub}
                                port={sensor.port}
                            />
                        {/if}
                    {/each}
                {/if}
            </div>{/if}
            <div class="relative overflow-hidden w-full h-full">
                <ScenePreview
                    id="scene_preview"
                    class="w-full h-full"
                    scene={runSimulation ? scene : $sceneStore}
                    map={$sceneStore.map}
                    rotate={false}
                    {camera}
                    {robotFocus}
                    {tilt}
                    bind:orbitYaw={viewYaw}
                    bind:orbitPitch={viewPitch}
                    bind:zoom={viewZoom}
                    bind:panX={viewPanX}
                    bind:panZ={viewPanZ}
                    on:resetView={resetSimulatorView}
                    bind:ready={scenePreviewReady}
                    bind:loadError={scenePreviewError}
                    unresolved={$componentStore.unresolved}
                    select="#all"
                    interactive={true}
                    {hub}
                    enabled={!connectorOpen && !sceneOpen && !wheelsOpen && !attachmentsOpen}
                />
                {#if !runSimulation && connectionFlags.length > 0}
                    <section class="absolute left-3 bottom-3 z-20 max-w-[min(32rem,calc(100%-1.5rem))] rounded-lg border border-slate-300 bg-white/95 p-2 shadow" aria-label="Connected motors and sensors">
                        <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Connections before start</div>
                        <div class="flex flex-wrap gap-1">
                            {#each connectionFlags as connection}
                                <span class="rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-800" title={connection.detail}>
                                    <strong>{connection.port}</strong> {connection.label}
                                </span>
                            {/each}
                        </div>
                    </section>
                {/if}
                <button class="absolute left-3 top-3 z-20 rounded border bg-white/95 px-2 py-1 text-xs shadow" aria-label={sideRailOpen ? 'Collapse simulator side panels' : 'Expand simulator side panels'} on:click={() => (sideRailOpen = !sideRailOpen)}>{sideRailOpen ? 'Hide panels' : 'Show panels'}</button>
                {#if panelState.gyro !== 'closed'}
                    <section class="absolute right-3 top-3 z-20 w-56 rounded-lg border bg-white/95 p-2 text-xs shadow" aria-label="Gyroscope data">
                        <div class="flex items-center gap-1 font-semibold"><span class="flex-1">Gyroscope</span><button aria-label="Minimize gyroscope" on:click={() => setPanel('gyro', panelState.gyro === 'expanded' ? 'minimized' : 'expanded')}>−</button><button aria-label="Close gyroscope" on:click={() => setPanel('gyro', 'closed')}>×</button></div>
                        {#if panelState.gyro === 'expanded'}<div class="mt-1 grid grid-cols-3 gap-1 text-center"><div>Yaw<br />{gyro.yaw.toFixed(1)}°</div><div>Pitch<br />{gyro.pitch.toFixed(1)}°</div><div>Roll<br />{gyro.roll.toFixed(1)}°</div></div><div class="mt-1">Turn: {gyro.rate.toFixed(1)}°/s</div><div>Accel X/Z: {gyro.accelerationX.toFixed(2)} / {gyro.accelerationZ.toFixed(2)} m/s²</div>{/if}
                    </section>
                {/if}
                {#if runSimulation && driveWarning}
                    <div class="absolute left-3 top-3 z-10 max-w-sm rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-950" role="alert">
                        {driveWarning}
                    </div>
                {/if}
                {#if scenePreviewError || libraryError || libraryLoading || !scenePreviewReady || $componentStore.unresolved.length > 0}
                    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/90" role="status" aria-live="polite">
                        {#if scenePreviewError}
                            <span class="max-w-sm text-center text-red-700">{scenePreviewError}</span>
                        {:else if libraryError}
                            <span class="max-w-sm text-center text-red-700">{libraryError}</span>
                        {:else}
                            <span>{libraryStatus || 'Loading robot and scene…'}</span>
                            <div class="h-2 w-64 overflow-hidden rounded bg-gray-200">
                                <div class="h-full w-1/2 animate-pulse rounded bg-blue-600"></div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>
