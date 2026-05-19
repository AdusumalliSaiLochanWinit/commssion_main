import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

const root = document.getElementById('root');

// Hide the index.html boot loader the instant React is ready to render —
// React's createRoot will replace #root's children, but explicitly removing
// avoids a one-frame flash and keeps screen-readers from announcing the
// loader twice.
const bootLoader = document.getElementById('initial-loader');
if (bootLoader) bootLoader.remove();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{
        duration: 3000,
        style: { borderRadius: '8px', background: '#1e293b', color: '#f8fafc', fontSize: '14px' }
      }} />
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
