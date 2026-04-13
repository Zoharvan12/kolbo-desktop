// Webview Preload - Bridges webapp postMessage to Electron IPC
// This script runs in each webview guest page context,
// forwarding messages from the webapp to the host renderer process.
const { ipcRenderer } = require('electron');

// The webapp posts messages via window.parent.postMessage({type: '...', ...}, '*')
// In a webview, window.parent === window (no parent frame).
// We intercept self-posted messages and forward them to the host via IPC.
window.addEventListener('message', (event) => {
  if (event.source === window && event.data && event.data.type) {
    ipcRenderer.sendToHost('webview-message', event.data);
  }
});

// Allow host renderer to send messages INTO the webview
ipcRenderer.on('host-message', (event, data) => {
  window.postMessage(data, '*');
});
