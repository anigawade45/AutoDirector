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
    <aside className="w-80 border-r border-surfaceBorder bg-surface flex flex-col h-full select-none text-xs">
      {/* Top Tab Bar: Project vs Inspector */}
      <div className="h-12 border-b border-surfaceBorder px-2 flex items-center bg-[#070A10]/60">
        <button
          onClick={() => setActiveTab('project')}
          className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center space-x-2 font-medium transition-all ${
            activeTab === 'project'
              ? 'bg-surface text-blue-400 border border-surfaceBorder shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Project & Media</span>
        </button>

        <button
          onClick={() => setActiveTab('inspector')}
          className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center space-x-2 font-medium transition-all ${
            activeTab === 'inspector'
              ? 'bg-surface text-blue-400 border border-surfaceBorder shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Inspector</span>
          {layerCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 text-[10px] flex items-center justify-center font-mono">
              {layerCount}
            </span>
          )}
        </button>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'project' ? <ProjectPanel /> : <InspectorPanel />}
      </div>
    </aside>
  );
};

