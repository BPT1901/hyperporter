// server/services/fileWatcher.js
const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const EventEmitter = require('events');
const ftp = require('basic-ftp');
const hyperdeckService = require('./hyperdeckService');
const net = require('net');
const rtspService = require('./rtspService');

class FileWatcher extends EventEmitter {
  constructor(options) {
    super();
    // Validate required options
    if (!options) {
      throw new Error('Configuration object is required');
    }
    if (!options.hyperdeckIp) {
      throw new Error('HyperDeck IP address is required');
    }
    if (!options.destinationPath) {
      throw new Error('Destination path is required');
    }
    if (!options.drives) {
      throw new Error('Drives configuration is required');
    }
  
    // Assign all properties
    this.drives = options.drives;
    this.destinationPath = options.destinationPath;
    this.hyperdeckIp = options.hyperdeckIp;
    this.rtspEnabled = options.rtspEnabled ?? true;
    this.defaultFileName = options.defaultFileName || `recording_${Date.now()}`;
    this.watchers = new Map();
    this.isMonitoring = false;
    this.lastKnownFiles = new Map();
    this.activeStreams = new Map();
    this.hyperdeckService = hyperdeckService;
    this.recordingStatus = new Map();
    this.lastTransferredFile = null;
  
    // Log configuration for debugging
    console.log('FileWatcher initialized with config:', {
      drives: this.drives,
      destinationPath: this.destinationPath,
      hyperdeckIp: this.hyperdeckIp,
      rtspEnabled: this.rtspEnabled,
      defaultFileName: this.defaultFileName
    });
  
    // Setup hyperdeck service event listeners
    hyperdeckService.on('slotStatus', (status) => {
      if (status.status === 'mounted') {
        console.log(`Drive ${status.slot} mounted`);
      }
    });
  }


    
  async startMonitoring() {
    try {
      if (!fs.existsSync(this.destinationPath)) {
        await fs.ensureDir(this.destinationPath);
      }
  
      console.log('Starting monitoring with destination:', this.destinationPath);
      this.isMonitoring = true;
  
      hyperdeckService.on('transportInfo', async (info) => {
        try {
          if (info.status === 'record') {
            // Recording has started
            console.log('Recording started on HyperDeck, slot:', info.slot);
            
            // Get the recording name from HyperDeck
            const currentClip = await hyperdeckService.getCurrentClip(info.slot);
            console.log('Current clip info:', currentClip);
            
            // Start RTSP stream using the actual recording name
            if (this.rtspEnabled) {
              const streamKey = await rtspService.startStream(
                this.hyperdeckIp,
                info.slot,
                this.destinationPath,
                currentClip.name // Use the actual recording name
              );
              
              console.log('Started RTSP stream:', streamKey);
              
              this.activeStreams.set(info.slot, {
                streamKey,
                filename: currentClip.name,
                filePath: path.join(this.destinationPath, currentClip.name),
                startTime: Date.now()
              });
  
              this.emit('recordingStarted', {
                filename: currentClip.name,
                slot: info.slot,
                filePath: path.join(this.destinationPath, currentClip.name)
              });
            }
          } else if (info.status === 'preview' || info.status === 'stopped') {
            const streamInfo = this.activeStreams.get(info.slot);
            if (streamInfo) {
              console.log('Recording stopped, stopping RTSP stream');
              
              // Wait for file to be completely written
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              try {
                // Stop RTSP stream
                if (this.rtspEnabled) {
                  await rtspService.stopStream(this.hyperdeckIp, info.slot);
                }
                
                // Verify file exists
                const filePath = path.join(this.destinationPath, streamInfo.filename);
                if (await fs.pathExists(filePath)) {
                  console.log('Recording file verified:', filePath);
                  this.lastTransferredFile = {
                    path: filePath,
                    name: streamInfo.filename,
                    slot: info.slot
                  };
                  
                  this.emit('recordingStopped', {
                    slot: info.slot,
                    filePath: filePath,
                    fileName: streamInfo.filename
                  });
                } else {
                  throw new Error(`Recording file not found: ${filePath}`);
                }
              } catch (error) {
                console.error('Error handling recording stop:', error);
                this.emit('error', error);
              } finally {
                this.activeStreams.delete(info.slot);
              }
            }
          }
        } catch (error) {
          console.error('Error in transport info handler:', error);
          this.emit('error', error);
        }
      });
  
      // Start transport info polling
      for (const [drive, enabled] of Object.entries(this.drives)) {
        if (enabled) {
          const slot = drive === 'ssd1' ? 1 : 2;
          await hyperdeckService.startTransportPolling(slot);
        }
      }
  
    } catch (error) {
      console.error('Error starting monitoring:', error);
      throw error;
    }
  }

    async verifyRecording(filePath) {
      try {
          const stats = await fs.stat(filePath);
          
          if (stats.size === 0) {
              return {
                  isValid: false,
                  details: 'Recording file is empty'
              };
          }

          return {
              isValid: true,
              details: {
                  size: stats.size,
                  created: stats.birthtime,
                  modified: stats.mtime
              }
          };
      } catch (error) {
          return {
              isValid: false,
              details: `Error verifying recording: ${error.message}`
          };
      }
    }

    async getNewFiles() {
      try {
          // Get current list of files from FTP
          const currentFiles = await this.getFTPFileList();
          
          // Compare with last known files
          const newFiles = currentFiles.filter(file => {
              return !this.lastKnownFiles.has(file.name);
          });
  
          console.log('New files detected:', newFiles);
          return newFiles;
      } catch (error) {
          console.error('Error getting new files:', error);
          return [];
      }
    }

    async handleRecordingStart(slot, data) {
      if (data.slot === slot) {
          try {
              const filename = `recording_slot${slot}_${Date.now()}.mp4`;
              console.log(`Starting recording on slot ${slot} to ${filename}`);
              
              const streamKey = await rtspService.startStream(
                  this.hyperdeckIp,
                  slot,
                  this.destinationPath,
                  filename
              );
              
              this.activeStreams.set(slot, {
                  streamKey,
                  filename,
                  startTime: Date.now()
              });
              
              this.emit('streamStarted', {
                  slot,
                  streamKey,
                  filename
              });
          } catch (error) {
              console.error(`Error starting recording on slot ${slot}:`, error);
              this.emit('error', {
                  type: 'RECORDING_START_ERROR',
                  slot,
                  message: error.message
              });
          }
      }
    }

    async handleRecordingStop(slot, data) {
      if (data.slot === slot) {
          try {
              const streamKey = this.activeStreams.get(slot);
              if (streamKey) {
                  console.log(`Stopping recording on slot ${slot}`);
                  
                  const result = await rtspService.stopStream(this.hyperdeckIp, slot);
                  const recordingInfo = await this.verifyRecording(result.outputPath);
                  
                  this.activeStreams.delete(slot);
                  
                  this.emit('streamStopped', {
                      slot,
                      streamKey,
                      isValid: recordingInfo.isValid,
                      details: recordingInfo.details
                  });
              }
          } catch (error) {
              console.error(`Error stopping recording on slot ${slot}:`, error);
              this.emit('error', {
                  type: 'RECORDING_STOP_ERROR',
                  slot,
                  message: error.message
              });
          }
      }
    }

      async transferViaFTP(fileInfo) {
        const client = new ftp.Client();
        client.ftp.verbose = true;
        try {
          await client.access({
            host: this.hyperdeckIp,
            user: "anonymous",
            password: "anonymous",
            secure: false
          });

          const destinationPath = path.join(this.destinationPath, fileInfo.name);
          console.log(`Attempting to download ${fileInfo.path} to ${destinationPath}`);
          
          await client.cd(fileInfo.drive);
          
          // Download the file
          await client.downloadTo(destinationPath, fileInfo.name);
          console.log(`Successfully downloaded ${fileInfo.name}`);
          
          this.emit('transferProgress', {
            type: 'TRANSFER_COMPLETE',
            filename: fileInfo.name,
            destinationPath
          });
          
          return destinationPath;
        } catch (error) {
          console.error(`Error in transferViaFTP for ${fileInfo.name}:`, error);
          this.emit('error', {
            type: 'TRANSFER_ERROR',
            message: error.message,
            filename: fileInfo.name
          });
          throw error;
        } finally {
          client.close();
        }
    }

    async getFTPFileList() {
        const client = new ftp.Client();
        client.ftp.verbose = true;
        try {
          await client.access({
            host: this.hyperdeckIp,
            user: "anonymous",
            password: "anonymous",
            secure: false
          });
          
          const allFiles = [];
          
          // Check which drives are enabled
          if (this.drives.ssd1) {
            try {
              await client.cd('ssd1');
              const ssd1Files = await client.list();
              for (const file of ssd1Files) {
                if (!file.name.startsWith('.') && file.name.endsWith('.mp4')) {
                  allFiles.push({
                    name: file.name,
                    path: `ssd1/${file.name}`,
                    drive: 'ssd1',
                    date: file.date || new Date(),
                    size: file.size
                  });
                }
              }
              await client.cd('..');
            } catch (error) {
              console.log('No files in ssd1 or directory not accessible');
            }
          }
          
          if (this.drives.ssd2) {
            try {
              await client.cd('ssd2');
              const ssd2Files = await client.list();
              for (const file of ssd2Files) {
                if (!file.name.startsWith('.') && file.name.endsWith('.mp4')) {
                  allFiles.push({
                    name: file.name,
                    path: `ssd2/${file.name}`,
                    drive: 'ssd2',
                    date: file.date || new Date(),
                    size: file.size
                  });
                }
              }
              await client.cd('..');
            } catch (error) {
              console.log('No files in ssd2 or directory not accessible');
            }
          }

          allFiles.sort((a, b) => b.name.localeCompare(a.name));
          console.log('Found files:', allFiles);
          return allFiles;
          
        } catch (error) {
          console.error('Error getting FTP file list:', error);
          throw error;
        } finally {
          client.close();
        }
    }

  async transferFile(filePath) {
    try {
      const filename = path.basename(filePath);
      const destinationFilePath = path.join(this.destinationPath, filename);
      
      await fs.copy(filePath, destinationFilePath);
      console.log(`File transferred: ${filename}`);
      
      // Emit an event with the destination path
      this.emit('transferProgress', {
        type: 'TRANSFER_STATUS',
        message: 'File transfer complete',
        destinationPath: destinationFilePath,
        filename: filename
      });
      
      return destinationFilePath;
    } catch (error) {
      console.error('Error transferring file:', error);
      throw error;
    }
  }


  async getLastTransferredFile() {
    try {
        const newFiles = await this.getNewFiles();
        if (newFiles && newFiles.length > 0) {
            const lastFile = newFiles[newFiles.length - 1];
            return {
                name: lastFile.name,
                path: path.join(this.destinationPath, lastFile.name)
            };
        }
        console.log('No new files found');
        return null;
    } catch (error) {
        console.error('Error getting last transferred file:', error);
        return null;
    }
  }

  async stop() {
    console.log('Stopping FileWatcher...');
    this.isMonitoring = false;
    
    // Stop transport polling for all active slots
    for (const [drive, enabled] of Object.entries(this.drives)) {
        if (enabled) {
            const slot = drive === 'ssd1' ? 1 : 2;
            hyperdeckService.stopTransportPolling(slot);
            console.log(`Stopped polling for slot ${slot}`);
        }
    }

    // Stop all active streams
    for (const [slot, streamInfo] of this.activeStreams.entries()) {
        try {
            console.log(`Stopping stream for slot ${slot}`);
            await rtspService.stopStream(this.hyperdeckIp, slot);
            console.log(`Stopped stream for slot ${slot}`);
        } catch (error) {
            console.error(`Error stopping stream for slot ${slot}:`, error);
        }
    }

    this.activeStreams.clear();
    console.log('FileWatcher stopped');

    // Emit stopped event
    this.emit('monitoringStopped', {
        message: 'Monitoring stopped successfully'
    });
  }
}

module.exports = FileWatcher;