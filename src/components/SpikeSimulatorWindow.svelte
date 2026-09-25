<script lang="ts">
    import { onMount } from 'svelte';
    import * as Blockly from 'blockly/core';
    import { CogOutline } from 'flowbite-svelte-icons';
    import { Button, CloseButton, Tooltip } from 'flowbite-svelte';
    import MenuDropdown from '$components/MenuDropdown.svelte';
    import { type MenuAction } from '$components/Menu.svelte';
    import HubIcon from '$components/HubIcon.svelte';
    import SpikeSimulator from '$components/SpikeSimulator.svelte';
    import SaveSimulation from '$components/SaveSimulation.svelte';
    import SimulatorSettings from '$components/SimulatorSettings.svelte';
    import PortConnector from '$components/PortConnector.svelte';
    import WheelConnector from '$components/WheelConnector.svelte';
    import AttachmentConnector from '$components/AttachmentConnector.svelte';
    import LoadScene from '$components/LoadScene.svelte';
    import { type LDrawStore, componentStore, saveMPD } from '$lib/ldraw/components';
    import { resolveFromZip } from '$lib/ldraw/components';
    import {
        downloadOfficialLibrary,
        loadLibraryFromBrowser,
        saveLibraryToBrowser
    } from '$lib/robot-cache';
    import { Hub, codeStore } from '$lib/spike/vm';
    import { ATTACHMENT_DRIVE_NAME, DIFFERENTIAL_DRIVE_NAME, FLL_MPD_DRIVE_NAME } from '$lib/spike/presets';
    import { sceneStore } from '$lib/spike/scene';
    import { saveRobotToBrowser } from '$lib/robot-cache';
    import trainerMpd from '$lib/assets/robots/DifferentialDriveBot.mpd?raw';
    import attachmentBotUrl from '$lib/assets/robots/DriveAndAttachmentBot.io?url';
    import fllMpd from '$lib/assets/robots/FLLAttachmentBot.mpd?raw';
    import bioglowWireframeUrl from '$lib/assets/scenes/bioglow-wireframe.jpg?url';
    import orientationMap from '$lib/assets/scenes/orientation-map.svg?raw';
    import FileSaver from 'file-saver';
    import {
        spikeGenerator,
        resetCode,
        getCodeEvents,
        getCodeProcedures
    } from '$lib/blockly/generator';

    export let modalOpen = false;
    export let blocklyOpen: boolean;
    export let workspace: Blockly.WorkspaceSvg | undefined;
    export let split = 2;
    let hub = new Hub();

    let connectorOpen = false;
    let wheelsOpen = false;
    let attachmentsOpen = false;
    let presetToLoad: 'trainer' | 'attachments' | 'fll-mpd' | null = null;
    let saveOpen = false;
    let sceneOpen = false;
    let settingsOpen = false;
    let robotButtonColour: 'light' | 'red' | 'green' = 'light';
    let libraryClass = '!p-2';
    let libraryBusy = false;
    let libraryError = '';
    let wireMapLoading = false;
    let mapLoaded = false;
    let mapMode: 'wire' | 'orientation' = 'wire';
    let resetViewRequest = 0;
    let runSimulation = false;
    // cameraOpen is used as a bind variable, but reported as unused by es-lint
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let cameraOpen = false;
    // Show the gear-facing robot view as soon as the simulator opens.
    let camera: 'top' | 'left' | 'right' | 'front' | 'back' | 'adaptive' = 'back';
    // Open from the gear-facing back with the widest useful mat view. Users
    // can switch to a robot close-up with the Robot view / Map view button.
    let robotFocus = false;
    let tilt = true;

    let cameraMenu = buildCameraMenu();
    const robotMenu: MenuAction[] = [
        { name: `Load ${DIFFERENTIAL_DRIVE_NAME} · A/B drive`, action: () => (presetToLoad = 'trainer') },
        { name: `Load ${ATTACHMENT_DRIVE_NAME} · A/B drive`, action: () => (presetToLoad = 'attachments') },
        { name: `Load ${FLL_MPD_DRIVE_NAME} · A/B drive`, action: () => (presetToLoad = 'fll-mpd') },
        { name: 'Open robot file…', action: askForRobot },
        { name: `Download ${DIFFERENTIAL_DRIVE_NAME} (.mpd)`, action: downloadTrainer },
        { name: `Download ${ATTACHMENT_DRIVE_NAME} (.io)`, action: () => void downloadAttachmentBot() },
        { name: `Download ${FLL_MPD_DRIVE_NAME} (.mpd)`, action: downloadFllMpd },
        { name: 'Download current robot (.mpd)', action: downloadCurrentRobot }
    ];

    function downloadTrainer() {
        FileSaver.saveAs(new Blob([trainerMpd], { type: 'text/plain' }), 'SimpleBot.mpd');
    }

    async function downloadAttachmentBot() {
        try {
            const response = await fetch(attachmentBotUrl);
            if (!response.ok) throw new Error('Bundled attachment robot could not be loaded');
            FileSaver.saveAs(await response.blob(), 'FLLAttachmentBot.io');
        } catch (error) {
            console.error('Could not download the attachment robot', error);
        }
    }

    function downloadFllMpd() {
        FileSaver.saveAs(new Blob([fllMpd], { type: 'text/plain' }), 'FLLAttachmentBot.mpd');
    }

    function downloadCurrentRobot() {
        const robot = $componentStore.robotModel;
        if (!robot) return;
        const name = $sceneStore.robot.name.replace(/[<>:"/\\|?*]/g, '_');
        void saveRobotToBrowser(robot, hub, name).catch((error) =>
            console.warn('Could not cache the downloaded robot', error)
        );
        FileSaver.saveAs(new Blob([saveMPD(robot)], { type: 'text/plain' }), `${name}.mpd`);
    }

    function buildCameraMenu(): MenuAction[] {
        return [
            {
                name: 'Default view',
                action: () => {
                    camera = 'adaptive';
                    tilt = true;
                    robotFocus = false;
                    cameraMenu = buildCameraMenu();
                },
                radio: camera == 'adaptive'
            },
            {
                name: 'View left',
                action: () => {
                    camera = 'left';
                    cameraMenu = buildCameraMenu();
                },
                radio: camera == 'left'
            },
            {
                name: 'View right',
                action: () => {
                    camera = 'right';
                    cameraMenu = buildCameraMenu();
                },
                radio: camera == 'right'
            },
            {
                name: 'View back',
                action: () => {
                    camera = 'back';
                    cameraMenu = buildCameraMenu();
                },
                radio: camera == 'back'
            },
            {
                name: 'View front',
                action: () => {
                    camera = 'front';
                    cameraMenu = buildCameraMenu();
                },
                radio: camera == 'front'
            },
            {
                name: 'View top',
                action: () => {
                    camera = 'top';
                    tilt = false;
                    robotFocus = false;
                    cameraMenu = buildCameraMenu();
                },
                radio: camera == 'top'
            },
            {
                name: 'Tilt view',
                action: () => {
                    tilt = !tilt;
                    cameraMenu = buildCameraMenu();
                },
                toggle: tilt
            },
            {
                name: 'Robot view',
                action: () => {
                    robotFocus = !robotFocus;
                    if (robotFocus) {
                        camera = 'back';
                        tilt = true;
                    }
                    cameraMenu = buildCameraMenu();
                },
                toggle: robotFocus
            }
        ];
    }

    function closeWindow() {
        modalOpen = false;
    }

    function openBlockly() {
        blocklyOpen = true;
    }

    function askForRobot() {
        const element = document.getElementById('load_robot');
        if (element) {
            element.click();
        }
    }

    async function askForLibrary() {
        if (libraryBusy) return;
        libraryBusy = true;
        libraryError = '';
        try {
            let zip: Blob | undefined;
            try {
                zip = await loadLibraryFromBrowser();
            } catch (error) {
                console.warn('Could not read the cached LDraw library', error);
            }
            if (!zip) {
                zip = await downloadOfficialLibrary();
                try {
                    await saveLibraryToBrowser(zip);
                } catch (error) {
                    console.warn('The LDraw library downloaded but could not be cached', error);
                    libraryError = 'Library loaded, but browser storage is full.';
                }
            }
            await resolveFromZip(zip);
        } catch (error) {
            console.warn('Could not download the LDraw library', error);
            libraryError = 'Automatic download failed. Download the ZIP, then choose it here.';
            document.getElementById('load_library')?.click();
        } finally {
            libraryBusy = false;
        }
    }

    function updateButtons(store: LDrawStore) {
        if (!store.robotModel) {
            robotButtonColour = 'light';
        } else {
            if (store.unresolved.length > 0) {
                robotButtonColour = 'red';
            } else {
                robotButtonColour = 'green';
            }
        }
        if (store.unresolved.length > 0) {
            libraryClass = '!p-2 animate-bounce';
        } else {
            libraryClass = '!p-2';
        }
    }

    function startRobot() {
        resetCode();
        const code = spikeGenerator.workspaceToCode(workspace);
        console.log('=======');
        console.log(code);
        console.log('=======');
        console.log(getCodeProcedures());
        codeStore.set({ events: getCodeEvents(), procedures: getCodeProcedures() });
        runSimulation = true;
    }

    function stopRobot() {
        runSimulation = false;
    }

    function handleSpaceShortcut(event: KeyboardEvent) {
        if (
            !modalOpen ||
            event.code !== 'Space' ||
            event.repeat ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            connectorOpen ||
            wheelsOpen ||
            attachmentsOpen ||
            saveOpen ||
            sceneOpen ||
            settingsOpen
        ) {
            return;
        }
        if (
            event.target instanceof Element &&
            event.target.closest('input, textarea, select, [contenteditable], [role="textbox"]')
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (runSimulation) {
            stopRobot();
        } else {
            startRobot();
        }
    }

    onMount(() => {
        window.addEventListener('keydown', handleSpaceShortcut, true);
        return () => window.removeEventListener('keydown', handleSpaceShortcut, true);
    });

    function saveRobotOrScene() {
        saveOpen = true;
    }

    function connectPorts() {
        connectorOpen = true;
    }

    function connectWheels() {
        wheelsOpen = true;
    }

    function connectAttachments() {
        attachmentsOpen = true;
    }

    function loadScene() {
        sceneOpen = true;
    }

    async function loadMap(mode: 'wire' | 'orientation') {
        if (wireMapLoading) return;
        wireMapLoading = true;
        try {
            let map: Blob;
            if (mode === 'wire') {
                const response = await fetch(bioglowWireframeUrl);
                if (!response.ok) throw new Error(`Wireframe map request failed: ${response.status}`);
                map = await response.blob();
            } else {
                map = new Blob([orientationMap], { type: 'image/svg+xml' });
            }
            sceneStore.update((old) => ({
                ...old,
                map,
                mapWidth: 2360,
                mapHeight: 1140,
                objects: []
            }));
            mapMode = mode;
            mapLoaded = true;
            robotFocus = false;
            camera = 'adaptive';
            tilt = true;
            cameraMenu = buildCameraMenu();
        } catch (error) {
            console.warn('Could not load the simulator map', error);
        } finally {
            wireMapLoading = false;
        }
    }

    function toggleMap() {
        void loadMap(!mapLoaded || mapMode === 'orientation' ? 'wire' : 'orientation');
    }

    function resetView() {
        resetViewRequest += 1;
        robotFocus = true;
        camera = 'back';
        tilt = true;
        cameraMenu = buildCameraMenu();
    }

    function toggleRobotView() {
        robotFocus = !robotFocus;
        if (robotFocus) {
            camera = 'back';
            tilt = true;
        }
        cameraMenu = buildCameraMenu();
    }

    function openSettings() {
        settingsOpen = true;
    }

    $: updateButtons($componentStore);
    // The default simulator scene is supplied by SpikeSimulator after its
    // bundled map has been fetched. Reflect that state in the map toggle so
    // the first click switches to the orientation map instead of reloading the
    // wire map.
    $: if (!mapLoaded && $sceneStore.map) {
        mapLoaded = true;
        mapMode = 'wire';
    }
    // Keep the camera menu radio/toggle state in sync when a robot load resets
    // the view from inside SpikeSimulator.
    $: cameraMenu = buildCameraMenu();
</script>

<PortConnector bind:modalOpen={connectorOpen} bind:hub />
<WheelConnector bind:modalOpen={wheelsOpen} bind:hub />
<AttachmentConnector bind:modalOpen={attachmentsOpen} bind:hub />
<SaveSimulation bind:modalOpen={saveOpen} bind:hub />
<LoadScene bind:modalOpen={sceneOpen} />
<SimulatorSettings bind:modalOpen={settingsOpen} />
{#if modalOpen}
    <div class="{split == 1 ? 'flex-1' : 'flex-[2]'} h-full overflow-hidden">
        <div class="relative flex-1 h-full flex flex-col overflow-hidden">
            <div
                class="flex flex-row bg-gray-100 gap-2 p-2 items-center border-b border-b-gray-300 z-10 flex-wrap"
            >
                <div class="w-8 h-8 flex flex-col justify-center items-center">
                    <img alt="code" width="32" height="32" src="icons/Brick.svg" />
                </div>
                <Button color={robotButtonColour} class="!p-2" id="robot_menu_button">
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <img alt="robot" width="32" height="32" src="icons/Robot.svg" />
                    </div>
                </Button>
                <MenuDropdown name="robots" actions={robotMenu} class="bg-white rounded-2xl" />
                <Tooltip triggeredBy="#robot_menu_button">Load or download a robot</Tooltip>
                <Button color="light" class="!p-2" on:click={connectPorts}>
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <HubIcon />
                    </div>
                </Button>
                <Tooltip>Connect ports on the spike hub of the robot</Tooltip>
                <Button color="light" class="!p-2" on:click={connectWheels}>
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <img alt="scene" width="32" height="32" src="icons/wheel.svg" />
                    </div>
                </Button>
                <Tooltip>Connect wheels to motors of the robot</Tooltip>
                <Button color="light" class="!p-2" on:click={connectAttachments}>
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <img alt="attachments" width="32" height="32" src="icons/Motors.svg" />
                    </div>
                </Button>
                <Tooltip>Connect gears and moving attachments to motors</Tooltip>
                <Button color="light" class="!p-2" on:click={loadScene}>
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <img alt="scene" width="32" height="32" src="icons/Scene.svg" />
                    </div>
                </Button>
                <Tooltip>Setup or load a scene based on a WRO or FLL mat</Tooltip>
                <Button color="light" class={libraryClass} on:click={askForLibrary} disabled={libraryBusy}>
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <img alt="scene" width="32" height="32" src="icons/Library.svg" />
                    </div>
                </Button>
                <Tooltip>Download or reuse the cached LDraw parts library (complete.zip)</Tooltip>
                {#if libraryBusy}<span class="text-xs">Loading parts library…</span>{/if}
                {#if libraryError}
                    <span class="text-xs text-red-700">
                        {libraryError}
                        <a
                            class="underline"
                            href="https://library.ldraw.org/library/updates/complete.zip"
                            target="_blank"
                            rel="noopener noreferrer">Official ZIP</a
                        >
                    </span>
                {/if}
                <Button color="light" class="!p-2" on:click={saveRobotOrScene}>
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <img alt="save" width="32" height="32" src="icons/SaveMedium.svg" />
                    </div>
                </Button>
                <Tooltip
                    >Save the robot with ports and wheels, or the scene (without the robot)</Tooltip
                >
                <Button color="light" class="!p-2" on:click={openSettings}>
                    <CogOutline class="w-8 h-8" />
                </Button>
                <Tooltip>Adjust simulator speed settings</Tooltip>
                <Button id="camera_config_button" color="light" class="!p-2">
                    <div class="w-8 h-8 flex flex-col justify-center items-center">
                        <img alt="eye" width="32" height="32" src="icons/Eye.svg" />
                    </div>
                </Button>
                <MenuDropdown
                    name="camera"
                    actions={cameraMenu}
                    rounded={true}
                    class="bg-white rounded-2xl"
                />
                <Tooltip triggeredBy="#camera_config_button">Set camera for simulator</Tooltip>
                <Button id="wire_map_button" color="light" class="!px-3 !py-2" on:click={toggleMap} disabled={wireMapLoading}>
                    <span class="text-xs font-semibold">{wireMapLoading ? 'Loading...' : !mapLoaded ? 'FLL BIOGLOW wire map' : mapMode === 'wire' ? 'Orientation map' : 'FLL BIOGLOW wire map'}</span>
                </Button>
                <Tooltip triggeredBy="#wire_map_button">Toggle between the FLL BIOGLOW wire map and the orientation map (2360 x 1140 mm)</Tooltip>
                <Button id="reset_view_button" color="light" class="!px-3 !py-2" on:click={resetView}>
                    <span class="text-xs font-semibold">Reset view</span>
                </Button>
                <Tooltip triggeredBy="#reset_view_button">Focus the robot in the tilted gear-facing view</Tooltip>
                <Button id="robot_view_button" color={robotFocus ? 'blue' : 'light'} class="!px-3 !py-2" on:click={toggleRobotView}>
                    <span class="text-xs font-semibold">{robotFocus ? 'Map view' : 'Robot view'}</span>
                </Button>
                <Tooltip triggeredBy="#robot_view_button">Toggle between the full map and robot-focused view</Tooltip>
                {#if runSimulation}
                    <Button color="light" class="!p-2" on:click={stopRobot}>
                        <div class="w-8 h-8 flex flex-col justify-center items-center">
                            <img
                                alt="stop"
                                width="32"
                                height="32"
                                src="icons/GenericStopIcon.svg"
                            />
                        </div>
                    </Button>
                    <Tooltip>Stop the simulation (Space)</Tooltip>
                {:else}
                    <Button color="light" class="!p-2" on:click={startRobot}>
                        <div class="w-8 h-8 flex flex-col justify-center items-center">
                            <img
                                alt="play"
                                width="32"
                                height="32"
                                src="icons/GenericPlayIcon.svg"
                            />
                        </div>
                    </Button>
                    <Tooltip
                        >Start the simulation, running the code in the code panel (Space)</Tooltip
                    >
                {/if}
                {#if !blocklyOpen}
                    <Button color="light" class="!p-2" on:click={openBlockly}>
                        <div class="w-8 h-8 flex flex-col justify-center items-center">
                            <img alt="blockly" width="32" height="32" src="icons/BlocklyIcon.svg" />
                        </div>
                    </Button>
                    <Tooltip>Open the code panel</Tooltip>
                {/if}
                <div class="flex-1" />
                {#if blocklyOpen}
                    <CloseButton on:click={closeWindow} />
                    <Tooltip>Close the simulation window</Tooltip>
                {/if}
            </div>
            {#key blocklyOpen}
                <div class="flex-1 w-full overflow-hidden">
                    <SpikeSimulator
                        bind:runSimulation
                        bind:presetToLoad
                        {workspace}
                        bind:connectorOpen
                        bind:hub
                        bind:sceneOpen
                        bind:wheelsOpen
                        bind:attachmentsOpen
                        bind:camera
                        bind:tilt
                        bind:robotFocus
                        {resetViewRequest}
                    />
                </div>
            {/key}
        </div>
    </div>
{/if}
