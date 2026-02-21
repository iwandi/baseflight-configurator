/*
 * Electron main process for Baseflight Configurator.
 *
 * Replaces the Chrome App background.js.  It creates the application window
 * and provides IPC-based pass-throughs for serial port access (via the
 * `serialport` npm package) and file-system dialogs (via Electron's built-in
 * `dialog` module).  The renderer-side Chrome API shims live in preload.js.
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

// ─── Serial port state ────────────────────────────────────────────────────────

let activePort = null;         // Currently open SerialPort instance
let rendererWindow = null;     // Reference to the renderer WebContents for push events

// ─── Window creation ──────────────────────────────────────────────────────────

function createWindow() {
    const win = new BrowserWindow({
        width: 960,
        height: 625,
        resizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            nodeIntegration: false
        }
    });

    rendererWindow = win.webContents;

    win.loadFile('main.html');

    // Cleanly close the serial port when the window is closed
    win.on('closed', function () {
        rendererWindow = null;
        if (activePort && activePort.isOpen) {
            activePort.close();
            activePort = null;
        }
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
    app.quit();
});

// ─── IPC: Serial port ─────────────────────────────────────────────────────────

// List available serial ports
ipcMain.handle('serial:getDevices', async () => {
    try {
        const ports = await SerialPort.list();
        return ports.map(function (p) { return p.path; });
    } catch (e) {
        console.error('serial:getDevices error', e);
        return [];
    }
});

// Open a serial port
ipcMain.handle('serial:connect', async function (event, portPath, options) {
    return new Promise(function (resolve) {
        if (activePort && activePort.isOpen) {
            activePort.close();
            activePort = null;
        }

        const port = new SerialPort({
            path: portPath,
            baudRate: options.bitrate || 115200,
            autoOpen: false
        });

        port.open(function (err) {
            if (err) {
                console.error('SERIAL: Failed to open port:', err.message);
                resolve(false);
                return;
            }

            activePort = port;

            port.on('data', function (data) {
                if (rendererWindow && !rendererWindow.isDestroyed()) {
                    // Send as Uint8Array so the preload can convert it to ArrayBuffer
                    rendererWindow.send('serial:data', new Uint8Array(data));
                }
            });

            port.on('error', function (err) {
                console.error('SERIAL: Port error:', err.message);
            });

            console.log('SERIAL: Connection opened on ' + portPath + ' at ' + (options.bitrate || 115200) + ' baud');
            resolve({ connectionId: 1, bitrate: options.bitrate || 115200 });
        });
    });
});

// Close the serial port
ipcMain.handle('serial:disconnect', async function () {
    return new Promise(function (resolve) {
        if (activePort && activePort.isOpen) {
            activePort.close(function (err) {
                activePort = null;
                console.log('SERIAL: Connection closed');
                resolve(!err);
            });
        } else {
            activePort = null;
            resolve(true);
        }
    });
});

// Write data to the serial port
ipcMain.handle('serial:send', async function (event, _id, data) {
    return new Promise(function (resolve) {
        if (activePort && activePort.isOpen) {
            const buf = Buffer.from(data);
            activePort.write(buf, function (err) {
                resolve({ bytesSent: err ? 0 : buf.length });
            });
        } else {
            resolve({ bytesSent: 0 });
        }
    });
});

// Set modem control signals (DTR, RTS, …)
ipcMain.handle('serial:setControlSignals', async function (event, _id, signals) {
    return new Promise(function (resolve) {
        if (activePort && activePort.isOpen) {
            activePort.set(signals, function (err) { resolve(!err); });
        } else {
            resolve(false);
        }
    });
});

// Get modem control signals (CTS, DSR, …)
ipcMain.handle('serial:getControlSignals', async function (event, _id) {
    return new Promise(function (resolve) {
        if (activePort && activePort.isOpen) {
            activePort.get(function (err, status) { resolve(err ? {} : status); });
        } else {
            resolve({});
        }
    });
});

// ─── IPC: File-system dialogs ─────────────────────────────────────────────────

ipcMain.handle('dialog:choose', async function (event, options) {
    if (options.type === 'saveFile') {
        const result = await dialog.showSaveDialog({
            defaultPath: options.suggestedName || 'file',
            filters: _buildFilters(options.accepts)
        });
        if (result.canceled || !result.filePath) return null;
        return { type: 'save', path: result.filePath };
    }

    // 'openFile' (default)
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: _buildFilters(options.accepts)
    });
    if (result.canceled || !result.filePaths.length) return null;
    return { type: 'open', path: result.filePaths[0] };
});

function _buildFilters(accepts) {
    if (!accepts || !accepts.length) return undefined;
    return accepts.map(function (a) {
        return { name: 'Files', extensions: a.extensions || [] };
    });
}
