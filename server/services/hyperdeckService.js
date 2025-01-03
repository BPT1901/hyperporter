// server/services/hyperdeckService.js
const net = require('net');
const EventEmitter = require('events');

class HyperdeckService extends EventEmitter {
  // === Constructor ===
  constructor() {
    super();
    this.client = null;
    this.connected = false;
    this.ipAddress = null;
    this.monitoring = false;
    this.monitoringInterval = null;
    this.buffer = '';
    this.currentCommand = null;
    this.clipList = [];
    this.currentSlot = null;
  }

  // === Connection Management ===
  connect(ipAddress) {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        this.disconnect();
      }
  
      console.log(`Attempting to connect to HyperDeck at ${ipAddress}`);
      this.ipAddress = ipAddress;
      this.client = new net.Socket();
  
      // Add connection timeout
      const connectionTimeout = setTimeout(() => {
        console.log(`Connection attempt to ${ipAddress} timed out`);
        this.client.destroy();
        reject(new Error(`Connection timed out for ${ipAddress}`));
      }, 10000); // 10 second timeout
  
      this.client.connect(9993, ipAddress, () => {
        console.log('Connected to Hyperdeck at:', ipAddress);
        clearTimeout(connectionTimeout);  // Clear timeout on successful connection
        this.connected = true;
        
        // Set up data handling
        this.client.on('data', (data) => {
          this.buffer += data.toString();
          this.processBuffer();
        });
  
        resolve(true);
      });
  
      this.client.on('error', (error) => {
        console.error('Hyperdeck connection error:', error);
        clearTimeout(connectionTimeout);  // Clear timeout on error
        this.connected = false;
        reject(error);
      });
  
      this.client.on('close', () => {
        console.log('Hyperdeck connection closed');
        this.connected = false;
      });
    });
  }

  disconnect() {
    this.stopMonitoring();
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.connected = false;
    this.currentCommand = null;
    this.currentSlot = null;
    this.buffer = '';
    this.clipList = [];
  }

  // === Command and Response Handling ===
  async sendCommand(command) {
    if (!this.connected) {
      throw new Error('Not connected to Hyperdeck');
    }

    return new Promise((resolve, reject) => {
      this.currentCommand = command;
      console.log('Sending command:', command);
      
      // Track slot selection
      const slotMatch = command.match(/slot select: (\d+)/);
      if (slotMatch) {
        this.currentSlot = parseInt(slotMatch[1]);
        console.log('Set current slot to:', this.currentSlot);
      }
      
      this.client.write(command + '\r\n', (error) => {
        if (error) {
          this.currentCommand = null;
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  processBuffer() {
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop(); // Keep incomplete line

    lines.forEach(line => {
      if (line) {
        console.log('Received line:', line); // Debug logging
        this.emit('response', line);
        
        if (this.currentCommand === 'clips get') {
          this.processClipResponse(line);
        } else {
          this.parseResponse(line);
        }
      }
    });
  }

  parseResponse(response) {
    // Handle error responses
    if (response.startsWith('100 syntax error')) {
      console.log('Received syntax error from HyperDeck');
      return;
    }

    // Parse slot info
    if (response.includes('slot id:')) {
      const slotMatch = response.match(/slot id: (\d+)/);
      const statusMatch = response.match(/status: (\w+)/);
      const recordingMatch = response.match(/recording time: (\d+:\d+:\d+:\d+)/);
      
      if (slotMatch && statusMatch) {
        const status = {
          slot: slotMatch[1],
          status: statusMatch[1],
          recordingTime: recordingMatch ? recordingMatch[1] : null,
          mounted: statusMatch[1] === 'mounted'
        };
        
        console.log(`Slot ${status.slot} status:`, status);
        this.emit('slotStatus', status);
      }
    }
  }

  // === Clip Management ===
  processClipResponse(line) {
    console.log('Processing clip response:', line);

    if (line.startsWith('205 clips info:')) {
      console.log('Starting new clip list');
      this.clipList = [];
      this.clipCount = null;
    }
    else if (line.startsWith('clip count:')) {
      this.clipCount = parseInt(line.split(': ')[1], 10);
      console.log('Got clip count:', this.clipCount);
      if (this.clipCount === 0) {
        console.log('No clips found, emitting empty list');
        this.emit('clipList', []);
        this.currentCommand = null;
      }
    }
    else {
      const clipMatch = line.match(/^(\d+): (.+\.mp4) (\d{2}:\d{2}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2}:\d{2})/);
      if (clipMatch) {
        const clip = {
          id: clipMatch[1],
          name: clipMatch[2],
          startTime: clipMatch[3],
          duration: clipMatch[4],
          slot: this.currentSlot  // Use tracked slot number
        };
        
        console.log(`Adding clip for slot ${this.currentSlot}:`, clip);
        this.clipList.push(clip);
        
        if (this.clipCount && this.clipList.length === this.clipCount) {
          console.log('Reached last clip, emitting list of', this.clipList.length, 'clips');
          this.emit('clipList', [...this.clipList]);
          this.clipList = [];
          this.clipCount = null;
          this.currentCommand = null;
        }
      } else if (line.match(/^[0-9]{3}/)) {
        console.log('Response code line:', line);
      }
    }
  }

  async getClipList(slot) {
    if (!this.connected) {
      throw new Error('Not connected to Hyperdeck');
    }
  
    console.log('Getting clip list...');
  
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('Clip list request timed out');
        console.log('Current clip list:', this.clipList);
        console.log('Current clip count:', this.clipCount);
        resolve([]);
      }, 15000);
  
      const handleClipList = (clips) => {
        console.log('Successfully received clip list:', clips);
        clearTimeout(timeout);
        this.removeListener('clipList', handleClipList);
        
        // Transform the clips to include the slot number
        const transformedClips = clips.map(clip => ({
          ...clip,
          slot: slot
        }));
        
        resolve(transformedClips);
      };
  
      this.on('clipList', handleClipList);
  
      // Use the proper disk list command with slot ID
      setTimeout(() => {
        this.sendCommand(`disk list: slot id: ${slot}`)
          .catch((error) => {
            console.error('Error sending clip list command:', error);
            clearTimeout(timeout);
            this.removeListener('clipList', handleClipList);
            resolve([]);
          });
      }, 1000);
    });
  }

  // === Status and Monitoring ===
  async checkSlotStatus(slot) {
    return new Promise((resolve) => {
      const handler = (response) => {
        if (response.includes(`slot id: ${slot}`)) {
          const statusMatch = response.match(/status: (\w+)/);
          const isMounted = statusMatch && statusMatch[1] === 'mounted';
          this.removeListener('response', handler);
          resolve(isMounted);
        }
      };

      this.on('response', handler);
      this.sendCommand(`slot info: ${slot}`);

      // Timeout after 3 seconds
      setTimeout(() => {
        this.removeListener('response', handler);
        resolve(false);
      }, 3000);
    });
  }

  startMonitoring(drives) {
    if (!this.connected) {
      throw new Error('Not connected to Hyperdeck');
    }

    this.monitoring = true;
    this.monitoringInterval = setInterval(async () => {
      try {
        if (drives.ssd1) {
          await this.sendCommand('slot info: 1');
        }
        if (drives.ssd2) {
          await this.sendCommand('slot info: 2');
        }
        await this.sendCommand('transport info');
      } catch (error) {
        console.error('Error during monitoring:', error);
        this.emit('error', error);
      }
    }, 1000);
  }

  stopMonitoring() {
    this.monitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}

module.exports = new HyperdeckService();