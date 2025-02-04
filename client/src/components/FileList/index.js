import { useState, useEffect } from 'react';
import { Clock, HardDrive, Save, Folder } from 'lucide-react';
import path from 'path-browserify'

const FileList = ({ ws, isConnected }) => {
  console.log("FileList component rendering with:", { ws: !!ws, isConnected });
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [destinationPath, setDestinationPath] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [error, setError] = useState(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState(0);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  useEffect(() => {
    if (!ws || !isConnected) {
      console.log("WebSocket not ready or not connected");
      return;
    }

    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("FileList received message:", data);
        console.log("FileList received raw message:", event.data);
        console.log("FileList parsed message:", data);

        switch (data.type) {
          case "CLIP_LIST":
            console.log("Received CLIP_LIST data:", data);
            if (Array.isArray(data.clips)) {
              console.log("Setting files:", data.clips);
              setFiles(data.clips);
              setError(null);
              setIsLoadingFiles(false); // Clear loading state when files received
            } else {
              console.error("Clips data is not an array:", data.clips);
              setIsLoadingFiles(false);
            }
            break;
          case "CONNECT_HYPERDECK_RESPONSE":
            if (data.success) {
              setIsLoadingFiles(true); // Set loading when connection successful
              requestFileList();
            }
            break;
          case "ERROR":
            console.error("Received error:", data.message);
            setError(data.message);
            break;
          case "CONNECTED":
            console.log("Connected to HyperDeck, requesting file list");
            requestFileList();
            break;
          case "TRANSFER_PROGRESS":
            setTransferProgress(data.progress);
            setIsTransferring(true);
            break;
          case "RECORDING_SAVED":
            setIsTransferring(false);
            setTransferProgress(0);
            setError(null);
            break;
          default:
            console.log("Unhandled message type:", data.type);
        }
      } catch (error) {
        console.error("Error processing message:", error);
        setError("Error processing server message");
        setIsLoadingFiles(false);
      }
    };

    const requestFileList = () => {
      try {
        console.log("Attempting to send GET_FILE_LIST request");
        setIsLoadingFiles(true); // Set loading when requesting files
        ws.send(JSON.stringify({ type: "GET_FILE_LIST" }));
        console.log("GET_FILE_LIST request sent successfully");
      } catch (error) {
        console.error("Error sending GET_FILE_LIST request:", error);
        setError("Failed to request file list");
        setIsLoadingFiles(false);
      }
    };

    console.log("Setting up WebSocket message listener");
    ws.addEventListener("message", handleMessage);

    console.log("Requesting initial file list");
    requestFileList();

    return () => {
      console.log("Cleaning up WebSocket listener");
      ws.removeEventListener("message", handleMessage);
    };
  }, [ws, isConnected]);

const handleBrowse = async () => {
  try {
    const selectedPath = await window.electron.dialog.selectDirectory();
    if (selectedPath) {
      setDestinationPath(path.normalize(selectedPath));
    }
  }



  catch {

  };
}
  
  


  const handleFileNameChange = (e) => {
    let fileName = e.target.value;
    fileName = fileName.replace(/\.mp4$/, "");
    setNewFileName(fileName);
  };

  const handleSave = () => {
    if (!destinationPath || !newFileName || !selectedFile) {
      setError("Please select a file and enter a file name");
      return;
    }

    const fullFileName = newFileName.endsWith(".mp4")
      ? newFileName
      : `${newFileName}.mp4`;

    ws.send(
      JSON.stringify({
        type: "SAVE_RECORDING",
        file: selectedFile,
        destinationPath,
        newFileName: fullFileName,
      }),
    );
    setNewFileName("");
  };

  console.log("Current files state:", files); // Debug log

  return (
    <>
      <h2 className="text-xl font-semibold mb-4 pb-2 border-b-2 border-[#A90D0D]">
        Available Recordings
      </h2>
      <div
        className="recordings-list"
        style={{ width: "493.03px", height: "300px", overflowY: "auto" }}
      >
        {error ? (
          <p className="text-red-500">{error}</p>
        ) : isLoadingFiles ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-gray-500">Loading recordings...</span>
          </div>
        ) : files.length === 0 ? (
          <p className="text-gray-500">No recordings found</p>
        ) : (
          files.map((file, index) => (
            <div key={index} className="recording-item p-2 mb-2 border rounded">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedFile === file}
                    onChange={() => setSelectedFile(file)}
                    className="mr-4"
                  />
                  <div>
                    <p className="font-medium">{file.name}</p>
                    <div className="flex items-center mt-1 space-x-4">
                      <div className="flex items-center">
                        <HardDrive size={16} className="mr-1" />
                        <span>Slot {file.slot}</span>
                      </div>
                      <div className="flex items-center">
                        <Clock size={16} className="mr-1" />
                        <span>{file.duration || "Unknown"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t pt-4">
        <div className="input-group mb-4">
          <input
            type="text"
            className="input-field"
            value={destinationPath}
            readOnly
            placeholder="Select destination folder"
          />
          <button className="btn" onClick={handleBrowse}>
            <Folder size={18} />
          </button>
        </div>

        <h2 className="text-lg font-semibold mb-2">Name Your File</h2>
        <div className="input-group">
          <input
            type="text"
            className="input-field"
            style={{ width: "426.05px", height: "43.5px" }}
            value={newFileName}
            onChange={handleFileNameChange}
            placeholder="Enter new file name"
          />
          <div className="flex items-center space-x-2">
            {" "}
            {/* Only changed this container */}
            <button
              className="btn"
              onClick={handleSave}
              disabled={
                !destinationPath ||
                !newFileName ||
                !selectedFile ||
                isTransferring
              }
            >
              <span className="flex items-center justify-center">
                {isTransferring ? (
                  <div className="animate-spin">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  </div>
                ) : (
                  <Save size={18} />
                )}
              </span>
            </button>
            {isTransferring && (
              <span className="text-sm text-white whitespace-nowrap">
                {Math.round(transferProgress)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default FileList;
