// In a new file: electron/menu.js

const { app, Menu, shell } = require("electron");
const isMac = process.platform === "darwin";

function createMenu(mainWindow) {
  const template = [
    // { role: 'appMenu' }
    ...(isMac
      ? [
          {
            label: "Hyperporter",
            submenu: [
              { role: "about", label: "About Hyperporter" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide", label: "Hide Hyperporter" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", label: "Quit Hyperporter" },
            ],
          },
        ]
      : []),
    // { role: 'fileMenu' }
    {
      label: "File",
      submenu: [
        {
          label: "Select Destination Folder",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            mainWindow.webContents.send("menu-select-folder");
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    // { role: 'viewMenu' }
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // { role: 'helpMenu' }
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            await shell.openExternal(
              "https://blackmagicdesign.com/products/hyperdeckstudio",
            );
          },
        },
        {
          label: "Report Issue",
          click: async () => {
            await shell.openExternal("https://github.com/BPT1901");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = createMenu;
