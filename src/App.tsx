import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Customer from './pages/Customer';
import Barista from './pages/Barista';
import Owner from './pages/Owner';
import Settings from './pages/Settings';
import Regulars from './pages/Regulars';
import VoiceSettings from './pages/VoiceSettings';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
        <nav className="bg-white border-b border-stone-200 px-4 py-3 flex justify-between items-center shadow-sm">
          <div className="font-bold text-lg tracking-tight">NYC Coffee AI</div>
          <div className="flex gap-4 text-sm font-medium">
            <Link to="/" className="hover:text-amber-600 transition-colors">Customer Kiosk</Link>
            <Link to="/barista" className="hover:text-amber-600 transition-colors">Barista KDS</Link>
            <Link to="/owner" className="hover:text-amber-600 transition-colors">Owner Dashboard</Link>
            <Link to="/regulars" className="hover:text-amber-600 transition-colors">Regulars</Link>
            <Link to="/settings" className="hover:text-amber-600 transition-colors">Test Runner</Link>
            <Link to="/voice-settings" className="hover:text-amber-600 transition-colors">Voice Tuning</Link>
          </div>
        </nav>
        <main className="p-4 md:p-8 max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Customer />} />
            <Route path="/barista" element={<Barista />} />
            <Route path="/owner" element={<Owner />} />
            <Route path="/regulars" element={<Regulars />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/voice-settings" element={<VoiceSettings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
