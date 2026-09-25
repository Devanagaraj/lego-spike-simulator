<script lang="ts">
    import { Modal, Input } from 'flowbite-svelte';
    import {
        componentStore,
        findParts,
        findPartTransform,
        type Model,
        type PartMatch
    } from '$lib/ldraw/components';
    import { type PortType, Hub, Wheel } from '$lib/spike/vm';
    import { saveRobotToBrowser } from '$lib/robot-cache';
    import { sceneStore } from '$lib/spike/scene';
    import { type CompiledModel, WebGLCompiler } from '$lib/ldraw/gl';
    import HubWidget from '$components/HubWidget.svelte';
    import RobotPreview from '$components/RobotPreview.svelte';
    import * as m4 from '$lib/ldraw/m4';

    interface WheelMatch {
        part: PartMatch;
        wheel?: Wheel;
    }

    export let modalOpen = false;
    export let hub: Hub;
    const matchCodes = ['32019', '39367p01', '49295p01'];
    const partNames: Record<string, string> = {
        '32019': 'Tire 62.4 × 20 mm',
        '39367p01': 'Wheel', // Diameter 56mm
        '49295p01': 'Large Wheel' // Diameter 88mm
    };
    const partRadius: Record<string, number> = {
        '32019': 31.2,
        '39367p01': 28,
        '49295p01': 44
    };
    const motorCodes = ['54696', '54696p01', '68488', '54675'];
    const motorNames: Record<string, string> = {
        '54696': 'Medium motor',
        '54696p01': 'Medium motor',
        '68488': 'Small motor',
        '54675': 'Large motor'
    };
    let compiledRobot: CompiledModel | undefined = undefined;
    let compiler = new WebGLCompiler();
    let port: PortType | undefined;
    let parts: PartMatch[] = findParts($componentStore.robotModel, matchCodes);
    let wheels: WheelMatch[] = getWheels(parts, hub);
    let selectedWheel: number = -1;
    let selected: number[] = [];
    let gearing = 1;
    let radius = 0;
    let gearInfoOpen = false;

    function getWheels(parts: PartMatch[], hub: Hub) {
        const wheels: WheelMatch[] = [];
        for (const part of parts) {
            const wheel = hub.wheels.find((w) => w.id == part.id);
            wheels.push({ part: part, wheel: wheel });
        }
        return wheels;
    }

    function select(id: number, part: string) {
        selectedWheel = id;
        radius = partRadius[part] ?? 0;
        const wheel = hub.wheels.find((w) => w.id == id);
        if (wheel) {
            port = wheel.port;
            gearing = wheel.gearing;
            radius = wheel.radius;
        } else {
            port = undefined;
        }

        selected = [selectedWheel];
    }

    function handleCardKey(event: KeyboardEvent, id: number, part: string) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(id, part);
        }
    }

    function motorLabel(wheel: Wheel | undefined) {
        if (!wheel) return 'Motor: none';
        const motor = hub.ports[wheel.port]?.motor;
        if (!motor) return `Motor: none (Port ${wheel.port})`;
        const match = findParts($componentStore.robotModel, motorCodes).find((part) => part.id === motor.id);
        return `Motor: ${match ? motorNames[match.part] : 'motor'} · Port ${wheel.port}`;
    }

    function attach(toPort: PortType | undefined) {
        if (selectedWheel == -1) {
            return;
        }
        if (toPort && hub.ports[toPort].type !== 'motor') return;
        if (toPort) {
            port = toPort;
            let wheel = hub.wheels.find((w) => w.id == selectedWheel);
            if (wheel) {
                wheel.port = toPort;
            } else {
                const result = findPartTransform($componentStore.robotModel, selectedWheel);
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
                    wheel = new Wheel(selectedWheel, radius, gearing, toPort, matrix);
                    hub.wheels.push(wheel);
                }
            }
            const match = wheels.find((w) => w.part.id == selectedWheel);
            if (match) {
                match.wheel = wheel;
                // hub has been updated, so only update wheels in the next cycle
                setTimeout(() => {
                    wheels = wheels;
                }, 0);
            }
            selected = [selectedWheel];
            hub = hub;
            void saveRobotToBrowser($componentStore.robotModel, hub, $sceneStore.robot.name).catch(
                (error) => console.warn('Could not cache wheel selection', error)
            );
        }
    }

    function updateGearing() {
        if (selectedWheel == -1) {
            return;
        }
        const match = wheels.find((w) => w.part.id == selectedWheel);
        if (match && match.wheel) {
            match.wheel.gearing = gearing;
            wheels = wheels;
            hub = hub;
            void saveRobotToBrowser($componentStore.robotModel, hub, $sceneStore.robot.name).catch(
                (error) => console.warn('Could not cache wheel gearing', error)
            );
        }
    }

    function compileRobot(robot: Model | undefined) {
        if (robot === undefined) {
            return undefined;
        }
        const compiledRobot = compiler.compileModel(robot, { rescale: false });
        return compiledRobot;
    }

    $: parts = findParts($componentStore.robotModel, matchCodes);
    $: wheels = getWheels(parts, hub);
    $: compiledRobot = compileRobot($componentStore.robotModel);
</script>

<Modal
    backdropClass="fixed inset-0 z-[80] bg-gray-900 bg-opacity-50 dark:bg-opacity-80"
    dialogClass="fixed top-0 start-0 end-0 h-modal md:inset-0 md:h-full z-[90] w-full p-4 flex"
    title="Connect wheels"
    size="xl"
    outsideclose={true}
    bind:open={modalOpen}
>
    <div class="flex flex-row gap-2 h-[75dvh] overflow-hidden">
        <div class="flex-1 flex flex-row gap-4 mb-4 overflow-hidden">
            <HubWidget
                bind:selectedPort={port}
                on:A={() => attach('A')}
                on:B={() => attach('B')}
                on:C={() => attach('C')}
                on:D={() => attach('D')}
                on:E={() => attach('E')}
                on:F={() => attach('F')}
            />
            <div class="flex flex-col gap-2">
                <span class="mb-2"
                    >Select a wheel, click the port of its driving motor, and enter the ratio. The
                    ratio is wheel revolutions per motor revolution; a negative value reverses the
                    wheel. Defaults: A = 1 and B = -1.</span
                >
                {#each wheels as wheel}
                    {#if selectedWheel == wheel.part.id}
                        <div
                            class="relative rounded-xl p-4 border border-gray-400 bg-green-100 flex flex-col items-start w-full min-h-32"
                            role="button"
                            tabindex="0"
                            on:click={() => select(wheel.part.id, wheel.part.part)}
                            on:keydown={(event) => handleCardKey(event, wheel.part.id, wheel.part.part)}
                        >
                            <span>{partNames[wheel.part.part]}</span>
                            <span class="ml-6 text-sm text-black"
                                >Port: {wheel.wheel?.port ?? ''}</span
                            >
                            <span class="ml-6 text-sm text-black">{motorLabel(wheel.wheel)}</span>
                            <div class="pl-6 flex flex-row items-center gap-2 w-full">
                                <span class="text-sm text-black">Gear ratio:</span>
                                <button
                                    type="button"
                                    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-500 text-xs font-bold leading-none"
                                    aria-label="Explain wheel gear ratio"
                                    aria-expanded={gearInfoOpen}
                                    title="What does gear ratio mean?"
                                    on:click|stopPropagation={() => (gearInfoOpen = !gearInfoOpen)}>i</button
                                >
                                <Input
                                    class="flex-1 my-0 py-2"
                                    bind:value={gearing}
                                    on:change={() => updateGearing()}
                                />
                            </div>
                            {#if gearInfoOpen}
                                <div class="mt-1 rounded border bg-blue-50 p-2 text-left text-xs text-gray-700">
                                    A ratio of 1 means one wheel revolution per motor revolution.
                                    -1 reverses the wheel direction; 2 doubles wheel speed/travel;
                                    0.5 halves it. The default A=1/B=-1 values compensate for the
                                    mirrored wheel axles. Torque is not simulated.
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <div
                            class="rounded-xl p-4 border border-gray-400 flex flex-col items-start min-h-32"
                            role="button"
                            tabindex="0"
                            on:click={() => select(wheel.part.id, wheel.part.part)}
                            on:keydown={(event) => handleCardKey(event, wheel.part.id, wheel.part.part)}
                        >
                            <span>{partNames[wheel.part.part]}</span>
                            <span class="ml-6 text-sm text-black"
                                >Port: {wheel.wheel?.port ?? ''}</span
                            >
                            <span class="ml-6 text-sm text-black">{motorLabel(wheel.wheel)}</span>
                            <div class="ml-6 mt-0.5 flex items-center gap-2 py-2 text-sm text-black">
                                <span>Gear ratio: {wheel.wheel?.gearing ?? ''}</span>
                                <button
                                    type="button"
                                    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-500 text-xs font-bold leading-none"
                                    aria-label="Explain wheel gear ratio"
                                    aria-expanded={gearInfoOpen}
                                    title="What does gear ratio mean?"
                                    on:click|stopPropagation={() => (gearInfoOpen = !gearInfoOpen)}>i</button
                                >
                            </div>
                            {#if gearInfoOpen}
                                <span class="ml-6 mt-1 rounded border bg-blue-50 p-1 text-left text-xs text-gray-700">Wheel revolutions per motor revolution. Negative reverses direction. Default A=1/B=-1.</span>
                            {/if}
                        </div>
                    {/if}
                {/each}
            </div>
        </div>
        <div class="flex-1 w-full h-full overflow-hidden">
            <RobotPreview
                id="robot_preview_port"
                class="w-full h-full"
                robotModel={$componentStore.robotModel}
                enabled={modalOpen}
                select={selected}
            />
        </div>
    </div>
</Modal>
