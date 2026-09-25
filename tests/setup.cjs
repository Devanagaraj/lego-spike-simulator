global.window = { location: { href: 'file://' } };
global.Audio = class { pause() {} };
global.AudioContext = class {
    constructor() { this.destination = {}; }
    createOscillator() { return { connect() {} }; }
};
