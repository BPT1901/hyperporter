import React, { useState, useEffect, useCallback } from "react";
import FileList from "../FileList";
import { AlertCircle, Check, HardDrive, Save, Loader } from "lucide-react";

const Notification = ({ message, type }) => (
  <div className={`notification ${type}`}>
    <div className="flex items-center">
      {type === "success" ? <Check size={20} /> : <AlertCircle size={20} />}
      <span className="ml-2">{message}</span>
    </div>
  </div>
);

const LoadingSpinner = () => <Loader className="animate-spin h-4 w-4 mr-2" />;

const Dashboard = ({ onConnect }) => {
  // State declarations
  const [settings, setSettings] = useState({ destinationPath: "" });
  const [ipAddress, setIpAddress] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [selectedDrives, setSelectedDrives] = useState({
    ssd1: false,
    ssd2: false,
  });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [transferStatus, setTransferStatus] = useState(null);
  const [ws, setWs] = useState(null);
  const [notification, setNotification] = useState(null);
  const [newFileName, setNewFileName] = useState("");
  const [lastTransferredFile, setLastTransferredFile] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState(null);
  const [recordingTimecode, setRecordingTimecode] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Notification helper
  const showNotification = useCallback((message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // WebSocket connection handler
  const connectWebSocket = useCallback(() => {
    let socket = null;

    try {
      // Prevent creating a new connection if one exists
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("WebSocket already connected");
        return;
      }

      const wsUrl = "ws://localhost:3001/ws";

      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log("WebSocket connected successfully");
        setWsConnected(true);
        showNotification("Connected to application server", "success");
      };

      socket.onclose = () => {
        console.log("WebSocket disconnected");
        // Batch these state updates
        Promise.resolve().then(() => {
          setWsConnected(false);
          setIsConnected(false);
          setIsMonitoring(false);
        });
        showNotification("Connection lost - retrying...", "error");

        // Use setTimeout without checking state
        setTimeout(connectWebSocket, 5000);
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        // Only set WebSocket status
        setWsConnected(false);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received message:", data);

          switch (data.type) {
            case "CONNECTED":
            case "CONNECT_HYPERDECK_RESPONSE":
              if (
                data.success ||
                data.message === "Successfully connected to HyperDeck"
              ) {
                const connectedIp = data.ipAddress;
                console.log("HyperDeck Connection Success:", {
                  responseIp: connectedIp,
                  onConnectExists: !!onConnect,
                  data,
                });

                setIsConnected(true);
                setIsLoading(false);
                showNotification(
                  "Successfully connected to HyperDeck",
                  "success",
                );
                // Add new notification for file fetching
                setTimeout(() => {
                  showNotification(
                    <div className="flex items-center">
                      <Loader className="animate-spin mr-2 h-4 w-4" />
                      Getting existing recordings...
                    </div>,
                    "success",
                  );
                }, 1000);

                if (onConnect && connectedIp) {
                  onConnect(connectedIp);
                }
              } else {
                setIsLoading(false); // Stop the spinner on error
                showNotification(data.message || "Connection failed", "error");
              }
              break;

            case "CLIP_LIST":
              // Add success notification when files are loaded
              showNotification("Recordings loaded successfully", "success");
              break;

            // case 'RTSP_TEST_STATUS':
            //     console.log('RTSP Test Status:', data.message, data.status);
            //     setTransferStatus({
            //         message: data.message,
            //         type: 'success'
            //     });
            // break;

            case "MONITORING_STARTED":
              setIsMonitoring(true);
              setIsLoading(false);
              showNotification("Monitoring started", "success");
              break;

            case "MONITORING_STOPPED":
              setIsLoading(false);
              // Immediately update monitoring status
              setIsMonitoring(false);

              // Clear recording status and timecode
              setRecordingStatus(null);
              setRecordingTimecode(null);

              // Show appropriate notification based on response
              if (data.error) {
                showNotification(
                  `Monitoring stopped with error: ${data.error}`,
                  "error",
                );
              } else if (data.lastTransferredFile) {
                setLastTransferredFile(data.lastTransferredFile);
                const fileName = data.fileName
                  ? data.fileName
                  : data.lastTransferredFile.split("/").pop();
                setNewFileName(fileName.replace(".mp4", ""));
                showNotification(
                  "Monitoring stopped - You can now rename the last transferred file",
                  "info",
                );
              } else {
                showNotification("Monitoring stopped", "info");
              }

              // Clear transfer status
              setTransferStatus(null);
              break;

            case "FILE_RENAMED":
              showNotification("File renamed successfully", "success");
              setNewFileName("");
              setLastTransferredFile(null);
              break;

            case "TRANSFER_COMPLETED":
              setLastTransferredFile(data.file);
              setTransferStatus({
                message: `Transfer completed: ${data.file}`,
                type: "success",
              });
              break;

            case "RECORDING_SAVED":
              setIsLoading(false);
              showNotification(
                "Your file has been successfully transferred",
                "success",
              );
              setNewFileName("");
              setLastTransferredFile(null);
              break;

            case "TRANSFER_FAILED":
              setTransferStatus({
                message: `Transfer failed: ${data.error}`,
                type: "error",
              });
              break;

            default:
              console.warn("Unhandled message type:", data.type);
          }
        } catch (error) {
          console.error("Error processing message:", error);
          showNotification("Error processing server message", "error");
        }
      };
      setWs(socket);
    } catch (error) {
      console.error("WebSocket connection error:", error);
      showNotification("Failed to connect to WebSocket", "error");
    }
  }, [showNotification]);

  // Initialize WebSocket connection
  useEffect(() => {
    const connect = () => {
      connectWebSocket();
    };

    connect();

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "RECORDING_STARTED":
          setRecordingStatus("recording");
          setTransferStatus({
            message: `Recording to: ${data.filename}`,
            type: "success",
          });
          break;
        case "RECORDING_STOPPED":
          setRecordingStatus(null);
          setTransferStatus({
            message: "Recording stopped",
            type: "success",
          });
          break;
        case "TRANSPORT_INFO":
          setRecordingTimecode(data.timecode);
          break;
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws]);

  // Send message helper with connection check
  const sendMessage = useCallback(
    (message) => {
      if (!ws || !wsConnected) {
        console.log("WebSocket not ready, message not sent:", message);
        // Optionally queue the message to send when connected
        return;
      }

      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending message:", error);
        showNotification("Failed to send message", "error");
      }
    },
    [ws, wsConnected, showNotification],
  );

  // HyperDeck connection handler
  const connectToHyperdeck = useCallback(async () => {
    if (!ipAddress) {
      showNotification("Please enter an IP address", "error");
      return;
    }

    setIsLoading(true);
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNotification("WebSocket not connected", "error");
        setIsLoading(false);
        return;
      }

      ws.send(
        JSON.stringify({
          type: "CONNECT_HYPERDECK",
          ipAddress: ipAddress,
        }),
      );
    } catch (error) {
      console.error("Error connecting to HyperDeck:", error);
      showNotification("Failed to connect to HyperDeck", "error");
      setIsLoading(false);
    }
  }, [ipAddress, ws, showNotification]);

  // File system handlers

  const handleFolderSelect = useCallback(async () => {
    try {
      const selectedPath = await window.electron.dialog.selectDirectory();
      if (selectedPath) {
        setSettings((prev) => ({ ...prev, destinationPath: selectedPath }));
        showNotification(`Folder selected: ${selectedPath}`, "success");
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      showNotification("Failed to select folder", "error");
    }
  }, [showNotification]);

  const startWatching = useCallback(async () => {
    if (!settings.destinationPath) {
      showNotification("Please select a destination folder first", "error");
      return;
    }

    if (!ws || !wsConnected) {
      showNotification("Not connected to server", "error");
      return;
    }

    setIsLoading(true);
    try {
      ws.send(
        JSON.stringify({
          type: "START_MONITORING",
          drives: selectedDrives,
          destinationPath: settings.destinationPath,
        }),
      );
    } catch (error) {
      console.error("Error starting monitoring:", error);
      showNotification("Failed to start monitoring: " + error.message, "error");
      setIsLoading(false);
    }
  }, [
    settings.destinationPath,
    selectedDrives,
    ws,
    wsConnected,
    showNotification,
  ]);

  const stopWatching = useCallback(() => {
    setIsLoading(true);
    try {
      showNotification("Stopping monitoring...", "info");
      setTransferStatus({ message: "Stopping monitoring...", type: "info" });
      sendMessage({ type: "STOP_MONITORING" });
    } catch (error) {
      console.error("Error stopping monitoring:", error);
      showNotification("Failed to stop monitoring: " + error.message, "error");
      setIsMonitoring(false);
      setIsLoading(false);
    }
  }, [sendMessage, showNotification]);

  const handleRenameFile = useCallback(async () => {
    if (!lastTransferredFile || !newFileName) {
      showNotification("Please enter a new file name", "error");
      return;
    }

    try {
      const fullFileName = newFileName.endsWith(".mp4")
        ? newFileName
        : `${newFileName}.mp4`;

      // Use exact same structure as FileList component
      ws.send(
        JSON.stringify({
          type: "SAVE_RECORDING",
          file: {
            name: lastTransferredFile.split("/").pop(),
            slot: selectedDrives.ssd1 ? 1 : 2, // Determine which slot was being monitored
            path: lastTransferredFile,
          },
          destinationPath: settings.destinationPath,
          newFileName: fullFileName,
        }),
      );
    } catch (error) {
      console.error("Error saving file:", error);
      showNotification("Failed to save file", "error");
    }
  }, [
    lastTransferredFile,
    newFileName,
    ws,
    settings.destinationPath,
    selectedDrives,
    showNotification,
  ]);

  return (
    <div className={`app-container ${isLoading ? "cursor-wait" : ""}`}>
      {notification && (
        <div className="notification-container">
          <Notification
            message={notification.message}
            type={notification.type}
          />
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
            <p
              className={`status-text ${wsConnected ? "text-success" : "text-error"}`}
            >
              {wsConnected ? "Connected" : "Disconnected"}
            </p>
          </div>

          <div className="input-group">
            <input
              type="text"
              className="input-field"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="HyperDeck IP Address"
              disabled={isConnected || isLoading}
            />
            <button
              className={`btn flex items-center justify-center ${isLoading && !isConnected ? "opacity-75" : ""}`}
              onClick={connectToHyperdeck}
              disabled={
                isConnected || !ipAddress || (isLoading && !isConnected)
              }
            >
              {isLoading && !isConnected ? (
                <>
                  <LoadingSpinner />
                  Connecting...
                </>
              ) : (
                "Connect to HyperDeck"
              )}
            </button>
          </div>

          <div className="mb-6">
            <h2>Drive Selection</h2>
            <div className="drive-options">
              {["ssd1", "ssd2"].map((drive) => (
                <label key={drive} className="drive-option">
                  <input
                    type="checkbox"
                    checked={selectedDrives[drive]}
                    onChange={(e) =>
                      setSelectedDrives((prev) => ({
                        ...prev,
                        [drive]: e.target.checked,
                      }))
                    }
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
            className={`btn full-width ${isMonitoring ? "monitoring" : ""} ${isLoading && !isMonitoring ? "opacity-75" : ""}`}
            onClick={isMonitoring ? stopWatching : startWatching}
            disabled={
              !isConnected ||
              !settings.destinationPath ||
              (isLoading && !isMonitoring)
            }
          >
            {isLoading && !isMonitoring ? (
              <span className="flex items-center justify-center">
                <LoadingSpinner />
                Starting...
              </span>
            ) : isMonitoring ? (
              "Stop Monitoring"
            ) : (
              "Start Monitoring"
            )}
          </button>

          {/* Add status indicator */}
          {transferStatus && (
            <div
              className={`mt-4 p-4 rounded ${
                transferStatus.type === "error"
                  ? "bg-red-100 text-red-800"
                  : transferStatus.type === "success"
                    ? "bg-green-100 text-green-800"
                    : "bg-blue-100 text-blue-800"
              }`}
            >
              <p>{transferStatus.message}</p>
              {recordingTimecode && (
                <p className="text-sm mt-1">Timecode: {recordingTimecode}</p>
              )}
            </div>
          )}

          {isMonitoring && recordingStatus === "recording" && (
            <div className="mt-4 p-4 bg-green-100 rounded">
              <p className="text-green-800">Recording in progress</p>
              {recordingTimecode && (
                <p className="text-sm text-green-600">
                  Timecode: {recordingTimecode}
                </p>
              )}
            </div>
          )}

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
