<script lang="ts">
    import { boundaryStore } from '$lib/spike/scene';
    import { createEventDispatcher, onDestroy, onMount } from 'svelte';
    import { WebGL, type MapTexture } from '$lib/ldraw/gl';
    import { brickColour, findParts, findPartTransform, type Model, type Subpart, type Quad } from '$lib/ldraw/components';
    import { type SceneStore, type SceneObject } from '$lib/spike/scene';
    import { type Hub, type PortType } from '$lib/spike/vm';
    import { movingPartVisualAngle } from '$lib/spike/animation';
    import { type CompiledModel } from '$lib/ldraw/gl';
    import * as m4 from '$lib/ldraw/m4';

    export let id: string;
    export let scene: SceneStore;
    export let enabled = true;
    export let ready = false;
    export let loadError = '';
    export let select: string | undefined = undefined;
    export let camera: 'top' | 'left' | 'right' | 'front' | 'back' | 'adaptive';
    export let robotFocus = false;
    export let tilt = true;
    export let rotate = false;
    export let unresolved: string[] = [];
    export let dimMap = false;
    export let interactive = false;
    /** When enabled, dragging on the top-down map emits robot placement coordinates. */
    export let placementMode = false;
    export let hub: Hub | undefined = undefined;
    export let orbitYaw = 0;
    export let orbitPitch = 0;
    export let zoom = 1;
    /** World-space scene offset controlled by middle/right-button dragging. */
    export let panX = 0;
    export let panZ = 0;

    let canRender = false;
    let gl: WebGL | undefined;
    let canvas: HTMLCanvasElement;
    let angle = 0;
    let mapTexture: MapTexture | null = null;
    let loadedMap: Blob | undefined | null = null;
    let mapLoading = false;
    let mapGeneration = 0;
    let brown = brickColour('86');
    let red = brickColour('4');
    let animatedRobot: Model | undefined;
    let robotBody: CompiledModel | undefined;
    let movingVisuals: {
        id: number;
        port: PortType;
        ratio: number;
        axis: 'x' | 'y' | 'z';
        kind: 'wheel' | 'attachment';
        model: CompiledModel;
        transform: m4.Matrix4;
    }[] = [];
    let driveAxles: {
        port: PortType;
        ratio: number;
        wheel: { x: number; y: number; z: number };
        motor: { x: number; y: number; z: number };
    }[] = [];
    let animationSignature = '';
    let dragging = false;
    let lastPinchDistance = 0;
    const activePointers = new Map<number, { x: number; y: number }>();
    const pointerModes = new Map<number, 'orbit' | 'pan'>();
    const dispatch = createEventDispatcher<{ placeRobot: { x: number; z: number }; resetView: void }>();
    let placementPointer: number | undefined;
    const ldrawToScene = m4.multiply(m4.xRotation(Math.PI), m4.scaling(0.4, 0.4, 0.4));

    function scenePoint(transform: m4.Matrix4) {
        const point = m4.transformPoint(ldrawToScene, [transform[12], transform[13], transform[14]]);
        return { x: Number(point[0]), y: Number(point[1]), z: Number(point[2]) };
    }

    function clamp(value: number, minimum: number, maximum: number) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function setZoom(nextZoom: number) {
        zoom = clamp(nextZoom, 0.35, 5);
    }

    function zoomIn() {
        setZoom(zoom * 1.25);
    }

    function zoomOut() {
        setZoom(zoom / 1.25);
    }

    function resetView() {
        orbitYaw = 0;
        orbitPitch = 0;
        zoom = 1;
        panX = 0;
        panZ = 0;
        dispatch('resetView');
    }

    function pointerDistance() {
        const pointers = Array.from(activePointers.values());
        if (pointers.length < 2) {
            return 0;
        }
        return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
    }

    function placementPoint(event: PointerEvent) {
        const bounds = canvas.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5) * scene.mapWidth;
        const z = ((event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5) * scene.mapHeight;
        return { x, z };
    }

    function handlePointerDown(event: PointerEvent) {
        if (!interactive || ![0, 1, 2].includes(event.button)) {
            return;
        }
        canvas.focus();
        if (placementMode) {
            if (event.button !== 0) return;
            placementPointer = event.pointerId;
            canvas.setPointerCapture(event.pointerId);
            dispatch('placeRobot', placementPoint(event));
            event.preventDefault();
            return;
        }
        // Middle-button and right-button drags orbit the same way as the
        // normal left-button drag. Prevent the browser context menu and allow
        // the pointer to continue outside the canvas while dragging.
        if (event.button === 1 || event.button === 2) event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        pointerModes.set(event.pointerId, event.button === 0 ? 'orbit' : 'pan');
        dragging = true;
        if (activePointers.size === 2) {
            lastPinchDistance = pointerDistance();
        }
    }

    function handlePointerMove(event: PointerEvent) {
        if (placementMode && placementPointer === event.pointerId) {
            dispatch('placeRobot', placementPoint(event));
            event.preventDefault();
            return;
        }
        const previous = activePointers.get(event.pointerId);
        if (!interactive || !previous) {
            return;
        }
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (activePointers.size === 1) {
            const dx = event.clientX - previous.x;
            const dy = event.clientY - previous.y;
            if (pointerModes.get(event.pointerId) === 'pan') {
                panX += dx * 1.5;
                panZ += dy * 1.5;
            } else {
                orbitYaw += dx * 0.35;
                orbitPitch = clamp(orbitPitch + dy * 0.35, -80, 80);
            }
        } else if (activePointers.size === 2) {
            const distance = pointerDistance();
            if (lastPinchDistance > 0) {
                setZoom(zoom * (distance / lastPinchDistance));
            }
            lastPinchDistance = distance;
        }
    }

    function handlePointerEnd(event: PointerEvent) {
        if (placementPointer === event.pointerId) {
            placementPointer = undefined;
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
            return;
        }
        activePointers.delete(event.pointerId);
        pointerModes.delete(event.pointerId);
        if (canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
        }
        dragging = activePointers.size > 0;
        lastPinchDistance = activePointers.size === 2 ? pointerDistance() : 0;
    }

    function handleWheel(event: WheelEvent) {
        if (!interactive) {
            return;
        }
        setZoom(zoom * Math.exp(-event.deltaY * 0.001));
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (!interactive) {
            return;
        }
        if (event.key === 'ArrowLeft') {
            orbitYaw -= 5;
        } else if (event.key === 'ArrowRight') {
            orbitYaw += 5;
        } else if (event.key === 'ArrowUp') {
            orbitPitch = clamp(orbitPitch - 5, -80, 80);
        } else if (event.key === 'ArrowDown') {
            orbitPitch = clamp(orbitPitch + 5, -80, 80);
        } else if (event.key === '+' || event.key === '=') {
            zoomIn();
        } else if (event.key === '-' || event.key === '_') {
            zoomOut();
        } else if (event.key === '0') {
            resetView();
        } else {
            return;
        }
        event.preventDefault();
    }

    function doRender() {
        renderScene();
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

    function renderScene() {
        if (!gl) {
            return;
        }

        let leftBarrierHit = false;
        let rightBarrierHit = false;
        let bottomBarrierHit = false;
        let topBarrierHit = false;
        gl.resizeToFit();
        gl.setModelIdentity();
        gl.clearColour(0.0, 0.0, 0.0);
        gl.clear();
        if (robotFocus) {
            // Keep the robot-focused gear view useful for orientation without
            // filling the whole panel with the chassis.
            gl.translate(0, 0, -4 / zoom);
        } else {
            gl.translate(0, 0, -30 / zoom);
        }
        // Make unit meters
        gl.scale(0.01);

        if (tilt) {
            if (robotFocus) {
                gl.rotate(30, 1.0, 0.0, 0.0);
            } else {
                gl.rotate(45, 1.0, 0.0, 0.0);
            }
        }
        if (camera == 'adaptive') {
            if (gl.getCanvasAspect() >= 1.0) {
                gl.rotate(0, 0.0, 1.0, 0.0);
            } else {
                gl.rotate(90, 0.0, 1.0, 0.0);
            }
        } else if (camera == 'top') {
            gl.rotate(90, 1.0, 0.0, 0.0);
        } else if (camera == 'left') {
            gl.rotate(90, 0.0, 1.0, 0.0);
        } else if (camera == 'right') {
            gl.rotate(-90, 0.0, 1.0, 0.0);
        } else if (camera == 'front') {
            gl.rotate(0, 0.0, 1.0, 0.0);
        } else if (camera == 'back') {
            gl.rotate(180, 0.0, 1.0, 0.0);
        }
        if (interactive) {
            gl.rotate(orbitPitch, 1.0, 0.0, 0.0);
            gl.rotate(orbitYaw, 0.0, 1.0, 0.0);
        }
        if (panX !== 0 || panZ !== 0) {
            gl.translate(panX, 0, panZ);
        }
        if (rotate) {
            gl.rotate(angle, 0.0, 1.0, 0.0);
        }
        if (scene.robot && scene.robot.compiled && mapTexture) {
            const w = mapTexture.width / 2;
            const h = mapTexture.height / 2;
            const obj = scene.robot;
            const bbox = scene.robot.compiled.bbox;
            let sphereIntersect = false;
            const cx = 0.5 * (bbox.min.x + bbox.max.x);
            const cy = 0.5 * (bbox.min.y + bbox.max.y);
            const cz = 0.5 * (bbox.min.z + bbox.max.z);
            let matrix = m4.identity();
            if (obj.position) {
                matrix = m4.translate(matrix, obj.position.x, obj.position.y, obj.position.z);
            }
            if (obj.rotation) {
                //matrix = m4.axisRotate(matrix, [0.0, 1.0, 0.0], obj.rotation);
            }

            // Check bounding sphere first
            const c = m4.transformVector(matrix, [cx, cy, cz, 1.0]);
            if ((c[0] + w) * (c[0] + w) < bbox.radius) {
                sphereIntersect = true;
                // check bbox, left
            } else if ((c[0] - w) * (c[0] - w) < bbox.radius) {
                sphereIntersect = true;
                // check bbox, right
            } else if ((c[2] + h) * (c[2] + h) < bbox.radius) {
                sphereIntersect = true;
                // check bbox, bottom
            } else if ((c[2] - h) * (c[2] - h) < bbox.radius) {
                sphereIntersect = true;
                // check bbox, top
            }

            if (sphereIntersect) {
                // Do a quick check on min and max
                const p1 = [bbox.min.x, bbox.min.y, bbox.min.z, 1.0];
                const p2 = [bbox.max.x, bbox.min.y, bbox.min.z, 1.0];
                const p3 = [bbox.min.x, bbox.min.y, bbox.max.z, 1.0];
                const p4 = [bbox.max.x, bbox.min.y, bbox.max.z, 1.0];
                for (const p of [p1, p2, p3, p4]) {
                    const pt = m4.transformVector(matrix, p);
                    if (pt[0] < -w) {
                        leftBarrierHit = true;
                    }
                    if (pt[0] > w) {
                        rightBarrierHit = true;
                    }
                    if (pt[2] < -h) {
                        bottomBarrierHit = true;
                    }
                    if (pt[2] > h) {
                        topBarrierHit = true;
                    }
                }
            }
        }
        if (robotFocus) {
            if (scene.robot) {
                const obj = scene.robot;
                if (obj.rotation) {
                    gl.rotate(-obj.rotation, 0.0, 1.0, 0.0);
                }
                if (obj.position) {
                    gl.translate(-obj.position.x, -obj.position.y, -obj.position.z);
                }
            }
        }
        if (mapTexture) {
            const w = mapTexture.width / 2;
            const h = mapTexture.height / 2;
            if (dimMap) {
                gl.setBrightness(0.5);
            } else {
                if (select === '#map' || select === '#all') {
                    gl.setBrightness(1.0);
                } else {
                    gl.setBrightness(0.3);
                }
            }
            gl.pushMatrix();
            gl.drawTexturedQuad(mapTexture);
            gl.popMatrix();
            if (bottomBarrierHit || topBarrierHit || leftBarrierHit || rightBarrierHit) {
                gl.setBrightness(1.0);
            }
            if ($boundaryStore.draw || $boundaryStore.collisions) {
                const quads: Quad[] = [];
                const size = 50.0 * $boundaryStore.scale;
                if (bottomBarrierHit || $boundaryStore.draw) {
                    quads.push({
                        colour: bottomBarrierHit ? red : brown,
                        p1: { x: -w, y: 0.0, z: -h },
                        p2: { x: -w, y: size, z: -h },
                        p3: { x: w, y: size, z: -h },
                        p4: { x: w, y: 0.0, z: -h }
                    });
                }
                if (topBarrierHit || $boundaryStore.draw) {
                    quads.push({
                        colour: topBarrierHit ? red : brown,
                        p1: { x: -w, y: 0.0, z: h },
                        p2: { x: -w, y: size, z: h },
                        p3: { x: w, y: size, z: h },
                        p4: { x: w, y: 0.0, z: h }
                    });
                }
                if (rightBarrierHit || $boundaryStore.draw) {
                    quads.push({
                        colour: rightBarrierHit ? red : brown,
                        p1: { x: w, y: 0.0, z: -h },
                        p2: { x: w, y: size, z: -h },
                        p3: { x: w, y: size, z: h },
                        p4: { x: w, y: 0.0, z: h }
                    });
                }
                if (leftBarrierHit || $boundaryStore.draw) {
                    quads.push({
                        colour: leftBarrierHit ? red : brown,
                        p1: { x: -w, y: 0.0, z: -h },
                        p2: { x: -w, y: size, z: -h },
                        p3: { x: -w, y: size, z: h },
                        p4: { x: -w, y: 0.0, z: h }
                    });
                }
                gl.drawQuads(quads);
            }
            gl.setBrightness(1.0);
        }
        gl.translate(0, 0, 0);
        for (const obj of scene.objects) {
            if (select === obj.name || select === '#all') {
                gl.setBrightness(1.0);
            } else {
                gl.setBrightness(0.3);
            }
            gl.pushMatrix();
            if (obj.position) {
                gl.translate(obj.position.x, obj.position.y, obj.position.z);
            }
            if (obj.rotation) {
                gl.rotate(obj.rotation, 0.0, 1.0, 0.0);
            }
            if (obj.compiled) {
                gl.drawCompiled(obj.compiled);
            } else {
                const size = obj.displaySize ?? { width: 100, height: 100, depth: 100 };
                gl.drawBox(size.width, size.height, size.depth);
            }
            gl.popMatrix();
            gl.setBrightness(1.0);
        }

        if (scene.robot) {
            const obj = scene.robot;
            if (select === '#robot' || select === '#all') {
                gl.setBrightness(1.0);
            } else {
                gl.setBrightness(0.3);
            }
            gl.pushMatrix();
            if (obj.position) {
                gl.translate(obj.position.x, obj.position.y, obj.position.z);
            }
            if (obj.rotation) {
                gl.rotate(obj.rotation, 0.0, 1.0, 0.0);
            }
            if (robotBody && movingVisuals.length > 0 && hub) {
                // The original compiled robot is centered as a whole. Keep the chassis
                // and individually animated wheels in that same coordinate frame.
                const center = obj.compiled?.recenter;
                if (center) {
                    gl.translate(center.x, center.y, center.z);
                }
                gl.drawCompiled(robotBody);
                // The bundled Simple Bot model has motor and wheel hubs but
                // no visible axle mesh between them. Draw the drive axles in
                // the same chassis frame so the connection is clear while
                // the motor is running.
                for (const axle of driveAxles) {
                    const motor = hub.ports[axle.port].motor;
                    const dx = axle.motor.x - axle.wheel.x;
                    const dy = axle.motor.y - axle.wheel.y;
                    const dz = axle.motor.z - axle.wheel.z;
                    const length = Math.hypot(dx, dy, dz);
                    if (length < 0.1) continue;
                    const thickness = 2.4;
                    gl.pushMatrix();
                    gl.translate(
                        (axle.wheel.x + axle.motor.x) / 2,
                        (axle.wheel.y + axle.motor.y) / 2 - thickness / 2,
                        (axle.wheel.z + axle.motor.z) / 2
                    );
                    // The Simple Bot axle runs across the chassis on X. Keep
                    // this rotation separate from the wheel marker's visual
                    // axis so a rectangular shaft visibly turns in place.
                    gl.rotate(movingPartVisualAngle(motor?.position ?? 0, axle.ratio), 1, 0, 0);
                    gl.setBrightness(0.9);
                    gl.drawBox(length, thickness, thickness * 1.35);
                    gl.setBrightness(1.0);
                    gl.popMatrix();
                }
                for (const visual of movingVisuals) {
                    gl.pushMatrix();
                    gl.multMatrix(visual.transform);
                    const motor = hub.ports[visual.port].motor;
                    const axis = visual.axis;
                    // The LDraw-to-scene axis flip reverses the attachment's
                    // visible direction from the top/front.
                    gl.rotate(
                        movingPartVisualAngle(motor?.position ?? 0, visual.ratio),
                        axis === 'x' ? 1 : 0,
                        axis === 'y' ? 1 : 0,
                        axis === 'z' ? 1 : 0
                    );
                    gl.drawCompiled(visual.model);
                    gl.popMatrix();
                }
            } else if (obj.compiled) {
                gl.drawCompiled(obj.compiled);
            } else {
                gl.drawBox(100, 100, 100);
            }
            gl.popMatrix();
            gl.setBrightness(1.0);
        }

        gl.flush();
        if (!ready && !mapLoading && unresolved.length === 0 && scene.robot.compiled) {
            ready = true;
        }
        if (rotate) {
            angle = angle + 5 * 0.1;
            if (angle > 360) {
                angle = angle - 360;
            }
        } else {
            angle = 0;
        }
    }

    function checkEnabled(enabled: boolean) {
        if (enabled) {
            queueRender();
        }
    }

    async function loadMapTexture(map: Blob | undefined) {
        if (!gl) {
            mapTexture = null;
            return;
        }
        if (loadedMap === map) return;
        loadedMap = map;
        const generation = ++mapGeneration;
        mapLoading = !!map;
        ready = false;
        if (mapTexture) {
            gl.deleteTexture(mapTexture.texture);
        }
        if (!map) {
            mapTexture = null;
            mapLoading = false;
            return;
        }
        let loaded: MapTexture | null;
        try {
            loaded = await gl.loadTexture(map);
        } catch (error) {
            if (generation === mapGeneration) mapLoading = false;
            console.warn('Could not load the scene map', error);
            return;
        }
        if (generation !== mapGeneration) {
            if (loaded) gl.deleteTexture(loaded.texture);
            return;
        }
        mapTexture = loaded;
        // We could get the size from the texture.
        // But better not, since it isn't real units.
        // mapWidth = mapTexture.width;
        // mapHeight = mapTexture.height;
        if (mapTexture) {
            mapTexture.width = scene.mapWidth;
            mapTexture.height = scene.mapHeight;
        }
        mapLoading = false;
    }

    function loadRobot(robot: SceneObject, forceCompile: boolean, unresolved: string[]) {
        if (!gl) {
            return;
        }
        if (unresolved.length > 0) {
            return;
        }
        const obj = robot;
        if (obj.bricks) {
            if (animatedRobot !== obj.bricks) ready = false;
            const movingParts = [
                ...(hub?.wheels.map((wheel) => ({
                    id: wheel.id,
                    port: wheel.port,
                    ratio: wheel.gearing,
                    axis: 'z' as const,
                    kind: 'wheel' as const
                })) ?? []),
                ...(hub?.attachments.map((part) => ({ ...part, kind: 'attachment' as const })) ?? [])
            ];
            const signature = `${movingParts.map((part) => `${part.id}:${part.port}:${part.axis}:${part.ratio}`).join('|')}|resolved:${unresolved.length}`;
            if (animatedRobot !== obj.bricks || animationSignature !== signature) {
                robotBody = undefined;
                movingVisuals = [];
            }
            if (!obj.compiled || forceCompile) {
                obj.compiled = gl.compileModel(obj.bricks, { rescale: false });
            }
            if (movingParts.length > 0 && (animatedRobot !== obj.bricks || animationSignature !== signature)) {
                const movingIds = new Set(movingParts.map((part) => part.id));
                const childIds = new Map<number, number[]>();
                const markerParts = findParts(obj.bricks, ['48267']);
                const usedMarkers = new Set<number>();
                // 48267 is the white direction marker mounted on each Simple
                // Bot wheel. It is a separate top-level part in the MPD, so
                // explicitly make it a child of the closest wheel.
                for (const movingPart of movingParts) {
                    if (movingPart.kind !== 'wheel') continue;
                    const wheelLocation = findPartTransform(obj.bricks, movingPart.id)?.forward;
                    if (!wheelLocation) continue;
                    const marker = markerParts
                        .filter((candidate) => !usedMarkers.has(candidate.id))
                        .map((candidate) => {
                            const location = findPartTransform(obj.bricks, candidate.id)?.forward;
                            if (!location) return { candidate, distance: Number.POSITIVE_INFINITY };
                            return {
                                candidate,
                                distance: Math.hypot(
                                    wheelLocation[12] - location[12],
                                    wheelLocation[13] - location[13],
                                    wheelLocation[14] - location[14]
                                )
                            };
                        })
                        .sort((a, b) => a.distance - b.distance)[0];
                    if (marker && marker.distance <= 30) {
                        usedMarkers.add(marker.candidate.id);
                        childIds.set(movingPart.id, [marker.candidate.id]);
                        movingIds.add(marker.candidate.id);
                    }
                }
                const shafts = findParts(obj.bricks, ['4519']);
                for (const movingPart of movingParts) {
                    if (movingPart.kind !== 'attachment') continue;
                    const gear = findPartTransform(obj.bricks, movingPart.id)?.forward;
                    if (!gear) continue;
                    for (const shaft of shafts) {
                        const location = findPartTransform(obj.bricks, shaft.id)?.forward;
                        if (!location) continue;
                        // A coaxial axle shares the gear's LDraw center. Do not
                        // animate nearby structural axles or bearings.
                        if (Math.hypot(gear[12] - location[12], gear[13] - location[13], gear[14] - location[14]) > 0.2) continue;
                        movingIds.add(shaft.id);
                        childIds.set(movingPart.id, [...(childIds.get(movingPart.id) ?? []), shaft.id]);
                    }
                }
                if (/FLL Attachment Bot \(MPD\)/i.test(obj.name) || /(?:ffl|fll)[_\s-]*bot[_\s-]*with[_\s-]*attachment/i.test(obj.name)) {
                    const gears = movingParts.filter((part) => part.kind === 'attachment');
                    const drivenAttachment = gears[1] ?? gears[0];
                    if (drivenAttachment) {
                        // The supplied MPD describes the lift/attachment as
                        // separate top-level pieces. Group the non-drive
                        // attachment pieces under the meshed gear so they
                        // follow the same pivot when the tool motor runs.
                        // The blue front tool and force sensor are fixed to the
                        // robot chassis in the supplied FLL build.  They must
                        // remain static while the black lift/arm assembly
                        // rotates; grouping them here makes them incorrectly
                        // swing around the driven gear.
                        const movingAttachmentParts = findParts(obj.bricks, [
                            '32184', '32009', '44294', '60483',
                            '60485', '32192', '32524', '60484', '4211807'
                        ]);
                        for (const part of movingAttachmentParts) {
                            if (part.id === drivenAttachment.id) continue;
                            movingIds.add(part.id);
                            childIds.set(drivenAttachment.id, [
                                ...(childIds.get(drivenAttachment.id) ?? []),
                                part.id
                            ]);
                        }
                    }
                }
                const selectedParts = new Map<number, Subpart>();
                const cache = new WeakMap<Model, Model>();
                function withoutMovingParts(model: Model): Model {
                    const existing = cache.get(model);
                    if (existing) return existing;
                    const copy: Model = { ...model, subparts: [] };
                    cache.set(model, copy);
                    copy.subparts = model.subparts.flatMap((part) => {
                        if (movingIds.has(part.id)) {
                            selectedParts.set(part.id, part);
                            return [];
                        }
                        return [{ ...part, model: part.model ? withoutMovingParts(part.model) : undefined }];
                    });
                    return copy;
                }
                robotBody = gl.compileModel(withoutMovingParts(obj.bricks), {
                    rescale: false,
                    recenter: false
                });
                movingVisuals = movingParts.flatMap((movingPart) => {
                    const part = selectedParts.get(movingPart.id);
                    const location = findPartTransform(obj.bricks, movingPart.id);
                    if (!part?.model || !location) return [];
                    const members = [movingPart.id, ...(childIds.get(movingPart.id) ?? [])]
                        .flatMap((id) => {
                            const member = selectedParts.get(id);
                            const memberLocation = findPartTransform(obj.bricks, id);
                            if (!member?.model || !memberLocation) return [];
                            const relative = m4.multiply(m4.inverse(location.forward), memberLocation.forward);
                            return [{ ...member, matrix: Array.from(relative) }];
                        });
                    const partRoot: Model = {
                        name: part.modelNumber,
                        subparts: members,
                        lines: [],
                        triangles: [],
                        quads: [],
                        optionalLines: []
                    };
                    // Each moving mesh has already been converted from LDraw coordinates by
                    // compileModel. Convert its parent transform into those same coordinates,
                    // otherwise the scale/axis flip is applied twice and the wheel detaches.
                    const transform = m4.multiply(
                        m4.multiply(ldrawToScene, location.forward),
                        m4.inverse(ldrawToScene)
                    );
                    return [{ ...movingPart, model: gl!.compileModel(partRoot, { rescale: false, recenter: false }), transform }];
                });
            }
            if (animatedRobot !== obj.bricks || animationSignature !== signature) {
                driveAxles = (hub?.wheels ?? []).flatMap((wheel) => {
                    const motor = hub?.ports[wheel.port]?.motor;
                    if (!motor) return [];
                    const wheelLocation = findPartTransform(obj.bricks, wheel.id)?.forward;
                    const motorLocation = findPartTransform(obj.bricks, motor.id)?.forward;
                    if (!wheelLocation || !motorLocation) return [];
                    return [{
                        port: wheel.port,
                        ratio: wheel.gearing,
                        wheel: scenePoint(wheelLocation),
                        motor: scenePoint(motorLocation)
                    }];
                });
            }
            animatedRobot = obj.bricks;
            animationSignature = signature;
        }
        // Placement belongs to scene state, shared by the idle and running
        // previews. Recalculating it here made pressing Play change the pose.
    }

    function loadSceneItems(objects: SceneObject[], forceCompile: boolean, unresolved: string[]) {
        if (!gl) {
            return;
        }
        if (unresolved.length > 0) {
            return;
        }
        for (const obj of objects) {
            if (obj.bricks) {
                if (!obj.compiled || forceCompile) {
                    obj.compiled = gl.compileModel(obj.bricks, { rescale: false });
                }
            }
            if (!obj.position && obj.compiled) {
                obj.position = { x: 0.0, y: -obj.compiled.bbox.min.y, z: 0.0 };
            }
        }
    }

    onMount(() => {
        if (canvas) {
            gl = WebGL.create(canvas);
            if (gl) {
                loadSceneItems(scene.objects, false, unresolved);
                loadRobot(scene.robot, false, unresolved);
                loadMapTexture(scene.map);
            } else {
                loadError = '3D preview unavailable: WebGL could not start in this browser.';
            }
            canRender = true;
            queueRender();
        } else {
            loadError = '3D preview unavailable: WebGL could not start in this browser.';
        }
    });

    onDestroy(() => {
        canRender = false;
        if (mapTexture && gl) {
            gl.deleteTexture(mapTexture.texture);
            mapTexture = null;
        }
    });

    function setMapSize(scene: SceneStore) {
        if (mapTexture) {
            mapTexture.width = scene.mapWidth;
            mapTexture.height = scene.mapHeight;
        }
    }

    $: checkEnabled(enabled);
    $: loadMapTexture(scene.map);
    $: setMapSize(scene);
    $: loadSceneItems(scene.objects, false, unresolved);
    $: loadRobot(scene.robot, false, unresolved);
</script>

<div class="relative overflow-hidden {$$props.class}">
    <canvas
        bind:this={canvas}
        {id}
        class="scene-canvas block h-full w-full touch-none {placementMode
            ? 'cursor-crosshair'
            : interactive
                ? dragging
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                : ''}"
        role={interactive ? 'application' : undefined}
        aria-label={interactive ? 'Interactive 3D simulator view' : undefined}
        tabindex={interactive ? 0 : -1}
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerEnd}
        on:pointercancel={handlePointerEnd}
        on:wheel|preventDefault={handleWheel}
        on:contextmenu|preventDefault
        on:keydown={handleKeyDown}
    ></canvas>
    {#if interactive}
        <div class="absolute right-3 top-3 flex overflow-hidden rounded-lg border border-gray-500 bg-gray-900/80 text-white shadow-lg">
            <button class="px-3 py-2 hover:bg-gray-700" type="button" title="Zoom in" on:click={zoomIn}>+</button>
            <button class="border-l border-gray-600 px-3 py-2 hover:bg-gray-700" type="button" title="Zoom out" on:click={zoomOut}>−</button>
            <button class="border-l border-gray-600 px-3 py-2 hover:bg-gray-700" type="button" title="Reset 3D view" on:click={resetView}>Reset</button>
        </div>
        <div class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-gray-900/75 px-3 py-1 text-center text-xs text-white">
            Drag to rotate · wheel or pinch to zoom
        </div>
    {/if}
</div>

<style>
    .scene-canvas {
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M8.4 11.1V5.7a1.6 1.6 0 0 1 3.2 0v3.1V4.7a1.6 1.6 0 0 1 3.2 0v4.1V5.7a1.6 1.6 0 0 1 3.2 0v5.2l.8-1.1a1.55 1.55 0 0 1 2.5 1.8l-3.5 5.1a5.7 5.7 0 0 1-4.7 2.5h-.7a5.7 5.7 0 0 1-4.5-2.2L4.2 13a1.6 1.6 0 0 1 2.5-2z' fill='white' stroke='%231f2937' stroke-width='1.4'/%3E%3C/svg%3E") 8 8, grab;
    }

    .scene-canvas:active {
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M8.4 11.1V5.7a1.6 1.6 0 0 1 3.2 0v3.1V4.7a1.6 1.6 0 0 1 3.2 0v4.1V5.7a1.6 1.6 0 0 1 3.2 0v5.2l.8-1.1a1.55 1.55 0 0 1 2.5 1.8l-3.5 5.1a5.7 5.7 0 0 1-4.7 2.5h-.7a5.7 5.7 0 0 1-4.5-2.2L4.2 13a1.6 1.6 0 0 1 2.5-2z' fill='white' stroke='%231f2937' stroke-width='1.4'/%3E%3C/svg%3E") 8 8, grabbing;
    }
</style>
