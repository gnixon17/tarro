import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Customer from './pages/Customer';
import Barista from './pages/Barista';
import Owner from './pages/Owner';
import Settings from './pages/Settings';

export default function App() {
  const [configStatus, setConfigStatus] = useState<{ supabase: boolean; elevenLabs: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/config-status')
      .then(res => res.json())
      .then(data => setConfigStatus(data))
      .catch(err => console.error('Failed to fetch config status:', err));
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
        {configStatus && (!configStatus.supabase || !configStatus.elevenLabs) && (
          <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 text-sm text-amber-800 flex justify-center items-center gap-4">
            <span className="font-semibold">⚠️ Configuration Warning:</span>
            <div className="flex gap-4">
              {!configStatus.supabase && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  Supabase (Using Dummy DB)
                </span>
              )}
              {!configStatus.elevenLabs && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                  ElevenLabs (Using Mock TTS)
                </span>
              )}
            </div>
          </div>
        )}
        <nav className="bg-white border-b border-stone-200 px-4 py-3 flex justify-between items-center shadow-sm">
          <div className="font-bold text-lg tracking-tight">NYC Coffee AI</div>
          <div className="flex gap-4 text-sm font-medium">
            <Link to="/" className="hover:text-amber-600 transition-colors">Customer Kiosk</Link>
            <Link to="/barista" className="hover:text-amber-600 transition-colors">Barista KDS</Link>
            <Link to="/owner" className="hover:text-amber-600 transition-colors">Owner Dashboard</Link>
            <Link to="/settings" className="hover:text-amber-600 transition-colors">Settings</Link>
          </div>
        </nav>
        <main className="p-4 md:p-8 max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Customer />} />
            <Route path="/barista" element={<Barista />} />
            <Route path="/owner" element={<Owner />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
