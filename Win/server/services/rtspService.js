// server/services/rtspService.js
const RtspStream = require('node-rtsp-stream');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');

class RtspService {
    constructor() {
        this.activeStreams = new Map();
        this.streamRetryAttempts = new Map();
        this.MAX_RETRY_ATTEMPTS = 3;
    }

    async startStream(hyperdeckIp, slot, destinationPath, filename) {
        const streamKey = `${hyperdeckIp}_${slot}`;
        
        if (this.activeStreams.has(streamKey)) {
            console.log('Stream already exists for this slot');
            return streamKey;
        }
    
        const rtspUrl = `rtsp://${hyperdeckIp}:8554/slot${slot}`;
        
        // Normalize the path for Windows
        const normalizedPath = destinationPath.replace(/\\/g, '/');
        const outputPath = path.join(normalizedPath, filename);
    
        // Ensure directory exists
        await fs.ensureDir(normalizedPath);
    
        console.log(`Starting RTSP stream: ${rtspUrl} to ${outputPath}`);
    
        try {
            const command = ffmpeg(rtspUrl)
                .outputOptions([
                    '-c:v copy',
                    '-c:a copy',
                    '-reset_timestamps 1',
                    '-fflags +genpts',
                    '-rtsp_transport tcp'
                ])
                .on('start', () => {
                    console.log('Started RTSP stream recording');
                    this.streamRetryAttempts.set(streamKey, 0);
                })
                .on('progress', (progress) => {
                    console.log('Recording progress:', progress);
                })
                .on('error', async (err, stdout, stderr) => {
                    console.error('RTSP recording error:', err);
                    console.error('FFmpeg output:', stdout);
                    console.error('FFmpeg stderr:', stderr);
                    
                    const attempts = this.streamRetryAttempts.get(streamKey) || 0;
                    if (attempts < this.MAX_RETRY_ATTEMPTS) {
                        console.log(`Attempting to recover stream (attempt ${attempts + 1}/${this.MAX_RETRY_ATTEMPTS})`);
                        this.streamRetryAttempts.set(streamKey, attempts + 1);
                        
                        await this.stopStream(hyperdeckIp, slot);
                        await this.startStream(hyperdeckIp, slot, destinationPath, filename);
                    }
                })
                .on('end', () => {
                    console.log('RTSP recording completed');
                    this.verifyRecording(outputPath);
                });
    
            // Use save with the normalized path
            command.save(outputPath);
    
            this.activeStreams.set(streamKey, {
                command,
                outputPath,
                startTime: Date.now()
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
                // Give ffmpeg a chance to finish writing
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                stream.command.kill('SIGTERM');
                this.activeStreams.delete(streamKey);
                this.streamRetryAttempts.delete(streamKey);
                
                console.log(`Stopped stream: ${streamKey}`);
                
                // Verify the final file
                const finalSize = fs.statSync(stream.outputPath).size;
                console.log(`Final recording size: ${finalSize} bytes`);
                
                return {
                    outputPath: stream.outputPath,
                    duration: (Date.now() - stream.startTime) / 1000,
                    fileSize: finalSize
                };
            } catch (error) {
                console.error('Error stopping stream:', error);
                throw error;
            }
        }
    }

    async verifyRecording(outputPath) {
        try {
            if (await fs.pathExists(outputPath)) {
                const stats = await fs.stat(outputPath);
                if (stats.size === 0) {
                    console.error('Recording completed but file is empty');
                    throw new Error('Recording file is empty');
                } else {
                    console.log(`Recording completed successfully, file size: ${stats.size} bytes`);
                }
            } else {
                console.error('Recording file not found after completion');
                throw new Error('Recording file not found');
            }
        } catch (error) {
            console.error('Error verifying recording:', error);
            throw error;
        }
    }

    getStreamStatus(hyperdeckIp, slot) {
        const streamKey = `${hyperdeckIp}_${slot}`;
        const stream = this.activeStreams.get(streamKey);
        
        if (stream) {
            return {
                active: true,
                duration: (Date.now() - stream.startTime) / 1000,
                outputPath: stream.outputPath
            };
        }
        
        return { active: false };
    }
}

module.exports = new RtspService();