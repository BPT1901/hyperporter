// server/index.js
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');
const net = require('net');
const FileWatcher = require('./services/fileWatcher');
const hyperdeckService = require('./services/hyperdeckService');
const path = require('path');
const fs = require('fs-extra');

// Express app setup
const app = express();
const PORT = 3001;

// Track connected HyperDecks and their IPs
const connectedDevices = new Map();
const activeWatchers = new Map();

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

// Server setup
const server = http.createServer(app);

// WebSocket setup
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'
});

// WebSocket error handling
wss.on('error', (error) => {
  console.error('WebSocket Server Error:', error);
});

wss.on('connection', (ws, req) => {
  console.log('New client connected from:', req.socket.remoteAddress);
  
  // Setup connection health check
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('error', (error) => {
    console.error('WebSocket Client Error:', error);
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);

      switch (data.type) {
        case 'CONNECT_HYPERDECK':
          try {
            await hyperdeckService.connect(data.ipAddress);
            connectedDevices.set(ws, data.ipAddress); // Store the connection
        
            // After connecting, scan both slots
            await hyperdeckService.sendCommand('slot select: 1');
            let clips1 = await hyperdeckService.getClipList();
            await hyperdeckService.sendCommand('slot select: 2');
            let clips2 = await hyperdeckService.getClipList();
            
            // Combine clips from both slots
            const allClips = [
              ...clips1.map(clip => ({ ...clip, slot: 1 })),
              ...clips2.map(clip => ({ ...clip, slot: 2 }))
            ];
            
            ws.send(JSON.stringify({
              type: 'CLIP_LIST',
              clips: allClips
            }));
            
            ws.send(JSON.stringify({ 
              type: 'CONNECTED',
              message: 'Successfully connected to HyperDeck'
            }));
          } catch (error) {
            console.error('Error connecting to HyperDeck:', error);
            ws.send(JSON.stringify({ 
              type: 'ERROR', 
              message: 'Failed to connect to HyperDeck: ' + error.message 
            }));
          }
          break;

          case 'GET_FILE_LIST':
        try {
          // Scan both slots again for updated list
          await hyperdeckService.sendCommand('slot select: 1');
          let clips1 = await hyperdeckService.getClipList();
          await hyperdeckService.sendCommand('slot select: 2');
          let clips2 = await hyperdeckService.getClipList();
          
          const allClips = [
            ...clips1.map(clip => ({ ...clip, slot: 1 })),
            ...clips2.map(clip => ({ ...clip, slot: 2 }))
          ];
          
          ws.send(JSON.stringify({
            type: 'CLIP_LIST',
            clips: allClips
          }));
        } catch (error) {
          console.error('Error getting clip list:', error);
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: 'Failed to get clip list'
          }));
        }
        break;

        case 'START_MONITORING':
          try {
            const hyperdeckIp = connectedDevices.get(ws);
            const fileWatcher = new FileWatcher({
              drives: data.drives,
              destinationPath: data.destinationPath,
              hyperdeckIp: hyperdeckIp
            });

            fileWatcher.on('newFile', async (filePath) => {
              try {
                console.log(`New file detected: ${filePath}`);
                ws.send(JSON.stringify({
                  type: 'FILE_DETECTED',
                  filePath
                }));

                await fileWatcher.transferFile(filePath);
                
                ws.send(JSON.stringify({
                  type: 'TRANSFER_COMPLETE',
                  filePath,
                  destinationPath: data.destinationPath
                }));
              } catch (error) {
                ws.send(JSON.stringify({
                  type: 'ERROR',
                  message: `Transfer failed: ${error.message}`
                }));
              }
            });

            activeWatchers.set(ws, fileWatcher);
            fileWatcher.startMonitoring();
            
            // Send correct monitoring started message
            ws.send(JSON.stringify({
              type: 'MONITORING_STARTED',
              message: 'Monitoring has begun'
            }));
          } catch (error) {
            console.error('Error starting monitoring:', error);
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: error.message
            }));
          }
          break;

          case 'STOP_MONITORING':
            try {
              const fileWatcher = activeWatchers.get(ws);
              if (fileWatcher) {
                // First message about initiating transfer
                ws.send(JSON.stringify({
                  type: 'TRANSFER_STATUS',
                  message: 'Initiating final transfer check...'
                }));
                
                try {
                  // Get the last transferred file information before stopping
                  const lastFile = await fileWatcher.getNewFiles();
                  const lastFilePath = lastFile && lastFile.length > 0 
                    ? `${fileWatcher.destinationPath}/${lastFile[0].name}`
                    : null;

                  await fileWatcher.stop();
                  
                  // Send the monitoring stopped message with the file information
                  ws.send(JSON.stringify({
                    type: 'MONITORING_STOPPED',
                    message: 'Monitoring stopped and final files transferred',
                    lastTransferredFile: lastFilePath,
                    fileName: lastFile && lastFile.length > 0 ? lastFile[0].name : null
                  }));
                } catch (error) {
                  ws.send(JSON.stringify({
                    type: 'ERROR',
                    message: `Final transfer failed: ${error.message}`
                  }));
                }
                
                activeWatchers.delete(ws);
              }
            } catch (error) {
              console.error('Error stopping monitoring:', error);
              ws.send(JSON.stringify({
                type: 'ERROR',
                message: `Failed to stop monitoring: ${error.message}`
              }));
            }
            break;

            case 'SAVE_RECORDING':
              try {
                const fileWatcher = new FileWatcher({
                  drives: { [data.file.slot === 1 ? 'ssd1' : 'ssd2']: true },
                  destinationPath: data.destinationPath,
                  hyperdeckIp: connectedDevices.get(ws)
                });

                await fileWatcher.transferViaFTP({
                  name: data.file.name,
                  path: `ssd${data.file.slot}/${data.file.name}`,
                  drive: `ssd${data.file.slot}`
                });

                // If a new filename was provided, rename the file
                if (data.newFileName && data.newFileName !== data.file.name) {
                  const oldPath = path.join(data.destinationPath, data.file.name);
                  const newPath = path.join(data.destinationPath, data.newFileName);
                  await fs.rename(oldPath, newPath);
                }

                ws.send(JSON.stringify({
                  type: 'RECORDING_SAVED',
                  message: 'Recording saved successfully'
                }));
              } catch (error) {
                console.error('Error saving recording:', error);
                ws.send(JSON.stringify({
                  type: 'ERROR',
                  message: `Failed to save recording: ${error.message}`
                }));
              }
              break;

            case 'RENAME_FILE':
              try {
                const oldPath = data.oldPath;
                const newName = data.newName;
                const dirPath = path.dirname(oldPath);
                
                // Make sure the new name has the same extension as the old file
                const oldExtension = path.extname(oldPath);
                const newFileName = newName.endsWith(oldExtension) ? newName : `${newName}${oldExtension}`;
                const newPath = path.join(dirPath, newFileName);
            
                console.log('Renaming file:', {
                  oldPath,
                  newPath,
                  newFileName
                });
            
                await fs.rename(oldPath, newPath);
                
                ws.send(JSON.stringify({
                  type: 'FILE_RENAMED',
                  message: 'File renamed successfully',
                  oldName: path.basename(oldPath),
                  newName: newFileName
                }));
              } catch (error) {
                console.error('Error renaming file:', error);
                ws.send(JSON.stringify({
                  type: 'ERROR',
                  message: `Failed to rename file: ${error.message}`
                }));
              }
              break;

        default:
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: 'Unknown message type'
          }));
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    connectedDevices.delete(ws);
    const fileWatcher = activeWatchers.get(ws);
    if (fileWatcher) {
      fileWatcher.stop();
      activeWatchers.delete(ws);
    }
  });
});

// Implement connection health check
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Server shutting down...');
  
  wss.clients.forEach((ws) => {
    const fileWatcher = activeWatchers.get(ws);
    if (fileWatcher) {
      fileWatcher.stop();
      activeWatchers.delete(ws);
    }
    connectedDevices.delete(ws);
  });

  clearInterval(interval);
  
  wss.close(() => {
    server.close(() => {
      console.log('Server shutdown complete');
      process.exit(0);
    });
  });
});

module.exports = server;