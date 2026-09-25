import { findParts, findPartTransform, type Model } from '$lib/ldraw/components';
import { Hub, Port, Motor, LightSensor, Wheel } from '$lib/spike/vm';
import * as m4 from '$lib/ldraw/m4';
import { assignDevicePort } from '$lib/spike/connections';

export const DIFFERENTIAL_DRIVE_NAME = '1. Simple Bot';
export const ATTACHMENT_DRIVE_NAME = '2. FLL Attachment Bot';
export const FLL_MPD_DRIVE_NAME = '3. FLL Attachment Bot (MPD)';

/** The supplied FLL MPD is a port-metadata variant of the Simple Bot chassis. */
export function isFllMpdDriveName(name: string): boolean {
    return name === FLL_MPD_DRIVE_NAME || /(?:ffl|fll)[_\s-]*bot[_\s-]*with[_\s-]*attachment/i.test(name) || /(?:ffl|fll).*attachment.*mpd/i.test(name);
}

/** Recognize saved presets from before the descriptive rename too. */
export function isAttachmentDriveName(name: string): boolean {
    return name === ATTACHMENT_DRIVE_NAME || /bot\s*2|robot\s*2|driveandattachmentbot|drive\s*\+\s*attachments\s*bot|fll\s*attachment/i.test(name);
}

/** Return the current display name while accepting names from older saves. */
export function canonicalPresetName(name: string): string {
    if (isFllMpdDriveName(name)) return FLL_MPD_DRIVE_NAME;
    if (isAttachmentDriveName(name)) return ATTACHMENT_DRIVE_NAME;
    if (name === DIFFERENTIAL_DRIVE_NAME || /^(SimpleBot|Bot 1|DifferentialDriveBot|Differential Drive Trainer)$/i.test(name)) {
        return DIFFERENTIAL_DRIVE_NAME;
    }
    return name;
}

/** Forward is defined by the chassis, independently of camera and wheel mesh axes. */
export function configurePresetDrive(hub: Hub, robot: Model, name: string, remap = true) {
    const suppliedMpd = isFllMpdDriveName(name);
    const attachment = isAttachmentDriveName(name);
    const trainer = canonicalPresetName(name) === DIFFERENTIAL_DRIVE_NAME;
    if (!attachment && !trainer && !suppliedMpd) return;
    const motorCode = suppliedMpd ? '54696' : attachment ? '54675' : '54696';
    const tireCode = attachment && !suppliedMpd ? '32019' : '39367p01';
    const motors = findParts(robot, [motorCode]);
    const tires = findParts(robot, [tireCode]);
    // Every bundled robot faces its gear/attachment end. LDraw Z is flipped
    // into scene Z by the renderer, so derive the forward sign from the actual
    // gear and wheel centers rather than from a preset-specific assumption.
    const gears = findParts(robot, ['32270']);
    const coordinate = (id: number, axis: 12 | 14) => findPartTransform(robot, id)?.forward[axis] ?? 0;
    const average = (parts: { id: number }[], axis: 12 | 14) =>
        parts.length === 0 ? undefined : parts.reduce((sum, part) => sum + coordinate(part.id, axis), 0) / parts.length;
    const gearZ = average(gears, 14);
    const wheelZ = average(tires, 14);
    const frontLDraw = gearZ !== undefined && wheelZ !== undefined && Math.abs(gearZ - wheelZ) > 0.01
        ? Math.sign(gearZ - wheelZ)
        : -1;
    hub.driveForward = { x: 0, z: -frontLDraw };
    if (!remap) return;
    if (motors.length !== 2 || tires.length !== 2) return;
    const x = (id: number) => findPartTransform(robot, id)?.forward[12] ?? 0;
    // The simulator opens from the gear-facing back view. The camera mirrors
    // model X there, so the higher model-X side is the visible left side.
    const leftToRight = (a: { id: number }, b: { id: number }) => x(b.id) - x(a.id);
    motors.sort(leftToRight);
    tires.sort(leftToRight);
    for (const [index, port] of (['A', 'B'] as const).entries()) {
        const device = Object.values(hub.ports).find((entry) => entry.motor?.id === motors[index].id);
        if (device) assignDevicePort(hub, port, device);
        const wheel = hub.wheels.find((entry) => entry.id === tires[index].id);
        if (wheel) {
            wheel.port = port;
            // The wheel panel exposes the physical mounting ratio: A is a
            // direct 1:1 wheel, while mirrored B uses -1 to reverse its axle.
            wheel.gearing = index === 0 ? 1 : -1;
        }
    }
    const sensor = Object.values(hub.ports).find((entry) => entry.type === 'light');
    if (sensor) assignDevicePort(hub, 'C', sensor);
}

/** Studio models have geometry but no electrical-port metadata. */
export function connectStudioDrive(hub: Hub, robot: Model) {
    const tires = findParts(robot, ['32019']);
    const motors = findParts(robot, ['54675']);
    if (tires.length !== 2 || motors.length !== 2 || hub.wheels.length !== 0) return;
    const modelX = (id: number) => findPartTransform(robot, id)?.forward[12] ?? 0;
    tires.sort((a, b) => modelX(b.id) - modelX(a.id));
    motors.sort((a, b) => modelX(b.id) - modelX(a.id));

    // From the gear-facing back view the camera mirrors model X, so map the
    // higher model-X motor/tire to visible-left A and the lower one to B.
    // The Studio file itself cannot confirm electrical wiring, so this mapping
    // is explicit and is also used by the bundled FLL preset.
    hub.ports.A = new Port('motor');
    hub.ports.A.motor = new Motor(motors[0].id);
    hub.ports.B = new Port('motor');
    hub.ports.B.motor = new Motor(motors[1].id);
    hub.wheels.push(new Wheel(tires[0].id, 31.2, 1, 'A', m4.identity()));
    hub.wheels.push(new Wheel(tires[1].id, 31.2, -1, 'B', m4.identity()));
    hub.driveForward = { x: 0, z: -1 };

    const toolMotors = findParts(robot, ['54696']).sort((a, b) => modelX(b.id) - modelX(a.id));
    if (toolMotors.length === 2) {
        hub.ports.E = new Port('motor');
        hub.ports.E.motor = new Motor(toolMotors[0].id);
        hub.ports.F = new Port('motor');
        hub.ports.F.motor = new Motor(toolMotors[1].id);
    }
    const colourSensors = findParts(robot, ['37308']);
    if (colourSensors.length === 1) {
        hub.ports.C = new Port('light');
        hub.ports.C.light = new LightSensor(colourSensors[0].id);
    }
}
