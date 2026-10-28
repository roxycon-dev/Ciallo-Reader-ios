import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StartupGate } from '@ui/shell/StartupGate';
import './styles/global.css';
import './styles/theme.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <StartupGate><App /></StartupGate>
  </StrictMode>,
);
