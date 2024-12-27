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
    if (!options.hyperdeckIp) {
      throw new Error('HyperDeck IP address is required');
    }
    this.drives = options.drives;
    this.destinationPath = options.destinationPath;
    this.hyperdeckIp = options.hyperdeckIp;
    this.watchers = new Map();
    this.isMonitoring = false;
    this.lastKnownFiles = new Map(); // Track files when monitoring starts
    this.activeStreams = new Map();
    this.hyperdeckService = hyperdeckService;
    
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
          throw new Error('Destination path does not exist');
        }

        // Store initial file list
        const initialFiles = await this.getFTPFileList();
        this.lastKnownFiles.clear();
        initialFiles.forEach(file => {
          this.lastKnownFiles.set(file.name, file);
        });

        console.log('Initial files:', Array.from(this.lastKnownFiles.keys()));

        this.isMonitoring = true;

        // Listen for recording status changes
        hyperdeckService.on('transportInfo', async (info) => {
          if (info.status === 'record') {
            // Recording has started
            console.log('Recording started on HyperDeck');
            const filename = `recording_${Date.now()}.mp4`;
            const streamKey = await rtspService.startStream(
              this.hyperdeckIp,
              info.slotId,
              this.destinationPath,
              filename
            );
            
            this.emit('recordingStarted', {
              filename,
              slot: info.slotId,
              streamKey
            });
          } else if (info.status === 'preview' || info.status === 'stopped') {
            // Recording has stopped
            console.log('Recording stopped on HyperDeck');
            await rtspService.stopStream(this.hyperdeckIp, info.slotId);
            this.emit('recordingStopped', {
              slot: info.slotId
            });
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

    async getNewFiles() {
      const newFiles = currentFiles.filter(file => {
        return !this.lastKnownFiles.has(file.name);
      });

      console.log('New files detected:', newFiles);
      return newFiles;
    }

    async handleRecordingStart(slot, data) {
      if (data.slot === slot) {
          const filename = `recording_slot${slot}_${Date.now()}.mp4`;
          const streamKey = await rtspService.startStream(
              this.hyperdeckIp,
              slot,
              this.destinationPath,
              filename
          );
          
          this.activeStreams.set(slot, streamKey);
          this.emit('streamStarted', {
              slot,
              streamKey,
              filename
          });
      }
  }

  async handleRecordingStop(slot, data) {
      if (data.slot === slot) {
          const streamKey = this.activeStreams.get(slot);
          if (streamKey) {
              await rtspService.stopStream(this.hyperdeckIp, slot);
              this.activeStreams.delete(slot);
              this.emit('streamStopped', {
                  slot,
                  streamKey
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
      const files = await this.getNewFiles();
      if (files && files.length > 0) {
        const lastFile = files[files.length - 1];
        return {
          name: lastFile.name,
          path: path.join(this.destinationPath, lastFile.name)
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting last transferred file:', error);
      return null;
    }
  }

  async stop() {
    this.isMonitoring = false;
    
    // Stop all active streams
    for (const [slot, streamKey] of this.activeStreams) {
      await rtspService.stopStream(this.hyperdeckIp, slot);
    }
    this.activeStreams.clear();
  }
}

module.exports = FileWatcher;