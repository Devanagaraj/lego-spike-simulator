import { allPorts, Hub, Port, type PortType } from '$lib/spike/vm';

/** Keep mechanical links attached to a device when its cable is moved. */
export function assignDevicePort(hub: Hub, target: PortType, device: Port) {
    const deviceId = device.id();
    const previous = deviceId === 'none'
        ? undefined
        : allPorts.find((port) => hub.ports[port].id() === deviceId);
    const replaced = hub.ports[target];
    const replacedId = replaced.id();

    if (previous === target) {
        hub.ports[target] = device;
        return;
    }

    // Moving an already connected motor onto an occupied port swaps the two
    // cables. Keep each wheel and attachment with its physical motor.
    if (previous && replacedId !== 'none' && deviceId !== 'none') {
        for (const wheel of hub.wheels) {
            if (wheel.port === previous) wheel.port = target;
            else if (wheel.port === target) wheel.port = previous;
        }
        for (const part of hub.attachments) {
            if (part.port === previous) part.port = target;
            else if (part.port === target) part.port = previous;
        }
        hub.ports[previous] = replaced;
        hub.ports[target] = device;
        return;
    }

    if (replacedId !== deviceId) {
        hub.wheels = hub.wheels.filter((wheel) => wheel.port !== target);
        hub.attachments = hub.attachments.filter((part) => part.port !== target);
    }
    if (previous && previous !== target) {
        for (const wheel of hub.wheels) {
            if (wheel.port === previous) wheel.port = target;
        }
        for (const part of hub.attachments) {
            if (part.port === previous) part.port = target;
        }
        hub.ports[previous] = new Port('none');
    }
    hub.ports[target] = device;
}
