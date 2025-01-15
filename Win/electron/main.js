//electron/main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const hyperdeckService = require('../server/services/hyperdeckService');
const net = require('net');
const createMenu = require('./menu');
const log = require('electron-log');
const isDev = process.env.NODE_ENV === 'development';

// Configure logging (only once)
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
log.transports.file.resolvePathFn = () => {
  const logPath = path.join(app.getPath('userData'), 'logs');
  require('fs').mkdirSync(logPath, { recursive: true });
  return path.join(logPath, 'main.log');
};

app.name = 'Hyperporter';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// Server setup
const serverPath = isDev 
  ? path.join(__dirname, '..', 'server', 'index.js')
  : path.join(process.resourcesPath, 'app', 'server', 'index.js');

let serverProcess = null;

function startServer() {
  try {
    log.info('Starting server process from:', serverPath);
    serverProcess = require('child_process').fork(serverPath, [], {
      env: { ...process.env, PORT: 3001 },
      stdio: 'pipe'  // Capture output
    });

    serverProcess.stdout?.on('data', (data) => {
      log.info('Server stdout:', data.toString());
    });

    serverProcess.stderr?.on('data', (data) => {
      log.error('Server stderr:', data.toString());
    });

    serverProcess.on('error', (error) => {
      log.error('Server process error:', error);
    });

    serverProcess.on('exit', (code, signal) => {
      log.info(`Server process exited with code ${code} and signal ${signal}`);
      // Restart server if it crashes
      if (code !== 0 && !app.isQuitting) {
        log.info('Restarting server process...');
        setTimeout(startServer, 1000);
      }
    });
  } catch (error) {
    log.error('Failed to start server:', error);
  }
}

// Test HyperDeck connection
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

// Window management
let mainWindow = null;

function createWindow() {
  log.info('Creating main window');

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.hyperporter.app');
  }

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    title: "Hyperporter",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      devTools: true
    },
  });

  // Set window title
  mainWindow.setTitle('Hyperporter');

  // Wait for server to be ready
  const waitForServer = () => {
    return new Promise((resolve) => {
      const testConnection = () => {
        const socket = new require('net').Socket();
        socket.connect(3001, '127.0.0.1', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', () => {
          setTimeout(testConnection, 1000);
        });
      };
      testConnection();
    });
  };

  // Start server and wait for it before loading window
  startServer();
  waitForServer().then(() => {
    const startURL = isDev 
      ? 'http://localhost:3000' 
      : `file://${path.join(__dirname, '..', 'client', 'build', 'index.html')}`;

    log.info('Loading URL:', startURL);
    mainWindow.loadURL(startURL).catch(err => {
      log.error('Error loading URL:', err);
    });
  });

  // Create application menu with DevTools
  const template = [
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle DevTools',
          accelerator: process.platform === 'darwin' ? 'Command+Option+I' : 'Control+Shift+I',
          click: () => {
            mainWindow.webContents.openDevTools();
          }
        }
      ]
    }
  ];

  const menu = require('electron').Menu.buildFromTemplate(template);
  require('electron').Menu.setApplicationMenu(menu);

  // Add keyboard shortcut for DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.openDevTools();
    }
  });

  // Force open DevTools
  mainWindow.webContents.openDevTools();

  // Window event listeners
  mainWindow.webContents.on('did-start-loading', () => {
    log.info('Started loading content');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('Finished loading content');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error('Failed to load:', { errorCode, errorDescription });
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log.info('Console:', { level, message, line, sourceId });
  });

  mainWindow.webContents.on('crashed', (event) => {
    console.error('Renderer process crashed:', event);
  });

  // Load the app
  const startURL = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '..', 'client', 'build', 'index.html')}`;

  log.info('Loading URL:', startURL);
  log.info('Current directory:', __dirname);
  log.info('Build path:', path.join(__dirname, '..', 'client', 'build', 'index.html'));

  mainWindow.loadURL(startURL).catch(err => {
    log.error('Error loading URL:', err);
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    log.info('Window ready to show');
    mainWindow.show();
    mainWindow.focus();
  });

  // Prevent new windows from opening
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Setup IPC handlers
  setupIPCHandlers();
}

// IPC Handlers
function setupIPCHandlers() {
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Destination Folder'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('menu-select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Destination Folder'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.on('path-join', (event, args) => {
    event.reply('path-join-response', path.join(...args));
  });

  ipcMain.on('connect-to-hyperdeck', async (event, ipAddress) => {
    console.log('Attempting to connect to HyperDeck at:', ipAddress);
    try {
      await testHyperdeckConnection(ipAddress);
      await hyperdeckService.connect(ipAddress);
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

  // Rest of your IPC handlers...
  // [Keep all your existing IPC handlers here]
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

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

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

// Error handlers
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  log.error('Unhandled rejection:', error);
});