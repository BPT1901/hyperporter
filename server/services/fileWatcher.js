// server/services/fileWatcher.js
const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const EventEmitter = require('events');
const ftp = require('basic-ftp');
const hyperdeckService = require('./hyperdeckService');
const net = require('net');

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
    
    // Setup hyperdeck service event listeners
    hyperdeckService.on('slotStatus', (status) => {
      if (status.status === 'mounted') {
        console.log(`Drive ${status.slot} mounted`);
      }
    });
  }

  async testConnection(host, port) {
    if (!host) {
      throw new Error('Host IP address is required for connection test');
    }
    console.log(`Testing connection to ${host}:${port}`);
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', reject);
    });
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

      // Sort files by name in descending order (assuming sequential naming)
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
      
      // Navigate to the correct drive directory
      await client.cd(fileInfo.drive);
      
      // Get file size for progress calculation
      const fileList = await client.list();
      const targetFile = fileList.find(f => f.name === fileInfo.name);
      
      if (!targetFile) {
        throw new Error(`File ${fileInfo.name} not found`);
      }

      const totalSize = targetFile.size;
      let downloadedSize = 0;

      // Set up progress tracking
      client.trackProgress(info => {
        downloadedSize = info.bytes;
        const progress = Math.round((downloadedSize / totalSize) * 100);
        this.emit('transferProgress', {
          type: 'TRANSFER_PROGRESS',
          progress: progress,
          filename: fileInfo.name
        });
      });
      
      // Download the file
      await client.downloadTo(destinationPath, fileInfo.name);

      // Stop tracking progress
      client.trackProgress();

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

  async startMonitoring() {
    try {
      // Create destination directory if it doesn't exist
      try {
        await fs.ensureDir(this.destinationPath);
        console.log('Destination directory ensured:', this.destinationPath);
      } catch (dirError) {
        console.error('Error creating destination directory:', dirError);
        throw new Error(`Failed to create destination directory: ${dirError.message}`);
      }

      // Store initial file list
      const initialFiles = await this.getFTPFileList();
      this.lastKnownFiles.clear();
      initialFiles.forEach(file => {
        this.lastKnownFiles.set(file.name, file);
      });

      console.log('Initial files:', Array.from(this.lastKnownFiles.keys()));

      this.isMonitoring = true;

      // Setup watchers for each selected drive
      for (const [drive, enabled] of Object.entries(this.drives)) {
        if (enabled) {
          const drivePath = `/Volumes/${drive}`; // Mac specific path
          if (fs.existsSync(drivePath)) {
            const watcher = chokidar.watch(drivePath, {
              ignored: /(^|[\/\\])\../,
              persistent: true,
              awaitWriteFinish: true
            });

            watcher.on('add', async (filePath) => {
              this.emit('newFile', filePath);
            });

            this.watchers.set(drive, watcher);
            console.log(`Started watching ${drive} at ${drivePath}`);
          }
        }
      }
    } catch (error) {
      console.error('Error starting file watch:', error);
      throw error;
    }
  }

  async getNewFiles() {
    const currentFiles = await this.getFTPFileList();
    const newFiles = currentFiles.filter(file => {
      return !this.lastKnownFiles.has(file.name);
    });

    console.log('New files detected:', newFiles);
    return newFiles;
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

  async transferNewFiles() {
    try {
      const newFiles = await this.getNewFiles();
      
      if (newFiles.length === 0) {
        console.log('No new files found to transfer');
        return;
      }

      console.log(`Found ${newFiles.length} new files to transfer`);
      
      // Get the most recent file (should be first due to sorting)
      const latestFile = newFiles[0];
      console.log(`Attempting to transfer most recent file: ${latestFile.name}`);

      try {
        await this.transferViaFTP(latestFile);
        console.log(`Successfully transferred ${latestFile.name}`);
        
        this.emit('transferProgress', {
          type: 'FILE_TRANSFER',
          filename: latestFile.name,
          status: 'completed',
          drive: latestFile.drive
        });
      } catch (error) {
        console.error(`Error transferring ${latestFile.name}:`, error);
        this.emit('transferProgress', {
          type: 'ERROR',
          filename: latestFile.name,
          error: error.message,
          drive: latestFile.drive
        });
      }
    } catch (error) {
      console.error('Error during final transfer:', error);
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
    try {
      if (this.isMonitoring) {
        console.log('Initiating final file transfer check...');
        
        try {
          await this.testConnection(this.hyperdeckIp, 21);
          console.log('FTP connection test successful');
          
          await this.transferNewFiles();
          console.log('Final file transfer completed');
          
        } catch (error) {
          console.error('Final transfer failed:', error);
          throw new Error(`Final transfer failed: ${error.message}`);
        }

        // Stop file watching
        this.isMonitoring = false;
        for (const watcher of this.watchers.values()) {
          await watcher.close();
        }
        this.watchers.clear();
        this.lastKnownFiles.clear();
      }
    } catch (error) {
      console.error('Stop monitoring error:', error.stack);
      throw error;
    }
  }
}

module.exports = FileWatcher;