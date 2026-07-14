import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {installDesktopBridge} from './lib/desktop';
import App from './App.tsx';
import './index.css';
import './highlight.css';

// Must run before the first render: useFileSystem checks `'electronAPI' in
// window` to pick the desktop backend over the Web File System Access API.
installDesktopBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
