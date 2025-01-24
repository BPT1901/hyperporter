const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods for the renderer process
contextBridge.exposeInMainWorld("electron", {
  // IPC communication
  ipcRenderer: {
    send: (channel, data) => {
      const validChannels = [
        "connect-to-hyperdeck",
        "disconnect-hyperdeck",
        "start-monitoring",
        "stop-monitoring",
        "get-clip-list",
        "path-join",
        "select-directory",
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    on: (channel, func) => {
      const validChannels = [
        "connect-to-hyperdeck-response",
        "disconnect-hyperdeck-response",
        "start-monitoring-response",
        "stop-monitoring-response",
        "get-clip-list-response",
        "hyperdeck-slot-status",
        "hyperdeck-error",
        "path-join-response",
        "directory-selected",
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    },
    once: (channel, func) => {
      const validChannels = [
        "connect-to-hyperdeck-response",
        "disconnect-hyperdeck-response",
        "start-monitoring-response",
        "stop-monitoring-response",
        "get-clip-list-response",
        "path-join-response",
        "directory-selected",
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.once(channel, (event, ...args) => func(...args));
      }
    },
  },

  dialog: {
    selectDirectory: () => ipcRenderer.invoke("select-directory"),
  },
});
