// src/components/Dashboard/index.js
import { useState, useEffect, useCallback } from 'react';
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
  const [settings, setSettings] = useState({
    destinationPath: ''
  });
  const [ipAddress, setIpAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [selectedDrives, setSelectedDrives] = useState({
    ssd1: false,
    ssd2: false
  });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [transferStatus, setTransferStatus] = useState(null);
  const [ws, setWs] = useState(null);
  const [notification, setNotification] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [lastTransferredFile, setLastTransferredFile] = useState(null);

  const showNotification = (message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    if (transferStatus?.type === 'success') {
      showNotification(transferStatus.message, 'success');
    } else if (transferStatus?.type === 'error') {
      showNotification(transferStatus.message, 'error');
    }
  }, [transferStatus]);

  const sanitizePath = (path) => {
    return path.replace(/\/+/g, '/');
  };

  const connectWebSocket = useCallback(() => {
    const socket = new WebSocket('ws://localhost:3001/ws');

    socket.onopen = () => {
      console.log('WebSocket connected successfully');
      setTransferStatus('Connected to server');
    };

    socket.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setTransferStatus('Connection error - retrying...');
      setTimeout(() => connectWebSocket(), 5000);
    };

    socket.onclose = () => {
      console.log('WebSocket Disconnected');
      setTransferStatus('Disconnected - retrying...');
      setIsConnected(false);
      setIsMonitoring(false);
      setTimeout(() => connectWebSocket(), 5000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);
        console.log('Full message data:', data);
        
        switch (data.type) {
          case 'CONNECTED':
            setIsConnected(true);
            setTransferStatus({
              message: 'Connected to HyperDeck',
              type: 'success'
            });
            break;
            case 'MONITORING_STARTED':
              setIsMonitoring(true);
              setTransferStatus({
                message: 'Monitoring started',
                type: 'success'
              });
              break;  
          case 'CLIP_LIST':
            console.log('Received clip list:', data.clips);
            // FileList component will handle this
            break;
          case 'FILE_TRANSFER':
            setTransferStatus({
              message: `Transferring: ${data.filename}`,
              type: 'info'
            });
            break;
            case 'TRANSFER_COMPLETE':
              console.log('Transfer complete data:', data);  
              setLastTransferredFile(data.filePath);  // This is crucial
              setTransferStatus({
                message: `Success! File ${data.filename} has been transferred`,
                type: 'success'
            });
            break;
            case 'MONITORING_STOPPED':
              setIsMonitoring(false);
              if (data.lastTransferredFile) {
                setLastTransferredFile(data.lastTransferredFile);
                setTransferStatus({
                  message: `File transferred: ${data.fileName}`,
                  type: 'success'
                });
              } else {
                setTransferStatus({
                  message: 'Monitoring stopped',
                  type: 'success'
                });
              }
              break;
              case 'TRANSFER_STATUS':
                if (data.message.includes('final transfer check')) {
                  // A file has been transferred
                  const filePath = data.destinationPath; // This will be undefined until we update the server
                  setLastTransferredFile(filePath);
                  setTransferStatus({
                    message: 'File transfer complete',
                    type: 'success'
                  });
                }
                break;

                case 'FILE_RENAMED':
                  setTransferStatus({
                    message: 'File has been saved to your destination',
                    type: 'success'
                  });
                  setTimeout(() => setTransferStatus(null), 3000);
                  break;

          case 'ERROR':
            setTransferStatus({
              message: `Error: ${data.message}`,
              type: 'error'
            });
            break;
          default:
            console.log('Received message type:', data.type);
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };

    setWs(socket);
    return socket;
  }, []);

  useEffect(() => {
    const socket = connectWebSocket();
    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, [connectWebSocket]);

  const connectToHyperdeck = async () => {
    try {
      if (!ws) throw new Error('WebSocket not connected');
      ws.send(JSON.stringify({
        type: 'CONNECT_HYPERDECK',
        ipAddress
      }));
      onConnect(ipAddress); // Update the tab name on successful connection
    } catch (error) {
      console.error('Error connecting to HyperDeck:', error);
      setTransferStatus('Failed to connect to HyperDeck');
    }
  };

  const startWatching = async () => {
    try {
      if (!ws) throw new Error('WebSocket not connected');
      if (!settings.destinationPath) throw new Error('Destination path not set');
      if (!selectedDrives.ssd1 && !selectedDrives.ssd2) {
        throw new Error('Please select at least one drive to monitor');
      }
  
      setIsMonitoring(true);
      setTransferStatus({
        message: 'Monitoring started',
        type: 'success'
      });
  
      const sanitizedPath = sanitizePath(settings.destinationPath);
  
      ws.send(JSON.stringify({
        type: 'START_MONITORING',
        drives: selectedDrives,
        destinationPath: sanitizedPath
      }));
    } catch (error) {
      console.error('Error starting monitoring:', error);
      setTransferStatus({
        message: error.message,
        type: 'error'
      });
      setIsMonitoring(false);
    }
  };

  const stopWatching = async () => {
    try {
      if (ws) {
        const sanitizedPath = sanitizePath(settings.destinationPath);
        
        ws.send(JSON.stringify({
          type: 'STOP_MONITORING',
          drives: selectedDrives,
          destinationPath: sanitizedPath
        }));
      }
      setIsMonitoring(false);
      setTransferStatus({
        message: 'Monitoring stopped',
        type: 'success'
      });
    } catch (error) {
      console.error('Error stopping monitoring:', error);
      setTransferStatus({
        message: 'Failed to stop monitoring',
        type: 'error'
      });
    }
  };

  const handleFolderSelect = async () => {
    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      
      const fullPath = `/Users/benturner/Desktop/${directoryHandle.name}`;
      
      setSettings(prev => ({
        ...prev,
        destinationPath: fullPath
      }));
      setTransferStatus(`Selected destination folder: ${fullPath}`);
      
      window.selectedDirectory = directoryHandle;
    } catch (error) {
      console.error('Error selecting folder:', error);
      if (error.name === 'SecurityError') {
        setTransferStatus('Please grant permission to access folders');
      } else {
        setTransferStatus('Error selecting destination folder');
      }
    }
  };

  const handleRenameFile = async () => {
    if (!lastTransferredFile || !newFileName) return;
    
    try {
      ws.send(JSON.stringify({
        type: 'RENAME_FILE',
        oldPath: lastTransferredFile,
        newName: newFileName
      }));
    } catch (error) {
      console.error('Error renaming file:', error);
      setTransferStatus({
        message: 'Failed to rename file',
        type: 'error'
      });
    }
  };

  console.log('lastTransferredFile:', lastTransferredFile);

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
          {/* Panel Title */}
            <h2 className="text-xl font-semibold mb-4">Live Transfer</h2>
          {/* Connection Status */}
          <div className="mb-6">
          <h2 className="text-lg mb-2">Connection Status</h2>
            <p className={`status-text ${isConnected ? 'text-success' : 'text-error'}`}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </p>
          </div>

          {/* IP Input with inline button */}
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

          {/* Drive Selection */}
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

          {/* Destination Folder with inline button */}
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

          {/* Start/Stop Button */}
          <button
            className={`btn full-width ${isMonitoring ? 'monitoring' : ''}`}
            onClick={isMonitoring ? stopWatching : startWatching}
            disabled={!isConnected || !settings.destinationPath}
          >
            {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
          </button>
          {/* File Renaming Section */}
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
                  <Save size={18} /> {/* Using Lucide Save icon */}
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