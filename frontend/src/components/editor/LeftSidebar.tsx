import React from 'react';
import { Sliders, Film } from 'lucide-react';
import { useEditorStore, selectEffectivePlan } from '../../stores/editorStore';
import { ProjectPanel } from './ProjectPanel';
import { InspectorPanel } from './InspectorPanel';

export const LeftSidebar: React.FC = () => {
  const { activeTab, setActiveTab } = useEditorStore();
  const effectivePlan = useEditorStore(selectEffectivePlan);

  const layerCount = effectivePlan?.layers.length || 0;

  return (
    <aside className="w-full lg:w-80 border-r-0 lg:border-r border-[#393B3F] bg-[#18191B] flex flex-col h-full select-none text-xs font-sans min-h-0">
      {/* Top Tab Bar: Project vs Inspector */}
      <div className="h-12 border-b border-[#393B3F] px-2 flex items-center bg-[#18191B]">
        <button
          onClick={() => setActiveTab('project')}
          className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center space-x-2 font-medium transition-all ${
            activeTab === 'project'
              ? 'bg-[#222326] text-[#E3B5BE] border border-[#393B3F] shadow-sm font-semibold'
              : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Project & Media</span>
        </button>

        <button
          onClick={() => setActiveTab('inspector')}
          className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center space-x-2 font-medium transition-all ${
            activeTab === 'inspector'
              ? 'bg-[#222326] text-[#E3B5BE] border border-[#393B3F] shadow-sm font-semibold'
              : 'text-[#FFF5F5]/60 hover:text-[#FFF5F5]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Inspector</span>
          {layerCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-[#2A2C2F] text-[#F7D7D1] border border-[#393B3F] text-[10px] flex items-center justify-center font-mono">
              {layerCount}
            </span>
          )}
        </button>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-hidden flex flex-col bg-[#1C1D1F]">
        {activeTab === 'project' ? <ProjectPanel /> : <InspectorPanel />}
      </div>
    </aside>
  );
};
