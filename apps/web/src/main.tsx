import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary, { CrashTrigger } from './components/ui/ErrorBoundary';
import { initErrorReporting } from './observability';
import './styles/globals.css';

initErrorReporting();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {import.meta.env.DEV && <CrashTrigger />}
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
