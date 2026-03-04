import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Settings2, Save, RefreshCw, Trash2 } from 'lucide-react';
import { AudioFingerprinter, FingerprintConfig } from '../utils/audioFingerprint';

const DEFAULT_CONFIG: FingerprintConfig & { similarityThreshold: number } = {
  fftSize: 256,
  smoothingTimeConstant: 0.85,
  minVolume: 10,
  similarityThreshold: 0.96
};

export default function VoiceSettings() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [isRecording, setIsRecording] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  
  const fingerprinterRef = useRef<AudioFingerprinter | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('voice_config');
    if (saved) {
      try {
        setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
      } catch (e) {}
    }
  }, []);

  const saveConfig = () => {
    localStorage.setItem('voice_config', JSON.stringify(config));
    alert("Settings saved! They will be used in the Customer Kiosk.");
  };

  const resetConfig = () => {
    setConfig(DEFAULT_CONFIG);
    localStorage.removeItem('voice_config');
  };

  const clearAllProfiles = async () => {
    if (!confirm("Are you sure you want to delete all saved voice profiles? This cannot be undone.")) return;
    try {
      await fetch('/api/customers', { method: 'DELETE' });
      alert("All voice profiles cleared.");
    } catch (e) {
      alert("Failed to clear profiles.");
    }
  };

  const testVoice = async () => {
    if (isRecording) {
      setIsRecording(false);
      const fingerprint = fingerprinterRef.current?.getFingerprint();
      fingerprinterRef.current?.stop();
      
      if (!fingerprint) {
        alert("No voice detected. Try speaking louder.");
        setIsTesting(false);
        return;
      }

      try {
        const res = await fetch('/api/identify-voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            fingerprint, 
            threshold: config.similarityThreshold,
            returnAllScores: true 
          })
        });
        const data = await res.json();
        setTestResults(data);
      } catch (e) {
        console.error(e);
        alert("Failed to test voice.");
      }
      setIsTesting(false);
    } else {
      setIsTesting(true);
      setTestResults(null);
      // Re-initialize with current config settings before testing
      localStorage.setItem('voice_config', JSON.stringify(config));
      fingerprinterRef.current = new AudioFingerprinter();
      
      try {
        await fingerprinterRef.current.start();
        setIsRecording(true);
      } catch (e) {
        alert("Microphone access denied.");
        setIsTesting(false);
      }
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold font-serif text-stone-900">Voice Tuning</h1>
          <p className="text-stone-500 mt-1">Fine-tune the FFT parameters and similarity thresholds.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={resetConfig}
            className="flex items-center gap-2 bg-stone-200 text-stone-700 px-4 py-2 rounded-lg font-medium hover:bg-stone-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reset
          </button>
          <button 
            onClick={saveConfig}
            className="flex items-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-stone-800 transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Settings
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6 bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-stone-100 pb-4">
            <Settings2 className="w-5 h-5 text-stone-500" />
            <h2 className="text-lg font-bold text-stone-800">FFT Parameters</h2>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              FFT Size <span className="text-stone-400 font-normal">(Resolution)</span>
            </label>
            <select 
              value={config.fftSize}
              onChange={e => setConfig({...config, fftSize: parseInt(e.target.value)})}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
            >
              <option value={128}>128 (Fast, Low Res)</option>
              <option value={256}>256 (Default)</option>
              <option value={512}>512 (High Res)</option>
              <option value={1024}>1024 (Very High Res)</option>
            </select>
            <p className="text-xs text-amber-600 mt-1">Warning: Changing this requires re-enrolling voices.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Smoothing Time Constant: {config.smoothingTimeConstant}
            </label>
            <input 
              type="range" min="0" max="0.99" step="0.01"
              value={config.smoothingTimeConstant}
              onChange={e => setConfig({...config, smoothingTimeConstant: parseFloat(e.target.value)})}
              className="w-full accent-amber-500"
            />
            <p className="text-xs text-stone-500 mt-1">Higher = smoother, less jittery spectrum.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Silence Threshold (Min Volume): {config.minVolume}
            </label>
            <input 
              type="range" min="0" max="50" step="1"
              value={config.minVolume}
              onChange={e => setConfig({...config, minVolume: parseInt(e.target.value)})}
              className="w-full accent-amber-500"
            />
            <p className="text-xs text-stone-500 mt-1">Ignores frames quieter than this to avoid recording background noise.</p>
          </div>

          <div className="pt-4 border-t border-stone-100">
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Similarity Threshold: {config.similarityThreshold}
            </label>
            <input 
              type="range" min="0.5" max="1.0" step="0.01"
              value={config.similarityThreshold}
              onChange={e => setConfig({...config, similarityThreshold: parseFloat(e.target.value)})}
              className="w-full accent-amber-500"
            />
            <p className="text-xs text-stone-500 mt-1">Minimum Cosine Similarity score required for a match (1.0 is perfect).</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
            <h2 className="text-lg font-bold text-stone-800 mb-4">Test Voice Match</h2>
            <p className="text-sm text-stone-600 mb-6">
              Record your voice to see how it scores against all saved profiles using the current settings.
            </p>
            
            <div className="flex justify-center mb-6">
              <button
                onClick={testVoice}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-md ${isRecording ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-stone-900 text-white hover:bg-stone-800'}`}
              >
                {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
            </div>
            {isRecording && <p className="text-center text-sm text-red-500 animate-pulse">Recording... click to stop and analyze.</p>}

            {testResults && (
              <div className="mt-6 border-t border-stone-100 pt-4">
                <div className={`p-3 rounded-lg mb-4 text-center font-bold ${testResults.match ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                  {testResults.match 
                    ? `Match Found: ${testResults.bestMatchName} (${testResults.bestScore.toFixed(4)})` 
                    : `No Match (Best: ${testResults.bestMatchName || 'None'} at ${testResults.bestScore.toFixed(4)})`}
                </div>
                
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">All Scores</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {testResults.allScores?.length === 0 && <p className="text-sm text-stone-500">No profiles saved.</p>}
                  {testResults.allScores?.map((s: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm p-2 bg-stone-50 rounded">
                      <span className="font-medium">{s.name}</span>
                      <span className={`font-mono ${s.score >= config.similarityThreshold ? 'text-emerald-600 font-bold' : 'text-stone-500'}`}>
                        {s.score.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-red-50 p-6 rounded-xl border border-red-100 shadow-sm">
            <h2 className="text-lg font-bold text-red-800 mb-2">Danger Zone</h2>
            <p className="text-sm text-red-600 mb-4">
              If you change the FFT Size, old voice profiles will no longer match correctly. You can clear them here.
            </p>
            <button 
              onClick={clearAllProfiles}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors text-sm"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Voice Profiles
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
