const formatMessage = require('format-message');
const BlockType = require('../../extension-support/block-type');
const ArgumentType = require('../../extension-support/argument-type');
const Cast = require('../../util/cast');
const Icon = require('./icon.png');

const SESSION_TYPE = "immersive-vr";

// thanks to twoerner94 for quaternion-to-euler on npm
function quaternionToEuler(quat) {
    const q0 = quat[0];
    const q1 = quat[1];
    const q2 = quat[2];
    const q3 = quat[3];

    const Rx = Math.atan2(2 * (q0 * q1 + q2 * q3), 1 - (2 * (q1 * q1 + q2 * q2)));
    const Ry = Math.asin(2 * (q0 * q2 - q3 * q1));
    const Rz = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - (2 * (q2 * q2 + q3 * q3)));

    const euler = [Rx, Ry, Rz];

    return euler;
};

function toRad(deg) {
    return deg * (Math.PI / 180);
}
function toDeg(rad) {
    return rad * (180 / Math.PI);
}
function toDegRounding(rad) {
    const result = toDeg(rad);
    if (!String(result).includes('.')) return result;
    const split = String(result).split('.');
    const endingDecimals = split[1].substring(0, 3);
    if ((endingDecimals === '999') && (split[1].charAt(3) === '9')) return Number(split[0]) + 1;
    return Number(split[0] + '.' + endingDecimals);
}

/**
 * Class for 3D VR blokckes
 */
class Jg3DVrBlocks {
    constructor(runtime) {
        /**
         * The runtime instantiating this block package.
         */
        this.runtime = runtime;
        this._3d = {}
        this.three = {}
        if (!this.runtime.ext_jg3d) {
            vm.extensionManager.loadExtensionURL('jg3d')
                .then(() => {
                    this._3d = this.runtime.ext_jg3d;
                    this.three = this._3d.three;
                });
        } else {
            this._3d = this.runtime.ext_jg3d;
            this.three = this._3d.three
        }
    }
    /**
     * metadata for this extension and its blocks.
     * @returns {object}
     */
    getInfo() {
        return {
            id: 'jg3dVr',
            name: '3D VR',
            color1: '#B100FE',
            color2: '#8000BC',
            blockIconURI: Icon,
            blocks: [
                // CORE
                {
                    opcode: 'isSupported',
                    text: 'is vr supported?',
                    blockType: BlockType.BOOLEAN,
                    disableMonitor: true
                },
                {
                    opcode: 'createSession',
                    text: 'create vr session',
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'closeSession',
                    text: 'close vr session',
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'isOpened',
                    text: 'is vr open?',
                    blockType: BlockType.BOOLEAN,
                    disableMonitor: true
                },
                '---',
                {
                    opcode: 'attachObject',
                    text: 'attach camera to object named [OBJECT]',
                    blockType: BlockType.COMMAND,
                    arguments: {
                        OBJECT: {
                            type: ArgumentType.STRING,
                            defaultValue: "Object1"
                        }
                    }
                },
                {
                    opcode: 'detachObject',
                    text: 'detach camera from object',
                    blockType: BlockType.COMMAND
                },
                '---',
                {
                    opcode: 'getControllerPosition',
                    text: 'controller #[INDEX] position [VECTOR3]',
                    blockType: BlockType.REPORTER,
                    disableMonitor: true,
                    arguments: {
                        INDEX: {
                            type: ArgumentType.NUMBER,
                            menu: 'count'
                        },
                        VECTOR3: {
                            type: ArgumentType.STRING,
                            menu: 'vector3'
                        }
                    }
                },
                {
                    opcode: 'getControllerRotation',
                    text: 'controller #[INDEX] rotation [VECTOR3]',
                    blockType: BlockType.REPORTER,
                    disableMonitor: true,
                    arguments: {
                        INDEX: {
                            type: ArgumentType.NUMBER,
                            menu: 'count'
                        },
                        VECTOR3: {
                            type: ArgumentType.STRING,
                            menu: 'vector3'
                        }
                    }
                },
            ],
            menus: {
                vector3: {
                    acceptReporters: true,
                    items: [
                        "x",
                        "y",
                        "z",
                    ].map(item => ({ text: item, value: item }))
                },
                count: {
                    acceptReporters: true,
                    items: [
                        "1",
                        "2",
                    ].map(item => ({ text: item, value: item }))
                }
            }
        };
    }

    // util
    _getRenderer() {
        if (!this._3d) return;
        return this._3d.renderer;
    }

    _disposeImmersive() {
        this.session = null;

        const renderer = this._getRenderer();
        if (!renderer) return;

        renderer.xr.enabled = false;
    }
    async _createImmersive() {
        if (!('xr' in navigator)) return false;
        const renderer = this._getRenderer();
        if (!renderer) return false;

        const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] };
        const session = await navigator.xr.requestSession(SESSION_TYPE, sessionInit);
        this.session = session;
        this.open = true;

        // enable xr on three.js
        renderer.xr.enabled = true;
        await renderer.xr.setSession(session);

        // we need to make sure stuff is back to normal once the vr session is done
        // but this isnt always triggered by the close session block
        // the user can also close it themselves, so we need to handle that
        // this is also triggered by the close session block btw so we dont need
        // to repeat
        session.addEventListener("end", () => {
            this.open = false;
            this._disposeImmersive();
        });

        // setup render loop
        const drawFrame = (_, frame) => {
            // breaks the loop once the session has ended
            if (!this.open) return;

            const threed = this._3d;
            // break loop if no camera or scene
            if (!threed.camera) return;
            if (!threed.scene) return;

            // get view info
            const viewerPose = frame.getViewerPose(this.localSpace);
            const transform = viewerPose.transform;
            // set view info
            this.view = {
                position: [
                    transform.position.x,
                    transform.position.y,
                    transform.position.z
                ],
                quaternion: [
                    transform.orientation.w,
                    transform.orientation.y,
                    transform.orientation.x,
                    transform.orientation.z
                ]
            }
            // force renderer to draw a new frame
            // otherwise we would only actually draw outside of this loop
            // which just ends up showing nothing
            // since rendering only happens in session.requestAnimationFrame
            // we also dont give blocks for rendering
            // because it would be too slow compared to just rendering
            // every animation frame
            renderer.render(threed.scene, threed.camera);
            // loop again
            session.requestAnimationFrame(drawFrame);
        }
        session.requestAnimationFrame(drawFrame);

        // reference space
        session.requestReferenceSpace("local").then(space => {
            this.localSpace = space;
            // TODO: add "when position reset" hat?
            //     done with space.addEventListener("reset")
        });

        return session;
    }

    // blocks
    isSupported() {
        if (!('xr' in navigator)) return false;
        return navigator.xr.isSessionSupported(SESSION_TYPE);
    }
    isOpened() {
        return this.open;
    }

    createSession() {
        if (this.open) return;
        if (this.session) return;
        return this._createImmersive();
    }
    closeSession() {
        this.open = false;
        if (!this.session) return;
        return this.session.end();
    }

    // extra
    attachObject(args) {
        const three = this._3d;
        if (!three.scene) return;
        if (!three.camera) return;
        const name = Cast.toString(args.NAME);
        const object = three.scene.getObjectByName(name);
        if (!object) return;
        object.add(three.camera);
    }
    detachObject() {
        const three = this._3d;
        if (!three.scene) return;
        if (!three.camera) return;
        three.scene.add(three.camera);
    }

    // inputs
    getControllerPosition(args) {
        const three = this._3d;
        if (!three.scene) return "";
        const index = Cast.toNumber(args.INDEX) - 1;
        const renderer = this._getRenderer();
        if (!renderer) return "";
        const controller = renderer.xr.getController(index);
        if (!controller) return "";
        const v = args.VECTOR3;
        if (!v) return "";
        if (!["x", "y", "z"].includes(v)) return "";
        return Cast.toNumber(controller.position[v]);
    }
    getControllerRotation(args) {
        const three = this._3d;
        if (!three.scene) return "";
        const index = Cast.toNumber(args.INDEX) - 1;
        const renderer = this._getRenderer();
        if (!renderer) return "";
        const controller = renderer.xr.getController(index);
        if (!controller) return "";
        const v = args.VECTOR3;
        if (!v) return "";
        if (!["x", "y", "z"].includes(v)) return "";
        const rotation = Cast.toNumber(controller.rotation[v]);
        // rotation is in radians, convert to degrees but round it
        // a bit so that we get 46 instead of 45.999999999999996
        return toDegRounding(rotation);
    }
}

module.exports = Jg3DVrBlocks;