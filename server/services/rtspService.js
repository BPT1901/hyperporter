// server/services/rtspService.js
const RtspStream = require('node-rtsp-stream');
const fs = require('fs-extra');
const path = require('path');

class RtspService {
  constructor() {
    this.streams = new Map();
    this.recordings = new Map();
  }

  startStream(hyperdeckIp, slot, destinationPath, filename) {
    const streamKey = `${hyperdeckIp}_${slot}`;
    
    if (this.streams.has(streamKey)) {
      console.log('Stream already exists for this slot');
      return;
    }

    const rtspUrl = `rtsp://${hyperdeckIp}/stream-${slot}`;
    console.log(`Starting RTSP stream from: ${rtspUrl}`);

    try {
      const stream = new RtspStream({
        name: streamKey,
        streamUrl: rtspUrl,
        wsPort: 9999 + parseInt(slot),
        ffmpegOptions: {
          '-stats': '',
          '-r': 30,
          '-c:v': 'copy',
          '-c:a': 'copy',
          '-f': 'mp4',
        }
      });

      const outputPath = path.join(destinationPath, filename);
      const fileStream = fs.createWriteStream(outputPath);

      stream.on('data', (data) => {
        fileStream.write(data);
      });

      stream.on('error', (error) => {
        console.error('RTSP Stream error:', error);
        this.stopStream(hyperdeckIp, slot);
      });

      this.streams.set(streamKey, {
        stream,
        fileStream,
        outputPath
      });

      return streamKey;
    } catch (error) {
      console.error('Failed to start RTSP stream:', error);
      throw error;
    }
  }

  stopStream(hyperdeckIp, slot) {
    const streamKey = `${hyperdeckIp}_${slot}`;
    const streamData = this.streams.get(streamKey);
    
    if (streamData) {
      try {
        streamData.stream.stop();
        streamData.fileStream.end();
        this.streams.delete(streamKey);
        console.log(`Stopped stream: ${streamKey}`);
      } catch (error) {
        console.error('Error stopping stream:', error);
      }
    }
  }

  isStreaming(hyperdeckIp, slot) {
    return this.streams.has(`${hyperdeckIp}_${slot}`);
  }
}

module.exports = new RtspService();