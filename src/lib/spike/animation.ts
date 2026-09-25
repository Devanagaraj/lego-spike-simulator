/** Match moving-part rotation to the LDraw-to-scene axis flip. */
export function movingPartVisualAngle(motorPosition: number, ratio: number): number {
    return -(motorPosition * ratio);
}
