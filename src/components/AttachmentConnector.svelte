<script lang="ts">
    import { Modal } from 'flowbite-svelte';
    import { componentStore, type Model, type Subpart } from '$lib/ldraw/components';
    import { allPorts, type Hub, type PortType } from '$lib/spike/vm';
    import { sceneStore } from '$lib/spike/scene';
    import { saveRobotToBrowser } from '$lib/robot-cache';
    import RobotPreview from '$components/RobotPreview.svelte';

    export let modalOpen = false;
    export let hub: Hub;

    const excluded = new Set([
        '54696', '54696p01', '54675', '68488', '37308', '37316', '37312',
        '32019', '39367p01', '49295p01', '45601c01', '53444c01', '55422c01'
    ]);
    let search = '';
    let selectedId = -1;
    let port: PortType = 'E';
    let ratio = 1;
    let axis: 'x' | 'y' | 'z' = 'z';
    let motorPorts: PortType[] = [];

    function candidates(model: Model | undefined) {
        const found: Subpart[] = [];
        const seen = new Set<number>();
        const visit = (current: Model | undefined) => {
            for (const part of current?.subparts ?? []) {
                if (!part.model || excluded.has(part.modelNumber.replace(/\.dat$/i, ''))) continue;
                if (!seen.has(part.id)) {
                    found.push(part);
                    seen.add(part.id);
                }
                // Library .dat parts contain thousands of internal shapes. Only
                // descend into user assemblies, not each brick's internal geometry.
                if (!/\.dat$/i.test(part.modelNumber)) visit(part.model);
            }
        };
        visit(model);
        return found.sort((a, b) => Number(b.modelNumber === '32270.dat') - Number(a.modelNumber === '32270.dat'));
    }

    function label(part: Subpart) {
        return `${part.modelNumber === '32270.dat' ? '12-tooth gear' : part.modelNumber} · part ${part.id}`;
    }

    function selectPart(part: Subpart) {
        selectedId = part.id;
        const connected = hub.attachments.find((attachment) => attachment.id === part.id);
        port = connected?.port ?? motorPorts[0] ?? 'E';
        ratio = connected?.ratio ?? 1;
        axis = connected?.axis ?? 'z';
    }

    function persist() {
        hub = hub;
        void saveRobotToBrowser($componentStore.robotModel, hub, $sceneStore.robot.name).catch(
            (error) => console.warn('Could not cache attachment selection', error)
        );
    }

    function attach() {
        if (selectedId < 0 || hub.ports[port].type !== 'motor' || !Number.isFinite(+ratio)) return;
        const entry = hub.attachments.find((attachment) => attachment.id === selectedId);
        if (entry) {
            entry.port = port;
            entry.ratio = +ratio;
            entry.axis = axis;
        } else {
            hub.attachments.push({ id: selectedId, port, ratio: +ratio, axis });
        }
        persist();
    }

    function remove() {
        hub.attachments = hub.attachments.filter((attachment) => attachment.id !== selectedId);
        persist();
    }

    $: parts = candidates($componentStore.robotModel);
    $: if (selectedId >= 0 && !parts.some((part) => part.id === selectedId)) selectedId = -1;
    $: visibleParts = parts.filter((part) =>
        `${part.modelNumber} ${label(part)}`.toLowerCase().includes(search.toLowerCase())
    );
    $: if (modalOpen) motorPorts = allPorts.filter((candidate) => hub.ports[candidate].type === 'motor');
</script>

<Modal title="Motor-driven gears and attachments" size="xl" outsideclose={true} bind:open={modalOpen}>
    <div class="flex h-[70dvh] gap-4 overflow-hidden text-sm">
        <div class="flex w-1/2 flex-col gap-2">
            <p>Select a gear or moving part, then link it to a motor. The ratio controls its speed and direction.</p>
            <input class="rounded border p-2" placeholder="Find a part number" bind:value={search} />
            <div class="min-h-0 flex-1 overflow-y-auto rounded border">
                {#each visibleParts as part (part.id)}
                    <button
                        class="block w-full border-b p-2 text-left hover:bg-blue-50 {selectedId === part.id ? 'bg-blue-100' : ''}"
                        on:click={() => selectPart(part)}
                    >
                        {label(part)}
                        {#if hub.attachments.some((attachment) => attachment.id === part.id)}
                            <span class="text-green-700"> · connected</span>
                        {/if}
                    </button>
                {/each}
            </div>
            {#if selectedId >= 0}
                <div class="flex flex-wrap items-center gap-2">
                    <label>Motor
                        <select class="rounded border p-1" bind:value={port}>
                            {#each motorPorts as candidate}
                                <option value={candidate}>{candidate}</option>
                            {/each}
                        </select>
                    </label>
                    <label>Ratio <input class="w-20 rounded border p-1" type="number" step="0.1" bind:value={ratio} /></label>
                    <label>Axis
                        <select class="rounded border p-1" bind:value={axis}>
                            <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
                        </select>
                    </label>
                    <button class="rounded bg-blue-600 px-3 py-1 text-white" on:click={attach}>Connect</button>
                    <button class="rounded border px-3 py-1" on:click={remove}>Remove</button>
                </div>
            {/if}
        </div>
        {#if selectedId >= 0}
            <RobotPreview
                id="attachment_preview"
                class="w-1/2"
                robotModel={$componentStore.robotModel}
                select={[selectedId]}
                enabled={modalOpen}
            />
        {:else}
            <div class="flex w-1/2 items-center justify-center rounded border text-gray-500">
                Select a part to preview it.
            </div>
        {/if}
    </div>
</Modal>
