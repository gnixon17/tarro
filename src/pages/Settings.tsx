import { useState } from 'react';
import { Settings as SettingsIcon, Mic, Users, Play, RefreshCw, AlertTriangle } from 'lucide-react';
import VoiceSettings from './VoiceSettings';
import TestRunner from './TestRunner';
import Regulars from './Regulars';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'voice' | 'tests' | 'regulars' | 'general'>('voice');

  const handleRestart = () => {
    if (confirm("Are you sure you want to restart the experience? This will reset all local settings to default values and reload the application.")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold font-serif text-stone-900">Settings</h1>
        <p className="text-stone-500 mt-1">Configure the AI, manage data, and run tests.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <div className="w-full lg:w-64 flex-shrink-0">
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden sticky top-4">
            <nav className="flex flex-col p-2 space-y-1">
              <button
                onClick={() => setActiveTab('voice')}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'voice' 
                    ? 'bg-amber-50 text-amber-900' 
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <Mic className="w-4 h-4" />
                Voice Tuning
              </button>
              
              <button
                onClick={() => setActiveTab('tests')}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'tests' 
                    ? 'bg-amber-50 text-amber-900' 
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <Play className="w-4 h-4" />
                Test Runner
              </button>
              
              <button
                onClick={() => setActiveTab('regulars')}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'regulars' 
                    ? 'bg-amber-50 text-amber-900' 
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <Users className="w-4 h-4" />
                Regulars
              </button>

              <div className="h-px bg-stone-100 my-2" />

              <button
                onClick={() => setActiveTab('general')}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'general' 
                    ? 'bg-amber-50 text-amber-900' 
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <SettingsIcon className="w-4 h-4" />
                General
              </button>
            </nav>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0">
          {activeTab === 'voice' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              <VoiceSettings />
            </div>
          )}
          
          {activeTab === 'tests' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              <TestRunner />
            </div>
          )}
          
          {activeTab === 'regulars' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              <Regulars />
            </div>
          )}

          {activeTab === 'general' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
              <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-red-100 rounded-lg text-red-600">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900">Danger Zone</h3>
                    <p className="text-sm text-stone-500">Reset the application to its initial state.</p>
                  </div>
                </div>
                
                <div className="bg-stone-50 p-4 rounded-lg border border-stone-200 mb-6">
                  <p className="text-sm text-stone-600">
                    This will clear all local configuration, including:
                  </p>
                  <ul className="list-disc list-inside text-sm text-stone-600 mt-2 ml-2 space-y-1">
                    <li>Voice tuning parameters (FFT size, thresholds)</li>
                    <li>Custom API keys stored in the browser</li>
                    <li>Any other locally cached preferences</li>
                  </ul>
                  <p className="text-sm text-stone-600 mt-2 font-medium">
                    It will NOT delete customer data or orders from the database.
                  </p>
                </div>

                <button 
                  onClick={handleRestart}
                  className="flex items-center gap-2 bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Restart Experience
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
