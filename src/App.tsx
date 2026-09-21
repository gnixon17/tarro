import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StoreProvider } from './state/StoreContext';
import Dashboard from './pages/Dashboard';
import Positions from './pages/Positions';
import TickerDetail from './pages/TickerDetail';
import Simulator from './pages/Simulator';
import Scenarios from './pages/Scenarios';
import Accounts from './pages/Accounts';
import Instruments from './pages/Instruments';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/positions" element={<Positions />} />
            <Route path="/ticker/:symbol" element={<TickerDetail />} />
            <Route path="/simulate" element={<Simulator />} />
            <Route path="/simulate/:scenarioId" element={<Simulator />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/instruments" element={<Instruments />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </StoreProvider>
  );
}
