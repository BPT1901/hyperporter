// server/services/rtspService.js
const RtspStream = require('node-rtsp-stream');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');

class RtspService {
    constructor() {
        this.activeStreams = new Map();
    }

    async startStream(hyperdeckIp, slot, destinationPath, filename) {
        const streamKey = `${hyperdeckIp}_${slot}`;
        
        if (this.activeStreams.has(streamKey)) {
            console.log('Stream already exists for this slot');
            return;
        }

        const rtspUrl = `rtsp://${hyperdeckIp}:8554/slot${slot}`;
        const outputPath = path.join(destinationPath, filename);

        console.log(`Starting RTSP stream: ${rtspUrl} to ${outputPath}`);

        try {
            const command = ffmpeg(rtspUrl)
                .outputOptions([
                    '-c:v copy',     // Copy video codec (no re-encoding)
                    '-c:a copy'      // Copy audio codec
                ])
                .on('start', () => {
                    console.log('Started RTSP stream recording');
                })
                .on('progress', (progress) => {
                    console.log('Recording progress:', progress);
                })
                .on('error', (err) => {
                    console.error('RTSP recording error:', err);
                })
                .on('end', () => {
                    console.log('RTSP recording completed');
                });

            command.save(outputPath);

            this.activeStreams.set(streamKey, {
                command,
                outputPath
            });

            return streamKey;
        } catch (error) {
            console.error('Failed to start RTSP stream:', error);
            throw error;
        }
    }

    async stopStream(hyperdeckIp, slot) {
        const streamKey = `${hyperdeckIp}_${slot}`;
        const stream = this.activeStreams.get(streamKey);
        
        if (stream) {
            try {
                stream.command.kill('SIGTERM');
                this.activeStreams.delete(streamKey);
                console.log(`Stopped stream: ${streamKey}`);
            } catch (error) {
                console.error('Error stopping stream:', error);
            }
        }
    }
}

module.exports = new RtspService();