import { useState } from "react";
import Dashboard from "./components/Dashboard";
import Tabs from "./components/Tabs";
import "./App.css";

function App() {
  const [tabs, setTabs] = useState([{ id: 0, ipAddress: "" }]);
  const [activeTab, setActiveTab] = useState(0);

  const handleNewTab = () => {
    setTabs([...tabs, { id: tabs.length, ipAddress: "" }]);
  };

  const updateTabIp = (tabId, ipAddress) => {
    console.log("updateTabIp called:", {
      tabId,
      ipAddress,
      currentTabs: tabs,
      activeTab,
    });

    setTabs((prevTabs) => {
      console.log("Updating tabs:", {
        prevTabs,
        tabToUpdate: tabId,
        newIp: ipAddress,
      });

      const newTabs = prevTabs.map((tab) => {
        if (tab.id === tabId) {
          console.log("Found matching tab:", tab.id);
          return { ...tab, ipAddress };
        }
        return tab;
      });

      console.log("New tabs state:", newTabs);
      return newTabs;
    });
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
          style={{ display: activeTab === index ? "block" : "none" }}
        >
          <Dashboard
            onConnect={(ip) => {
              console.log("Dashboard triggered onConnect:", {
                tabId: tab.id,
                ip,
                activeTab,
                currentTab: index,
              });
              updateTabIp(tab.id, ip);
            }}
          />
        </div>
      ))}
    </>
  );
}

export default App;
