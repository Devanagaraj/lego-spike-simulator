import { clearPorts, saveMPD, setGearRatio, setPort, setRotationAxis, type Model } from '$lib/ldraw/components';
import { allPorts, type Hub } from '$lib/spike/vm';
import { readCache, writeCache } from '$lib/browser-cache';

export interface SavedRobot {
    driveLayoutVersion?: number;
    name: string;
    content: string;
}

let pendingSave: Promise<void> = Promise.resolve();

export function saveRobotToBrowser(robot: Model | undefined, hub: Hub, name: string) {
    if (!robot) return pendingSave;
    clearPorts(robot);
    for (const port of allPorts) {
        const id = hub.ports[port].id();
        if (id !== 'none') setPort(robot, 'main', port, id);
    }
    for (const wheel of hub.wheels) {
        setPort(robot, 'main', wheel.port, wheel.id);
        setGearRatio(robot, wheel.gearing, wheel.id);
    }
    for (const attachment of hub.attachments) {
        setPort(robot, 'main', attachment.port, attachment.id);
        setGearRatio(robot, attachment.ratio, attachment.id);
        setRotationAxis(robot, attachment.axis, attachment.id);
    }
    const snapshot: SavedRobot = { name, content: saveMPD(robot), driveLayoutVersion: 4 };
    pendingSave = pendingSave.catch(() => undefined).then(() => writeCache('robot', snapshot));
    return pendingSave;
}

export async function loadRobotFromBrowser(): Promise<SavedRobot | undefined> {
    const saved = await readCache<SavedRobot>('robot');
    return saved && typeof saved.name === 'string' && typeof saved.content === 'string'
        ? saved
        : undefined;
}

export function saveLibraryToBrowser(blob: Blob) {
    return writeCache('ldraw-library', blob);
}

export function loadLibraryFromBrowser() {
    return readCache<Blob>('ldraw-library');
}

export async function downloadOfficialLibrary(): Promise<Blob> {
    const sources = [
        '/ldraw-library/complete.zip',
        'complete.zip',
        'https://library.ldraw.org/library/updates/complete.zip'
    ];
    for (const source of sources) {
        try {
            const response = await fetch(source);
            if (!response.ok) continue;
            const blob = await response.blob();
            const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
            if (signature[0] === 0x50 && signature[1] === 0x4b) return blob;
        } catch {
            // Try another source (for example, if the official site blocks CORS).
        }
    }
    throw new Error('The LDraw ZIP could not be downloaded from this browser.');
}
