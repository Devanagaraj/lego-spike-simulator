import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { findParts, findPartTransform, setRobotFromContent, setStudioMode } from '../src/lib/ldraw/components';
import { WebGLCompiler } from '../src/lib/ldraw/gl';
import { assignDevicePort } from '../src/lib/spike/connections';
import { ATTACHMENT_DRIVE_NAME, DIFFERENTIAL_DRIVE_NAME, FLL_MPD_DRIVE_NAME, canonicalPresetName, configurePresetDrive, connectStudioDrive, isAttachmentDriveName, isFllMpdDriveName } from '../src/lib/spike/presets';
import { movingPartVisualAngle } from '../src/lib/spike/animation';
import { ActionStatement, EventStatement, StatementBlock, Thread, Value, Hub, Motor, Port, VM, Wheel, LightSensor } from '../src/lib/spike/vm';
import * as m4 from '../src/lib/ldraw/m4';

async function makeRobot(bot: 1 | 2 | 3) {
    const name = bot === 1 ? DIFFERENTIAL_DRIVE_NAME : bot === 2 ? ATTACHMENT_DRIVE_NAME : FLL_MPD_DRIVE_NAME;
    const content = bot === 1 ? readFileSync('src/lib/assets/robots/DifferentialDriveBot.mpd', 'utf8')
        : bot === 2 ? await (await JSZip.loadAsync(readFileSync('src/lib/assets/robots/DriveAndAttachmentBot.io'))).file('model2.ldr')!.async('string')
        : readFileSync('src/lib/assets/robots/FLLAttachmentBot.mpd', 'utf8');
    setStudioMode(bot === 2);
    const model = setRobotFromContent(content);
    setStudioMode(false);
    const hub = new Hub();
    if (bot === 2) connectStudioDrive(hub, model);
    else for (const part of model.subparts) {
        const port = part.port?.port as 'A' | 'B' | 'C' | 'D' | 'E' | undefined;
        if (!port) continue;
        if (['54696.dat', '54675.dat'].includes(part.modelNumber)) {
            hub.ports[port] = new Port('motor');
            hub.ports[port].motor = new Motor(part.id);
        } else if (part.modelNumber === '39367p01.dat') {
            hub.wheels.push(new Wheel(part.id, 28, part.gear_ratio!, port, m4.identity()));
        } else if (part.modelNumber === '37308.dat') {
            hub.ports[port] = new Port('light');
            hub.ports[port].light = new LightSensor(part.id);
        }
    }
    configurePresetDrive(hub, model, name);
    const compiled = new WebGLCompiler().compileModel(model, { rescale: false });
    for (const wheel of hub.wheels) {
        let transform = m4.translate(m4.identity(), compiled.recenter.x, compiled.recenter.y, compiled.recenter.z);
        transform = m4.axisRotate(transform, [1, 0, 0], Math.PI);
        transform = m4.scale(transform, 0.4, 0.4, 0.4);
        wheel.locationTransform = m4.multiply(transform, findPartTransform(model, wheel.id)!.forward);
        wheel.applyTransform();
    }
    const vm = new VM('test', hub, {}, new Map(), new Map(), undefined);
    vm.alignWheelsToModel();
    const height = Math.max(...hub.wheels.map(w => w.radius - w.position.y));
    const scene = { robot: { name, anchored: false, position: { x: 0, y: height, z: 0 }, rotation: 0 }, objects: [], map: undefined, mapWidth: 2000, mapHeight: 2000 };
    const thread = new Thread('test', vm, new EventStatement('flipperevents_whenProgramStarts', '', [], new StatementBlock([])), {});
    return { vm, hub, scene, height, model, thread, meshHeight: -compiled.bbox.min.y };
}
const value = (v: string | number) => new Value('text', '', String(v));
const signed = (a: number) => ((a + 180) % 360 + 360) % 360 - 180;
function tank(thread: Thread, left: number, right: number) {
    new ActionStatement('', '', [value('AB')]).execute_flippermove(thread, 'setMovementPair').next();
    new ActionStatement('', '', [value(left), value(right)]).execute_flippermoremove(thread, 'startDualSpeed').next();
}

for (const bot of [1, 2] as const) {
    const name = bot === 1 ? DIFFERENTIAL_DRIVE_NAME : ATTACHMENT_DRIVE_NAME;
    test(`${name}: A left, B right, C sensor; forward follows gear end`, async () => {
        const { vm, hub, scene, model, height, meshHeight, thread } = await makeRobot(bot);
        assert.equal(hub.ports.A.type, 'motor');
        assert.equal(hub.ports.B.type, 'motor');
        assert.equal(hub.ports.C.type, 'light');
        const a = hub.wheels.find(w => w.port === 'A')!, b = hub.wheels.find(w => w.port === 'B')!;
        assert.equal(a.gearing, 1); assert.equal(b.gearing, -1);
        const forwardZ = bot === 1 ? 1 : -1;
        assert.ok(a.position.x - b.position.x > 0, 'A wheel is on the visible left side of B in the back view');
        const motorX = (port: 'A' | 'B') => findPartTransform(model, hub.ports[port].motor!.id)!.forward[12];
        assert.ok(motorX('A') - motorX('B') > 0, 'A motor is on the visible left side of B in the back view');
        assert.ok(Math.abs(height - meshHeight) < 0.01);
        vm.moveRobot(0.1, scene);
        assert.deepEqual(scene.robot.position, { x: 0, y: height, z: 0 });
        assert.equal(scene.robot.rotation, 0);
        new ActionStatement('', '', [value('AB')]).execute_flippermove(thread, 'setMovementPair').next();
        hub.moveSpeed = 30;
        new ActionStatement('', '', []).execute_flippermove(thread, 'startMove').next();
        for (let i = 0; i < 20; i++) vm.moveRobot(0.01, scene);
        assert.ok(scene.robot.position.z * forwardZ > 1);
        assert.ok(Math.abs(signed(scene.robot.rotation)) < 0.01);
        const gears = findParts(model, ['32270']);
        const gearZ = gears.reduce((sum, p) => sum + findPartTransform(model, p.id)!.forward[14], 0) / gears.length;
        const wheelZ = hub.wheels.reduce((sum, w) => sum + findPartTransform(model, w.id)!.forward[14], 0) / 2;
        assert.ok(scene.robot.position.z * -(gearZ - wheelZ) > 0, 'travel toward the actual gear geometry');
        tank(thread, -30, -30);
        for (let i = 0; i < 40; i++) vm.moveRobot(0.01, scene);
        assert.ok(scene.robot.position.z * forwardZ < -1);
        assert.equal(scene.robot.position.y, height);
    });
    test(`${name}: A-only arcs right, B-only arcs left, tank turn reaches 90 degrees`, async () => {
        for (const [left, right, sign] of [[30, 0, -1], [0, 30, 1]] as const) {
            const { vm, scene, thread, height } = await makeRobot(bot);
            tank(thread, left, right); vm.moveRobot(0.03, scene);
            assert.ok(signed(scene.robot.rotation) * sign > 0);
            assert.ok(Math.abs(scene.robot.position.z) > 0);
            assert.equal(scene.robot.position.y, height);
        }
        const { vm, hub, scene, thread } = await makeRobot(bot);
        tank(thread, 30, -30);
        assert.equal(hub.yaw, 0);
        for (let i = 0; i < 300 && Math.abs(hub.yaw) < 90; i++) vm.moveRobot(0.01, scene);
        assert.ok(Math.abs(hub.yaw) >= 90 && Math.abs(hub.yaw) < 92);
        assert.ok(Math.abs(hub.yaw + signed(scene.robot.rotation)) < 0.01);
        assert.ok(Math.abs(scene.robot.position.x) < 0.01 && Math.abs(scene.robot.position.z) < 0.01);
        const rightSpin = await makeRobot(bot);
        tank(rightSpin.thread, 20, -20);
        rightSpin.vm.moveRobot(0.01, rightSpin.scene);
        assert.ok(signed(rightSpin.scene.robot.rotation) < 0, 'A=20/B=-20 spins right from the gear-facing back view');
    });
}
test('Port reassignment carries wheels; restoring current-layout cache preserves customization', async () => {
    const { vm, hub, scene, model } = await makeRobot(2);
    const id = hub.ports.B.id();
    assignDevicePort(hub, 'D', hub.ports.B);
    configurePresetDrive(hub, model, ATTACHMENT_DRIVE_NAME, false);
    assert.equal(hub.ports.B.type, 'none'); assert.equal(hub.ports.D.id(), id);
    assert.equal(hub.wheels.find(w => w.port === 'D')?.gearing, -1);
    hub.ports.D.motor!.startMotor({ percent: 30, reverse: false, ignorePresetSpeed: true });
    vm.moveRobot(0.01, scene); assert.notEqual(scene.robot.rotation, 0);
    assignDevicePort(hub, 'D', new Port('none')); assert.equal(hub.wheels.length, 1);
});
test('Legacy preset migration preserves sensors and tool motors', async () => {
    for (const bot of [1, 2] as const) {
        const { hub, model } = await makeRobot(bot);
        const left = hub.ports.A.id(), right = hub.ports.B.id(), sensor = hub.ports.C.id(), tool = hub.ports.E.id();
        if (bot === 1) {
            assignDevicePort(hub, 'D', hub.ports.A); assignDevicePort(hub, 'C', hub.ports.B);
        } else {
            assignDevicePort(hub, 'C', hub.ports.A); assignDevicePort(hub, 'A', hub.ports.B);
        }
        configurePresetDrive(hub, model, bot === 1 ? 'SimpleBot' : 'Robot 2');
        assert.equal(hub.ports.A.id(), left); assert.equal(hub.ports.B.id(), right);
        assert.equal(hub.ports.C.id(), sensor); assert.equal(hub.ports.E.id(), tool);
        assert.deepEqual(hub.wheels.map(w => w.port).sort(), ['A', 'B']);
    }
});
test('Occupied A/B swap retains wheels and attachment links', async () => {
    const { hub } = await makeRobot(1);
    const a = hub.ports.A.id(), b = hub.ports.B.id();
    hub.attachments.push({ id: 99, port: 'A', ratio: 1, axis: 'z' });
    assignDevicePort(hub, 'B', hub.ports.A);
    assert.equal(hub.ports.A.id(), b); assert.equal(hub.ports.B.id(), a);
    assert.deepEqual(hub.wheels.map(w => w.port).sort(), ['A', 'B']);
    assert.equal(hub.attachments[0].port, 'B');
});
test('Attachment preset recognizes descriptive and legacy names', () => {
    for (const name of [ATTACHMENT_DRIVE_NAME, 'Bot 2', 'Robot 2', 'DriveAndAttachmentBot', 'Drive + Attachments Bot']) assert.ok(isAttachmentDriveName(name));
    assert.equal(isAttachmentDriveName(DIFFERENTIAL_DRIVE_NAME), false);
    assert.equal(canonicalPresetName('Differential Drive Trainer'), DIFFERENTIAL_DRIVE_NAME);
    assert.equal(canonicalPresetName('Drive + Attachments Bot'), ATTACHMENT_DRIVE_NAME);
});
test('Tool motor runs without drive wheels and reverses its visual angle', () => {
    const hub = new Hub(); hub.ports.E = new Port('motor'); hub.ports.E.motor = new Motor(12);
    const vm = new VM('tool', hub, {}, new Map(), new Map(), undefined);
    const scene = { robot: { name: 'tool', anchored: false, position: { x: 0, y: 0, z: 0 }, rotation: 0 }, objects: [], map: undefined, mapWidth: 2000, mapHeight: 2000 };
    for (const reverse of [false, true]) {
        hub.ports.E.motor.reset(); hub.ports.E.motor.startMotor({ percent: 30, reverse, ignorePresetSpeed: true });
        vm.moveRobot(0.01, scene);
        assert.ok(signed(movingPartVisualAngle(hub.ports.E.motor.position, 1)) * (reverse ? 1 : -1) > 0);
        assert.equal(scene.robot.rotation, 0);
    }
});
test('A bounded attachment gear stalls at its mechanical stop and reverses away from it', () => {
    const hub = new Hub();
    hub.ports.E = new Port('motor');
    hub.ports.E.motor = new Motor(20);
    hub.attachments.push({ id: 21, port: 'E', ratio: 1, axis: 'z', minAngle: -100, maxAngle: 100 });
    const vm = new VM('attachment-stop', hub, {}, new Map(), new Map(), undefined);
    const scene = { robot: { name: 'attachment-stop', anchored: false, position: { x: 0, y: 0, z: 0 }, rotation: 0 }, objects: [], map: undefined, mapWidth: 2000, mapHeight: 2000 };
    hub.ports.E.motor.startMotor({ percent: 100, reverse: false, ignorePresetSpeed: true });
    vm.moveRobot(1, scene);
    assert.ok(Math.abs(hub.ports.E.motor.relativePosition - 100) < 1e-6);
    assert.equal(hub.ports.E.motor.on, false);
    hub.ports.E.motor.startMotor({ percent: 30, reverse: true, ignorePresetSpeed: true });
    vm.moveRobot(0.1, scene);
    assert.ok(hub.ports.E.motor.relativePosition < 100);
});
test(`${FLL_MPD_DRIVE_NAME}: metadata C/D is remapped to A/B and faces its gear end`, async () => {
    const { vm, hub, scene, model, thread } = await makeRobot(3);
    assert.equal(hub.ports.A.type, 'motor');
    assert.equal(hub.ports.B.type, 'motor');
    assert.equal(hub.ports.C.type, 'none');
    assert.equal(hub.ports.D.type, 'none');
    const a = hub.wheels.find((wheel) => wheel.port === 'A')!;
    const b = hub.wheels.find((wheel) => wheel.port === 'B')!;
    assert.equal(a.gearing, 1);
    assert.equal(b.gearing, -1);
    assert.ok(a.position.x - b.position.x > 0);
    const gears = findParts(model, ['32270']);
    const gearZ = gears.reduce((sum, part) => sum + findPartTransform(model, part.id)!.forward[14], 0) / gears.length;
    const wheelZ = (findPartTransform(model, a.id)!.forward[14] + findPartTransform(model, b.id)!.forward[14]) / 2;
    new ActionStatement('', '', [value('AB')]).execute_flippermove(thread, 'setMovementPair').next();
    hub.moveSpeed = 30;
    new ActionStatement('', '', []).execute_flippermove(thread, 'startMove').next();
    for (let i = 0; i < 20; i++) vm.moveRobot(0.01, scene);
    assert.ok(scene.robot.position.z * -(gearZ - wheelZ) > 1);
});
test('FLL MPD preset name is stable across the robot menu/cache', () => {
    assert.ok(isFllMpdDriveName(FLL_MPD_DRIVE_NAME));
    assert.ok(isFllMpdDriveName('FFL_bot_with_attachment'));
    assert.ok(isFllMpdDriveName('FLLAttachmentBot.mpd'));
    assert.equal(canonicalPresetName('FFL_bot_with_attachment'), FLL_MPD_DRIVE_NAME);
    assert.equal(canonicalPresetName('FLLAttachmentBot'), ATTACHMENT_DRIVE_NAME);
});
