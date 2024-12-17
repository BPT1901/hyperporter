import React, { useState, useEffect, useCallback } from 'react';
import FileList from '../FileList';
import { AlertCircle, Check, HardDrive, Folder, Save } from 'lucide-react';

const Notification = ({ message, type }) => (
  <div className={`notification ${type}`}>
    <div className="flex items-center">
      {type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
      <span className="ml-2">{message}</span>
    </div>
  </div>
);

const Dashboard = ({ onConnect }) => {
  // State declarations
  const [settings, setSettings] = useState({ destinationPath: '' });
  const [ipAddress, setIpAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [selectedDrives, setSelectedDrives] = useState({ ssd1: false, ssd2: false });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [transferStatus, setTransferStatus] = useState(null);
  const [ws, setWs] = useState(null);
  const [notification, setNotification] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [lastTransferredFile, setLastTransferredFile] = useState(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  // Notification helper
  const showNotification = useCallback((message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // WebSocket connection handler
  const connectWebSocket = useCallback(() => {
    let socket = null;
    
    try {
      socket = new WebSocket('ws://localhost:3001/ws');
      setWs(socket);

      socket.onopen = () => {
        console.log('WebSocket connected successfully');
        setWsConnected(true);
        showNotification('Connected to application server', 'success');
      };

      socket.onclose = () => {
        console.log('WebSocket disconnected');
        setWsConnected(false);
        setIsConnected(false);
        setIsMonitoring(false);
        showNotification('Connection lost - retrying...', 'error');
        
        // Retry connection after delay
        setTimeout(() => {
          if (!wsConnected) {
            connectWebSocket();
          }
        }, 5000);
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
        showNotification('Connection error occurred', 'error');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);

          switch (data.type) {
            case 'CONNECTED':
              setIsConnected(true);
              setTransferStatus({ message: 'Connected to HyperDeck', type: 'success' });
              break;

            case 'MONITORING_STARTED':
              setIsMonitoring(true);
              setTransferStatus({ message: 'Monitoring started', type: 'success' });
              break;

            case 'MONITORING_STOPPED':
              setIsMonitoring(false);
              setTransferStatus({ message: 'Monitoring stopped', type: 'info' });
              break;

            case 'TRANSFER_COMPLETED':
              setLastTransferredFile(data.file);
              setTransferStatus({ message: `Transfer completed: ${data.file}`, type: 'success' });
              break;

            case 'TRANSFER_FAILED':
              setTransferStatus({ message: `Transfer failed: ${data.error}`, type: 'error' });
              break;

            default:
              console.warn('Unhandled message type:', data.type);
          }
        } catch (error) {
          console.error('Error processing message:', error);
          showNotification('Error processing server message', 'error');
        }
          };
        } catch (error) {
          console.error('Error processing message:', error);
          showNotification('Error processing server message', 'error');
        }
      }, [showNotification]);


  // Initialize WebSocket connection
  useEffect(() => {
    connectWebSocket();
    
    // Cleanup function
    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        setWs(null);
        setWsConnected(false);
      }
    };
  }, [connectWebSocket]);

  // Send message helper with connection check
  const sendMessage = useCallback((message) => {
    if (!ws || !wsConnected) {
      console.log('WebSocket not ready, message not sent:', message);
      // Optionally queue the message to send when connected
      return;
    }

    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message:', error);
      showNotification('Failed to send message', 'error');
    }
  }, [ws, wsConnected, showNotification]);

  // Initialize WebSocket connection
  useEffect(() => {
    const cleanup = connectWebSocket();
    return () => {
      if (cleanup) cleanup();
    };
  }, [connectWebSocket]);

    // HyperDeck connection handler
    const connectToHyperdeck = useCallback(async () => {
      if (!ipAddress) {
        showNotification('Please enter an IP address', 'error');
        return;
      }
    
      console.log('Attempting to connect to HyperDeck at:', ipAddress);
      
      try {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          showNotification('WebSocket not connected', 'error');
          return;
        }
    
        // Send connection request through WebSocket
        ws.send(JSON.stringify({
          type: 'CONNECT_HYPERDECK',
          ipAddress: ipAddress
        }));
    
      } catch (error) {
        console.error('Error connecting to HyperDeck:', error);
        showNotification('Failed to connect to HyperDeck', 'error');
      }
    }, [ipAddress, ws, showNotification]);

  // File system handlers
  const sanitizePath = useCallback((path) => {
    try {
      return window.electron.path.join(path);
    } catch (error) {
      console.error('Error sanitizing path:', error);
      return path;
    }
  }, []);

  const handleFolderSelect = useCallback(async () => {
    try {
      const selectedPath = await window.electron.dialog.selectDirectory();
      if (selectedPath) {
        setSettings(prev => ({ ...prev, destinationPath: selectedPath }));
        setTransferStatus({ message: `Folder selected: ${selectedPath}`, type: 'success' });
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
      showNotification('Failed to select folder', 'error');
    }
  }, [showNotification]);

  const startWatching = useCallback(async () => {
    if (!settings.destinationPath) {
      showNotification('Please select a destination folder first', 'error');
      return;
    }

    try {
      sendMessage({ type: 'START_MONITORING', path: settings.destinationPath });
      setIsMonitoring(true);
    } catch (error) {
      console.error('Error starting monitoring:', error);
      showNotification('Failed to start monitoring', 'error');
    }
  }, [settings.destinationPath, sendMessage, showNotification]);

  const stopWatching = useCallback(() => {
    try {
      sendMessage({ type: 'STOP_MONITORING' });
      setIsMonitoring(false);
      setTransferStatus({ message: 'Monitoring stopped', type: 'info' });
    } catch (error) {
      console.error('Error stopping monitoring:', error);
      showNotification('Failed to stop monitoring', 'error');
    }
  }, [sendMessage, showNotification]);

  const handleRenameFile = useCallback(async () => {
    if (!lastTransferredFile || !newFileName) {
      showNotification('Please enter a new file name', 'error');
      return;
    }

    try {
      const oldPath = sanitizePath(lastTransferredFile);
      const newPath = sanitizePath(newFileName);
      await window.electron.fs.rename(oldPath, newPath);
      setTransferStatus({ message: 'File renamed successfully', type: 'success' });
      setNewFileName('');
    } catch (error) {
      console.error('Error renaming file:', error);
      showNotification('Failed to rename file', 'error');
    }
  }, [lastTransferredFile, newFileName, sanitizePath, showNotification]);

  // Update transfer status notification
  useEffect(() => {
    if (transferStatus) {
      showNotification(transferStatus.message, transferStatus.type);
    }
  }, [transferStatus, showNotification]);

  return (
    <div className="app-container">
      {notification && (
        <div className="notification-container">
          <Notification message={notification.message} type={notification.type} />
        </div>
      )}

      <header className="header">
        <h1>Hyperporter</h1>
      </header>

      <main className="main-content">
        {/* Left Panel - Controls */}
        <div className="panel">
          <h2 className="text-xl font-semibold mb-4">Live Transfer</h2>
          
          <div className="mb-6">
            <h2 className="text-lg mb-2">Connection Status</h2>
            <p className={`status-text ${wsConnected ? 'text-success' : 'text-error'}`}>
              {wsConnected ? 'Connected' : 'Disconnected'}
            </p>
          </div>

          <div className="input-group">
            <input
              type="text"
              className="input-field"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="HyperDeck IP Address"
              disabled={isConnected}
            />
            <button
              className="btn"
              onClick={connectToHyperdeck}
              disabled={isConnected || !ipAddress}
            >
              Connect to HyperDeck
            </button>
          </div>

          <div className="mb-6">
            <h2>Drive Selection</h2>
            <div className="drive-options">
              {['ssd1', 'ssd2'].map(drive => (
                <label key={drive} className="drive-option">
                  <input
                    type="checkbox"
                    checked={selectedDrives[drive]}
                    onChange={(e) => setSelectedDrives(prev => ({
                      ...prev,
                      [drive]: e.target.checked
                    }))}
                    disabled={!isConnected || isMonitoring}
                  />
                  <HardDrive size={20} />
                  <span>SSD {drive.slice(-1)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="input-group">
            <input
              type="text"
              className="input-field"
              value={settings.destinationPath}
              readOnly
              placeholder="Select destination folder"
            />
            <button
              className="btn"
              onClick={handleFolderSelect}
              disabled={!isConnected || isMonitoring}
            >
              Browse
            </button>
          </div>

          <button
            className={`btn full-width ${isMonitoring ? 'monitoring' : ''}`}
            onClick={isMonitoring ? stopWatching : startWatching}
            disabled={!isConnected || !settings.destinationPath}
          >
            {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
          </button>

          {lastTransferredFile && (
            <div className="mt-6 border-t pt-6">
              <h2 className="text-lg font-semibold mb-2">Name Your File</h2>
              <div className="input-group">
                <input
                  type="text"
                  className="input-field"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="Enter new file name"
                />
                <button
                  className="btn"
                  onClick={handleRenameFile}
                  disabled={!newFileName}
                >
                  <span className="flex items-center justify-center">
                    <Save size={18} />
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - FileList */}
        <div className="panel recordings-panel">
          <FileList ws={ws} isConnected={isConnected} />
        </div>
      </main>
    </div>
  );
};

export default Dashboard;