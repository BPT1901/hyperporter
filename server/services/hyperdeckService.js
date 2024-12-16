// server/services/hyperdeckService.js
const net = require('net');
const EventEmitter = require('events');

class HyperdeckService extends EventEmitter {
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
  }

  connect(ipAddress) {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        this.disconnect();
      }
  
      this.ipAddress = ipAddress;
      this.client = new net.Socket();
  
      this.client.connect(9993, ipAddress, () => {
        console.log('Connected to Hyperdeck at:', ipAddress);
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
        this.connected = false;
        reject(error);
      });
  
      this.client.on('close', () => {
        console.log('Hyperdeck connection closed');
        this.connected = false;
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

  processClipResponse(line) {
    console.log('Processing clip response:', line);
  
    // Handle clip entries in the format:
    // "1: MAC BANK SUPER 5TH DEC_0001.mp4 00:00:00:00 00:00:01:08"
    const clipMatch = line.match(/^(\d+): (.+\.mp4) (\d{2}:\d{2}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2}:\d{2})/);
    
    if (line.startsWith('205 clips info:')) {
      console.log('Starting new clip list');
      this.clipList = []; // Clear any existing clips
    }
    else if (clipMatch) {
      const clip = {
        id: clipMatch[1],
        name: clipMatch[2],
        startTime: clipMatch[3],
        duration: clipMatch[4]
      };
      console.log('Adding clip:', clip);
      this.clipList.push(clip);
      
      // If this is the last clip based on the clip count
      if (this.clipCount && this.clipList.length === this.clipCount) {
        console.log('Reached last clip, emitting list');
        this.emit('clipList', [...this.clipList]);
        this.clipList = [];
        this.clipCount = null;
        this.currentCommand = null;
      }
    }
    else if (line.startsWith('clip count:')) {
      this.clipCount = parseInt(line.split(': ')[1], 10);
      console.log('Got clip count:', this.clipCount);
    }
  }

  parseResponse(response) {
    // Parse slot info
    if (response.includes('slot id:')) {
      const slotMatch = response.match(/slot id: (\d+)/);
      const statusMatch = response.match(/status: (\w+)/);
      const recordingMatch = response.match(/recording time: (\d+:\d+:\d+:\d+)/);
      
      if (slotMatch && statusMatch) {
        this.emit('slotStatus', {
          slot: slotMatch[1],
          status: statusMatch[1],
          recordingTime: recordingMatch ? recordingMatch[1] : null
        });
      }
    }
  }

  async sendCommand(command) {
    if (!this.connected) {
      throw new Error('Not connected to Hyperdeck');
    }

    return new Promise((resolve, reject) => {
      this.currentCommand = command;
      console.log('Sending command:', command); // Debug logging
      
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

  async getClipList() {
    if (!this.connected) {
      throw new Error('Not connected to Hyperdeck');
    }
  
    console.log('Getting clip list...');
  
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('Clip list request timed out');
        console.log('Current clip list:', this.clipList);
        console.log('Current clip count:', this.clipCount);
        reject(new Error('Timeout waiting for clip list'));
      }, 15000); // Increased timeout to 15 seconds
  
      const handleClipList = (clips) => {
        console.log('Successfully received clip list:', clips);
        clearTimeout(timeout);
        this.removeListener('clipList', handleClipList);
        resolve(clips);
      };
  
      this.on('clipList', handleClipList);
  
      this.sendCommand('clips get')
        .catch((error) => {
          console.error('Error sending clip list command:', error);
          clearTimeout(timeout);
          this.removeListener('clipList', handleClipList);
          reject(error);
        });
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

  disconnect() {
    this.stopMonitoring();
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.connected = false;
    this.currentCommand = null;
    this.buffer = '';
    this.clipList = [];
  }
}

module.exports = new HyperdeckService();