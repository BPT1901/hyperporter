// src/App.js
import { useState } from 'react';
import Dashboard from './components/Dashboard';
import Tabs from './components/Tabs';
import './App.css';

function App() {
  const [tabs, setTabs] = useState([
    { id: 0, ipAddress: '' }
  ]);
  const [activeTab, setActiveTab] = useState(0);

  const handleNewTab = () => {
    setTabs([...tabs, { id: tabs.length, ipAddress: '' }]);
  };

  const updateTabIp = (tabId, ipAddress) => {
    setTabs(tabs.map(tab => 
      tab.id === tabId ? { ...tab, ipAddress } : tab
    ));
  };

  return (
    <>
      <Tabs 
        tabs={tabs}
        activeTab={activeTab}
        onTabClick={setActiveTab}
        onNewTab={handleNewTab}
        setTabs={setTabs}
        setActiveTab={setActiveTab}
      />
      {tabs.map((tab, index) => (
        <div 
          key={tab.id} 
          style={{ display: activeTab === index ? 'block' : 'none' }}
        >
          <Dashboard 
            onConnect={(ipAddress) => updateTabIp(tab.id, ipAddress)}
          />
        </div>
      ))}
    </>
  );
}

export default App;