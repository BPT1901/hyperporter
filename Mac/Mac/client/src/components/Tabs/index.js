import { Plus, X } from 'lucide-react';

const Tabs = ({ 
  tabs, 
  activeTab, 
  onTabClick, 
  onNewTab, 
  setTabs,
  setActiveTab 
}) => {
  const handleCloseTab = (e, index) => {
    e.stopPropagation();
    if (tabs.length > 1) {
      const newTabs = tabs.filter((_, i) => i !== index);
      if (activeTab >= index) {
        setActiveTab(Math.max(0, activeTab - 1));
      }
      setTabs(newTabs);
    }
  };

  return (
    <div style={{ 
      backgroundColor: '#252222', 
      borderBottom: '2px solid #A90D0D',
      overflowX: 'auto'  // Allow horizontal scrolling if many tabs
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        alignItems: 'center'
      }}>
        {tabs.map((tab, index) => (
          <button
            key={index}
            onClick={() => onTabClick(index)}
            style={{
              backgroundColor: activeTab === index ? '#3a3535' : '#2d2a2a',
              color: '#F7A44B',
              padding: '0.75rem 1.5rem',
              minWidth: '200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap'  // Prevent text wrapping
            }}
          >
            <span>{tab.ipAddress || 'Unnamed Connection'}</span>
            {tabs.length > 1 && (
              <X 
                size={16} 
                style={{
                  marginLeft: '0.5rem',
                  cursor: 'pointer'
                }}
                onClick={(e) => handleCloseTab(e, index)}
              />
            )}
          </button>
        ))}
        <button
          onClick={onNewTab}
          style={{
            backgroundColor: '#2d2a2a',
            color: '#F7A44B',
            padding: '0.75rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          <Plus size={18} style={{ marginRight: '0.25rem' }} />
          Add New Connection
        </button>
      </div>
    </div>
  );
};

export default Tabs;