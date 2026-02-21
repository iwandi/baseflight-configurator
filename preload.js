/*
 * preload.js – Chrome API shims for Baseflight Configurator running in Electron.
 *
 * This script is injected by Electron before the page's own scripts load.
 * With contextIsolation: false the `window` object here is the same one that
 * the renderer page uses, so assigning to `window.chrome` makes the shim
 * available to all existing page scripts without any modification.
 *
 * Shims provided:
 *   chrome.serial          – IPC bridge to serialport in the main process
 *   chrome.storage.local   – localStorage-backed key/value store
 *   chrome.i18n            – reads _locales/en/messages.json via fs
 *   chrome.fileSystem      – Electron dialog + Node fs for save/open
 *   chrome.runtime         – getManifest() + getBackgroundPage() stubs
 */

'use strict';

const { ipcRenderer } = require('electron');
const fs   = require('fs');
const path = require('path');

// ─── i18n ─────────────────────────────────────────────────────────────────────

let _messages = {};
try {
    const msgPath = path.join(__dirname, '_locales', 'en', 'messages.json');
    _messages = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
} catch (e) {
    console.warn('preload: could not load _locales/en/messages.json', e);
}

function _getMessage(messageId, substitutions) {
    const entry = _messages[messageId];
    if (!entry) return '';
    let text = entry.message || '';
    if (substitutions) {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        subs.forEach(function (sub, i) {
            text = text.replace('$' + (i + 1), sub);
        });
    }
    return text;
}

// ─── Serial receive dispatcher ────────────────────────────────────────────────

const _serialListeners = [];

ipcRenderer.on('serial:data', function (event, uint8arr) {
    // uint8arr arrives as Uint8Array; give listeners a proper ArrayBuffer slice
    const buf = uint8arr.buffer.slice(
        uint8arr.byteOffset,
        uint8arr.byteOffset + uint8arr.byteLength
    );
    _serialListeners.forEach(function (fn) {
        fn({ data: buf });
    });
});

// ─── FileEntry helpers ────────────────────────────────────────────────────────

function _createReadEntry(filePath) {
    return {
        _path: filePath,
        file: function (callback) {
            const data = fs.readFileSync(filePath);
            const file = new File([data], path.basename(filePath));
            callback(file);
        }
    };
}

function _createWriteEntry(filePath) {
    return {
        _path: filePath,
        createWriter: function (callback /*, errorCallback */) {
            const writer = {
                onwriteend: null,
                onerror: null,
                write: function (blob) {
                    const self = this;
                    const reader = new FileReader();
                    reader.onloadend = function (e) {
                        try {
                            fs.writeFileSync(filePath, Buffer.from(e.target.result));
                            if (self.onwriteend) self.onwriteend();
                        } catch (err) {
                            if (self.onerror) self.onerror(err);
                        }
                    };
                    reader.readAsArrayBuffer(blob);
                },
                truncate: function () {
                    // File already written correctly; just fire the second onwriteend
                    if (this.onwriteend) this.onwriteend();
                }
            };
            callback(writer);
        }
    };
}

// ─── chrome shim ─────────────────────────────────────────────────────────────

window.chrome = {

    // ── serial ────────────────────────────────────────────────────────────────
    serial: {
        onReceive: {
            addListener: function (fn) {
                _serialListeners.push(fn);
            },
            removeListener: function (fn) {
                const idx = _serialListeners.indexOf(fn);
                if (idx !== -1) _serialListeners.splice(idx, 1);
            }
        },

        connect: function (portPath, options, callback) {
            ipcRenderer.invoke('serial:connect', portPath, options)
                .then(callback)
                .catch(function () { callback(false); });
        },

        disconnect: function (_id, callback) {
            ipcRenderer.invoke('serial:disconnect')
                .then(callback)
                .catch(function () { callback(false); });
        },

        getDevices: function (callback) {
            ipcRenderer.invoke('serial:getDevices')
                .then(function (paths) {
                    callback(paths.map(function (p) { return { path: p }; }));
                })
                .catch(function () { callback([]); });
        },

        send: function (_id, data, callback) {
            // data is an ArrayBuffer from the existing code
            const uint8 = new Uint8Array(data);
            ipcRenderer.invoke('serial:send', _id, uint8)
                .then(callback)
                .catch(function () { callback({ bytesSent: 0 }); });
        },

        setControlSignals: function (_id, signals, callback) {
            ipcRenderer.invoke('serial:setControlSignals', _id, signals)
                .then(callback)
                .catch(function () { if (callback) callback(false); });
        },

        getControlSignals: function (_id, callback) {
            ipcRenderer.invoke('serial:getControlSignals', _id)
                .then(callback)
                .catch(function () { callback({}); });
        }
    },

    // ── storage ───────────────────────────────────────────────────────────────
    storage: {
        local: {
            get: function (key, callback) {
                const result = {};
                const keys = Array.isArray(key) ? key : (typeof key === 'string' ? [key] : []);
                keys.forEach(function (k) {
                    const raw = localStorage.getItem(k);
                    if (raw !== null) {
                        try { result[k] = JSON.parse(raw); } catch (e) { result[k] = raw; }
                    }
                });
                callback(result);
            },
            set: function (obj, callback) {
                Object.keys(obj).forEach(function (k) {
                    localStorage.setItem(k, JSON.stringify(obj[k]));
                });
                if (callback) callback();
            }
        }
    },

    // ── i18n ──────────────────────────────────────────────────────────────────
    i18n: {
        getMessage: _getMessage
    },

    // ── fileSystem ────────────────────────────────────────────────────────────
    fileSystem: {
        chooseEntry: function (options, callback) {
            ipcRenderer.invoke('dialog:choose', options)
                .then(function (result) {
                    if (!result) { callback(null); return; }
                    if (result.type === 'save') {
                        callback(_createWriteEntry(result.path));
                    } else {
                        callback(_createReadEntry(result.path));
                    }
                })
                .catch(function () { callback(null); });
        },

        getDisplayPath: function (entry, callback) {
            callback((entry && entry._path) ? entry._path : '');
        },

        getWritableEntry: function (entry, callback) {
            // All entries returned by chooseEntry are already writable
            callback(entry);
        },

        isWritableEntry: function (entry, callback) {
            callback(true);
        }
    },

    // ── runtime ───────────────────────────────────────────────────────────────
    runtime: {
        lastError: undefined,

        getManifest: function () {
            return { version: '0.36', name: 'Baseflight Configurator' };
        },

        getBackgroundPage: function (callback) {
            // In Electron there is no separate background page.
            // Return a stub that satisfies the existing code in main.js.
            callback({
                app_window: null,
                serial: { connectionId: -1 }
            });
        }
    }
};
