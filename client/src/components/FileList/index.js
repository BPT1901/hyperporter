// FileList/index.js
import { useState, useEffect } from 'react';
import { Clock, HardDrive, Save, Folder } from 'lucide-react';

const FileList = ({ ws, isConnected }) => {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [transferStatus, setTransferStatus] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [newFileName, setNewFileName] = useState('');

  useEffect(() => {
    if (!ws || !isConnected) return;

    console.log('Requesting file list');
    ws.send(JSON.stringify({ type: 'GET_FILE_LIST' }));

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('FileList received:', data);

      if (data.type === 'CLIP_LIST') {
        setFiles(data.clips);
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, isConnected]);

  const handleBrowse = async () => {
    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      
      const fullPath = `/Users/benturner/Desktop/${directoryHandle.name}`;
      setDestinationPath(fullPath);
      
      window.selectedDirectory = directoryHandle;
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  };

  const handleFileNameChange = (e) => {
    let fileName = e.target.value;
    // Remove any existing .mp4 extension before adding it back
    fileName = fileName.replace(/\.mp4$/, '');
    setNewFileName(fileName);
  };

  const handleSave = () => {
    if (!destinationPath || !newFileName) return;
    
    // Ensure .mp4 extension
    const fullFileName = newFileName.endsWith('.mp4') ? newFileName : `${newFileName}.mp4`;
    
    ws.send(JSON.stringify({
      type: 'SAVE_RECORDING',
      file: selectedFile,
      destinationPath,
      newFileName: fullFileName
    }));
    // Clear the file name input after saving
  setNewFileName('');
  };

  return (
    <>
      <h2 className="text-xl font-semibold mb-4 pb-2 border-b-2 border-[#A90D0D]">
        Available Recordings
      </h2>
      <div className="recordings-list" style={{ width: '493.03px', height: '300px', overflowY: 'auto' }}>
        {files.length === 0 ? (
          <p className="text-gray-500">No recordings found</p>
        ) : (
          files.map((file, index) => (
            <div key={index} className="recording-item">
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
                        <span>{file.duration || 'Unknown'}</span>
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
          <button
            className="btn"
            onClick={handleBrowse}
          >
            <Folder size={18} />
          </button>
        </div>

        <h2 className="text-lg font-semibold mb-2">Name Your File</h2>
        <div className="input-group">
          <input
            type="text"
            className="input-field"
            style={{ width: '426.05px', height: '43.5px' }}
            value={newFileName}
            onChange={handleFileNameChange}
            placeholder="Enter new file name"
          />
          <button
            className="btn"
            onClick={handleSave}
            disabled={!destinationPath || !newFileName}
          >
            <Save size={18} />
          </button>
        </div>
      </div>
    </>
  );
};

export default FileList;