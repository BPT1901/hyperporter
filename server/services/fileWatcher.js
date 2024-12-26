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

            // Initialize RTSP streaming for selected drives
            for (const [drive, enabled] of Object.entries(this.drives)) {
                if (enabled) {
                    const slot = drive === 'ssd1' ? 1 : 2;
                    await this.hyperdeckService.startRtspStream(slot);
                    
                    // Use function binding to maintain correct 'this' context
                    this.handleRecordingStart = this.handleRecordingStart.bind(this, slot);
                    this.handleRecordingStop = this.handleRecordingStop.bind(this, slot);
                    
                    this.hyperdeckService.on('recordingStarted', this.handleRecordingStart);
                    this.hyperdeckService.on('recordingStopped', this.handleRecordingStop);
                }
            }

            this.isMonitoring = true;
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