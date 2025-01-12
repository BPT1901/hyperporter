//electron/main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const hyperdeckService = require('../server/services/hyperdeckService');
const net = require('net');
const createMenu = require('./menu');

app.name = 'Hyperporter';


const isDev = process.env.NODE_ENV === 'development';

const serverPath = path.join(__dirname, '..', 'server', 'index.js');
let serverProcess = null;

if (!isDev) {
  // Start the server in production
  serverProcess = require('child_process').fork(serverPath);
}


function testHyperdeckConnection(ip) {
  return new Promise((resolve, reject) => {
    const testSocket = new net.Socket();
    const timeout = setTimeout(() => {
      testSocket.destroy();
      reject(new Error('Connection timeout'));
    }, 5000);

    testSocket.connect(9993, ip, () => {
      clearTimeout(timeout);
      testSocket.destroy();
      resolve(true);
    });

    testSocket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

// if (process.platform === 'darwin') {
//   app.dock.setIcon(path.join(__dirname, '..', 'assets', 'icon.icns'));
// }

function createWindow() {
  // Determine icon path based on platform and environment
  let iconPath;
  if (isDev) {
    iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  } else {
    // In production, use the bundled resources path
    iconPath = path.join(process.resourcesPath, 'icon.png');
  }

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    title: "Hyperporter",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.setTitle('Hyperporter');
});
  
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Destination Folder'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('menu-select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Destination Folder'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  console.log('Starting application...');
  
  const startURL = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '..', 'client', 'build', 'index.html')}`;

    console.log('Environment:', isDev ? 'Development' : 'Production');
    console.log('Loading path:', path.join(__dirname, '..', 'client', 'build', 'index.html'));
    console.log('App path:', app.getAppPath());
    console.log('Loading URL:', startURL);
  
  mainWindow.loadURL(startURL);

  // Open DevTools in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Setup IPC handlers

  ipcMain.on('path-join', (event, args) => {
    event.reply('path-join-response', path.join(...args));
  });
  
  ipcMain.on('connect-to-hyperdeck', async (event, ipAddress) => {
    console.log('Attempting to connect to HyperDeck at:', ipAddress);
    try {
      // First test basic connectivity
      await testHyperdeckConnection(ipAddress);
      console.log('Basic connection test successful');
      
      // Then attempt full connection
      await hyperdeckService.connect(ipAddress);
      console.log('Full HyperDeck connection successful');
      
      event.reply('connect-to-hyperdeck-response', {
        success: true,
        message: 'Connected successfully'
      });
    } catch (error) {
      console.error('Connection error:', error);
      event.reply('connect-to-hyperdeck-response', {
        success: false,
        message: error.message
      });
    }
  });

  ipcMain.on('disconnect-hyperdeck', (event) => {
    try {
      hyperdeckService.disconnect();
      event.reply('disconnect-hyperdeck-response', {
        success: true,
        message: 'Disconnected from HyperDeck'
      });
    } catch (error) {
      event.reply('disconnect-hyperdeck-response', {
        success: false,
        message: `Failed to disconnect: ${error.message}`
      });
    }
  });

  ipcMain.on('start-monitoring', (event, drives) => {
    try {
      hyperdeckService.startMonitoring(drives);
      event.reply('start-monitoring-response', {
        success: true,
        message: 'Monitoring started'
      });
    } catch (error) {
      event.reply('start-monitoring-response', {
        success: false,
        message: `Failed to start monitoring: ${error.message}`
      });
    }
  });

  ipcMain.on('stop-monitoring', (event) => {
    try {
      hyperdeckService.stopMonitoring();
      event.reply('stop-monitoring-response', {
        success: true,
        message: 'Monitoring stopped'
      });
    } catch (error) {
      event.reply('stop-monitoring-response', {
        success: false,
        message: `Failed to stop monitoring: ${error.message}`
      });
    }
  });

  ipcMain.on('get-clip-list', async (event) => {
    try {
      const clips = await hyperdeckService.getClipList();
      event.reply('get-clip-list-response', {
        success: true,
        clips
      });
    } catch (error) {
      event.reply('get-clip-list-response', {
        success: false,
        message: `Failed to get clip list: ${error.message}`
      });
    }
  });

  // Log any renderer crashes
  mainWindow.webContents.on('crashed', (event) => {
    console.error('Renderer process crashed:', event);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    hyperdeckService.disconnect();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});