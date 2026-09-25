<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { WebGL, type CompiledModel } from '$lib/ldraw/gl';
    import { type Model, type Line, type Vertex, hexColor } from '$lib/ldraw/components';

    export let id: string;
    export let robotModel: Model | undefined;
    export let compiledRobot: CompiledModel | undefined = undefined;
    export let enabled = true;
    export let select: number[] | undefined = undefined;

    let canRender = false;
    let gl: WebGL | undefined;
    let canvas: HTMLCanvasElement;
    // Start with a shallow top/tilt so wheel and port selections are visible
    // in depth while keeping the robot's canonical back-facing orientation.
    let orbitYaw = 0;
    let orbitPitch = 28;
    let zoom = 1;
    let dragging = false;
    let lastPointer = { x: 0, y: 0 };

    function pointerDown(event: PointerEvent) {
        if (event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        dragging = true;
        lastPointer = { x: event.clientX, y: event.clientY };
    }

    function pointerMove(event: PointerEvent) {
        if (!dragging) return;
        orbitYaw += (event.clientX - lastPointer.x) * 0.5;
        orbitPitch = Math.max(-80, Math.min(80, orbitPitch + (event.clientY - lastPointer.y) * 0.5));
        lastPointer = { x: event.clientX, y: event.clientY };
    }

    function pointerUp(event: PointerEvent) {
        dragging = false;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }

    function wheelZoom(event: WheelEvent) {
        zoom = Math.max(0.35, Math.min(4, zoom * Math.exp(-event.deltaY * 0.001)));
    }
    const highlightColour = hexColor('#facc15');
    const highlight = {
        code: 'highlight', inheritSurface: false, inheritEdge: false,
        surface: highlightColour, edge: highlightColour
    };

    function selectionOutline(): Line[] {
        if (!compiledRobot || !select?.some((id) => id >= 0)) return [];
        const { min, max } = compiledRobot.bbox;
        const pad = 2;
        const low = { x: min.x - pad, y: min.y - pad, z: min.z - pad };
        const high = { x: max.x + pad, y: max.y + pad, z: max.z + pad };
        const corners: Vertex[] = [
            { x: low.x, y: low.y, z: low.z }, { x: high.x, y: low.y, z: low.z },
            { x: low.x, y: high.y, z: low.z }, { x: high.x, y: high.y, z: low.z },
            { x: low.x, y: low.y, z: high.z }, { x: high.x, y: low.y, z: high.z },
            { x: low.x, y: high.y, z: high.z }, { x: high.x, y: high.y, z: high.z }
        ];
        const edges = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
        return edges.map(([a,b]) => ({ colour: highlight, p1: corners[a], p2: corners[b] }));
    }

    function doCompile(robot: Model | undefined, select: number[] | undefined) {
        if (!robot) {
            return undefined;
        }
        if (gl) {
            return gl.compileModel(robot, { select: select });
        }
    }

    function doRender() {
        renderRobot();
        if (canRender && enabled) {
            requestAnimationFrame(doRender);
        }
    }

    function queueRender() {
        if (!canRender) {
            return;
        }
        requestAnimationFrame(doRender);
    }

    function renderRobot() {
        if (!gl) {
            return;
        }
        if (!compiledRobot) {
            gl.clearColour(1.0, 1.0, 1.0);
            gl.clear();
            return;
        }
        gl.resizeToFit();
        gl.setModelIdentity();
        gl.clearColour(0.0, 0.0, 0.0);
        gl.clear();
        gl.translate(0, 0, -20 / zoom);
        gl.rotate(orbitPitch, 1, 0, 0);
        gl.rotate(orbitYaw, 0, 1, 0);
        if (compiledRobot) {
            gl.scale(0.05);
            gl.drawCompiled(compiledRobot);
            gl.drawLines(selectionOutline());
        }
        gl.flush();
    }

    function checkEnabled(enabled: boolean) {
        if (enabled) {
            queueRender();
        }
    }

    onMount(() => {
        if (canvas) {
            gl = WebGL.create(canvas);
            if (gl) {
                gl.mindist = 0.01;
                gl.maxdist = 50.0;
                compiledRobot = doCompile(robotModel, select);
            }
            canRender = true;
            queueRender();
        } else {
            console.log('No WebGL available');
        }
    });

    onDestroy(() => {
        canRender = false;
    });

    $: compiledRobot = doCompile(robotModel, select);
    $: checkEnabled(enabled);
</script>

<div class="relative {$$props.class}">
    <canvas
        bind:this={canvas}
        {id}
        class="h-full w-full touch-none {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
        aria-label="Selected robot part preview. Drag to rotate, scroll to zoom."
        on:pointerdown={pointerDown}
        on:pointermove={pointerMove}
        on:pointerup={pointerUp}
        on:pointercancel={pointerUp}
        on:wheel|preventDefault={wheelZoom}
    ></canvas>
    <div class="pointer-events-none absolute bottom-2 left-2 rounded bg-white/80 px-2 py-1 text-xs text-gray-700">Drag to rotate · scroll to zoom</div>
</div>
