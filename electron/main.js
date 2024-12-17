const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const hyperdeckService = require('../server/services/hyperdeckService');
const net = require('net');

// Single isDev declaration
const isDev = process.env.NODE_ENV === 'development';

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

function createWindow() {
  console.log('Creating window...');
  console.log('Development mode:', isDev);
  
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('Preload script path:', preloadPath);

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: preloadPath
    },
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

  console.log('Starting application...');
  
  const startURL = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '../client/build/index.html')}`;
  
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