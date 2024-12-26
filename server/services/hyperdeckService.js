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

    // RTSP Services

      async startRtspStream(slot) {
        try {
            console.log(`Starting stream for slot ${slot}`);
            
            // Select the slot
            await this.sendCommand(`slot select: ${slot}`);
            
            // Get the current transport status
            const transportInfo = await this.sendCommand('transport info');
            console.log('Transport info:', transportInfo);
    
            // Start recording
            await this.sendCommand('record');
            
            return true;
        } catch (error) {
            console.error('Failed to start stream:', error);
            throw error;
        }
    }
    
    async stopRtspStream() {
        try {
            console.log('Stopping recording');
            await this.sendCommand('stop');
            return true;
        } catch (error) {
            console.error('Failed to stop recording:', error);
            throw error;
        }
    }
    
    async getStreamStatus() {
        try {
            const response = await this.sendCommand('transport info');
            console.log('Transport status:', response);
            return response;
        } catch (error) {
            console.error('Failed to get status:', error);
            throw error;
        }
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

    // Handle disk list header
    if (line.startsWith('206 disk list:')) {
        console.log('Starting new disk list');
        this.clipList = [];
        return;
    }

    // Handle slot ID line
    if (line.startsWith('slot id:')) {
        this.currentSlot = parseInt(line.split(': ')[1], 10);
        console.log('Processing slot:', this.currentSlot);
        return;
    }

    // Handle clip entries - updated regex to match actual HyperDeck format
    // Example: "1: MAC BANK SUPER 5TH DEC_0001.mp4 H.264 1080p60 00:00:04:13"
    const clipMatch = line.match(/^(\d+): (.+\.mp4) H\.264 .+ (\d{2}:\d{2}:\d{2}:\d{2})/);
    if (clipMatch) {
        const clip = {
            id: clipMatch[1],
            name: clipMatch[2],
            duration: clipMatch[3],
            slot: this.currentSlot
        };

        console.log(`Adding clip for slot ${this.currentSlot}:`, clip);
        this.clipList.push(clip);
    }

    // When we get a new command response, emit the current list
    if (line.startsWith('200') || line.startsWith('500')) {
        if (this.clipList.length > 0) {
            console.log('Command complete, emitting list of', this.clipList.length, 'clips');
            this.emit('clipList', [...this.clipList]);
            this.clipList = [];
        }
        this.currentCommand = null;
    }
  }

  async getClipList(slot) {
    if (!this.connected) {
      throw new Error('Not connected to Hyperdeck');
    }

    console.log('Getting clip list...');

    return new Promise((resolve, reject) => {
        const clips = [];
        let currentSlotId = null;

        const handleResponse = (response) => {
            console.log('Processing response:', response);

            // Handle the clip list entries
            const clipMatch = response.match(/^(\d+): (.+) H\.264 .+ (\d{2}:\d{2}:\d{2}:\d{2})/);
            if (clipMatch) {
                console.log('Found clip:', clipMatch);
                clips.push({
                    id: clipMatch[1],
                    name: clipMatch[2],
                    duration: clipMatch[3],
                    slot: slot
                });
            }

            // Check if this is the end of the list (next command response)
            if (response.startsWith('200') || response.startsWith('500')) {
                console.log('End of clip list detected');
                this.removeListener('response', handleResponse);
                resolve(clips);
            }
        };

        this.on('response', handleResponse);

        // Send the command to get the clip list
        this.sendCommand(`disk list: slot id: ${slot}`)
            .catch(error => {
                console.error('Error sending clip list command:', error);
                this.removeListener('response', handleResponse);
                resolve([]);
            });

        // Set a reasonable timeout
        setTimeout(() => {
            console.log('Resolving clip list:', clips);
            this.removeListener('response', handleResponse);
            resolve(clips);
        }, 5000);
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
          const transport = await this.sendCommand('transport info');
          if (transport.includes('status: record')) {
            this.emit('recordingStarted', { slot: 1 });
          }
        }
        if (drives.ssd2) {
          await this.sendCommand('slot info: 2');
          const transport = await this.sendCommand('transport info');
          if (transport.includes('status: record')) {
            this.emit('recordingStarted', { slot: 2 });
          }
        }
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