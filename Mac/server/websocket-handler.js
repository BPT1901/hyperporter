// server/websocket-handler.js
const FileWatcher = require('./services/fileWatcher');
const hyperdeckService = require('./services/hyperdeckService');

let fileWatcher = null;

function handleWebSocket(ws) {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'CONNECT_HYPERDECK':
          try {
            await hyperdeckService.connect(data.ipAddress);
            ws.send(JSON.stringify({ type: 'CONNECTED' }));
          } catch (error) {
            ws.send(JSON.stringify({ 
              type: 'ERROR', 
              message: 'Failed to connect to HyperDeck'
            }));
          }
          break;

        case 'START_MONITORING':
          try {
            // Initialize file watcher if not exists
            if (!fileWatcher) {
              fileWatcher = new FileWatcher(hyperdeckService, ws);
            }
            
            // Start monitoring selected drives
            await fileWatcher.startWatching(data.drives, data.destinationPath);
            
            // Start HyperDeck monitoring
            hyperdeckService.startMonitoring(data.drives);
            
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'ERROR',
              message: `Failed to start monitoring: ${error.message}`
            }));
          }
          break;

        case 'STOP_MONITORING':
          if (fileWatcher) {
            fileWatcher.stop();
          }
          hyperdeckService.stopMonitoring();
          break;

        case 'FINAL_CHECK':
          if (fileWatcher) {
            await fileWatcher.finalCheck();
          }
          break;
      }

    } catch (error) {
      console.error('WebSocket message handling error:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Internal server error'
      }));
    }
  });

  ws.on('close', () => {
    if (fileWatcher) {
      fileWatcher.stop();
    }
    hyperdeckService.stopMonitoring();
  });
}

module.exports = handleWebSocket;