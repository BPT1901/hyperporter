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
const ftp = require('basic-ftp');

// Express app setup
const app = express();
const PORT = 3001;

// Track connected HyperDecks and their IPs
const connectedDevices = new Map();
const activeWatchers = new Map();

async function verifyClipExistence(ipAddress, slot, clipName) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: ipAddress,
      user: "anonymous",
      password: "anonymous",
      secure: false
    });
    
    try {
      // Try to change to the slot directory
      await client.cd(`ssd${slot}`);
      const files = await client.list();
      
      // Check if the clip exists in this slot
      const exists = files.some(file => file.name === clipName);
      console.log(`Verified clip ${clipName} in slot ${slot}: ${exists}`);
      return exists;
    } catch (error) {
      console.log(`No files in ssd${slot} or directory not accessible`);
      return false;
    }
  } catch (error) {
    console.log('FTP verification error:', error);
    return false;
  } finally {
    client.close();
  }
}

// Checking if slots are mounted
async function getSlotClips(slot) {
  try {
    // Get clips for the specific slot using the proper command
    const clips = await hyperdeckService.getClipList(slot);
    console.log(`Got clips for slot ${slot}:`, clips);
    return clips;
  } catch (error) {
    console.log(`Error getting clips from Slot ${slot}:`, error);
    return [];
  }
}



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
            connectedDevices.set(ws, data.ipAddress);

            // Get clips from both slots with IP address
            const slot1Clips = await getSlotClips(1, data.ipAddress);
            const slot2Clips = await getSlotClips(2, data.ipAddress);
            
            // Combine clips from both slots
            const allClips = [...slot1Clips, ...slot2Clips];
            console.log('All verified clips:', allClips);
            
            ws.send(JSON.stringify({
              type: 'CLIP_LIST',
              clips: allClips
            }));
            
            ws.send(JSON.stringify({ 
              type: 'CONNECT_HYPERDECK_RESPONSE',
              success: true,
              message: 'Successfully connected to HyperDeck',
              ipAddress: data.ipAddress
            }));
          } catch (error) {
            console.error('Error connecting to HyperDeck:', error);
            ws.send(JSON.stringify({ 
              type: 'CONNECT_HYPERDECK_RESPONSE',
              success: false,
              message: 'Failed to connect to HyperDeck: ' + error.message 
            }));
          }
          break;

          case 'GET_FILE_LIST':
            try {
                console.log('Scanning slots for clips...');
                // Get clips from slot 1
                const clips1 = await hyperdeckService.getClipList(1);
                console.log('Slot 1 clips:', clips1);
                
                // Get clips from slot 2
                const clips2 = await hyperdeckService.getClipList(2);
                console.log('Slot 2 clips:', clips2);

                // Combine clips from both slots
                const allClips = [...clips1, ...clips2];
                console.log('Sending combined clip list:', allClips);
                
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
          console.log('Starting monitoring with config:', {
            drives: data.drives,
            destinationPath: data.destinationPath
          });

          const hyperdeckIp = connectedDevices.get(ws);
          if (!hyperdeckIp) {
            throw new Error('No HyperDeck connection found');
          }

          const fileWatcher = new FileWatcher({
            drives: data.drives,
            destinationPath: data.destinationPath,
            hyperdeckIp: hyperdeckIp
          });

          fileWatcher.on('error', (error) => {
            console.error('FileWatcher error:', error);
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: error.message
            }));
          });

          await fileWatcher.startMonitoring();
          
          activeWatchers.set(ws, fileWatcher);
          
          ws.send(JSON.stringify({
            type: 'MONITORING_STARTED',
            message: 'Monitoring has begun'
          }));
        } catch (error) {
          console.error('Error starting monitoring:', error);
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: `Failed to start monitoring: ${error.message}`
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
                      const lastFile = await fileWatcher.getLastTransferredFile();
                      
                      await fileWatcher.stop();
                      
                      // Send the monitoring stopped message
                      ws.send(JSON.stringify({
                          type: 'MONITORING_STOPPED',
                          message: 'Monitoring stopped successfully',
                          lastTransferredFile: lastFile ? lastFile.path : null,
                          fileName: lastFile ? lastFile.name : null
                      }));
                      
                      console.log('Monitoring stopped successfully');
                  } catch (error) {
                      console.error('Error during stop monitoring:', error);
                      ws.send(JSON.stringify({
                          type: 'MONITORING_STOPPED',
                          message: 'Monitoring stopped with errors',
                          error: error.message
                      }));
                  }
                  
                  activeWatchers.delete(ws);
              } else {
                  ws.send(JSON.stringify({
                      type: 'MONITORING_STOPPED',
                      message: 'No active monitoring session found'
                  }));
              }
          } catch (error) {
              console.error('Error stopping monitoring:', error);
              ws.send(JSON.stringify({
                  type: 'ERROR',
                  message: `Failed to stop monitoring: ${error.message}`
              }));
          }
          break;

          // case 'TEST_RTSP':
          //   try {
          //       console.log('Testing RTSP commands...');
          //       await hyperdeckService.startRtspStream(1);
          //       const status = await hyperdeckService.getStreamStatus();
          //       console.log('Stream status after start:', status);
                
          //       ws.send(JSON.stringify({
          //           type: 'RTSP_TEST_STATUS',
          //           message: 'RTSP stream started',
          //           status: status
          //       }));

          //       // Wait 5 seconds then stop
          //       setTimeout(async () => {
          //           await hyperdeckService.stopRtspStream();
          //           const finalStatus = await hyperdeckService.getStreamStatus();
          //           console.log('Stream status after stop:', finalStatus);
                    
          //           ws.send(JSON.stringify({
          //               type: 'RTSP_TEST_STATUS',
          //               message: 'RTSP stream stopped',
          //               status: finalStatus
          //           }));
          //       }, 5000);
          //   } catch (error) {
          //       console.error('RTSP test failed:', error);
          //       ws.send(JSON.stringify({
          //           type: 'ERROR',
          //           message: `RTSP test failed: ${error.message}`
          //       }));
          //   }
          // break;

          case 'SAVE_RECORDING':
          try {
            const fileWatcher = new FileWatcher({
              drives: { [data.file.slot === 1 ? 'ssd1' : 'ssd2']: true },
              destinationPath: data.destinationPath,
              hyperdeckIp: connectedDevices.get(ws)
            });

            // Initial progress notification
            ws.send(JSON.stringify({
              type: 'TRANSFER_PROGRESS',
              progress: 0
            }));

            // Set up event listeners for progress
            fileWatcher.on('transferProgress', (progressData) => {
              if (progressData.type === 'TRANSFER_PROGRESS') {
                ws.send(JSON.stringify({
                  type: 'TRANSFER_PROGRESS',
                  progress: progressData.progress
                }));
              } else if (progressData.type === 'TRANSFER_COMPLETE') {
                ws.send(JSON.stringify({
                  type: 'TRANSFER_PROGRESS',
                  progress: 100
                }));
              }
            });

            // Ensure directory exists
            await fs.ensureDir(data.destinationPath);

            // Copy the file
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
                  const newPath = path.join(dirPath, newName);
              
                  console.log('Renaming file:', {
                    oldPath,
                    newPath,
                    newName
                  });
              
                  await fs.rename(oldPath, newPath);
                  
                  ws.send(JSON.stringify({
                    type: 'FILE_RENAMED',
                    message: 'File renamed successfully',
                    oldName: path.basename(oldPath),
                    newName: newName
                  }));
                } catch (error) {
                  console.error('Error renaming file:', error);
                  ws.send(JSON.stringify({
                    type: 'ERROR',
                    message: `Failed to rename file: ${error.message}`
                  }));
                }
                break;

                case 'RENAME_MONITORED_FILE':
                  try {
                    console.log('Renaming monitored file:', {
                      oldPath: data.oldPath,
                      newName: data.newName
                    });

                    const dirPath = path.dirname(data.oldPath);
                    const newPath = path.join(dirPath, data.newName);

                    await fs.rename(data.oldPath, newPath);
                    
                    ws.send(JSON.stringify({
                      type: 'FILE_RENAMED',
                      message: 'File renamed successfully',
                      oldName: path.basename(data.oldPath),
                      newName: data.newName
                    }));
                  } catch (error) {
                    console.error('Error renaming monitored file:', error);
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