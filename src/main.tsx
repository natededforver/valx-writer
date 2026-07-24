import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {installDesktopBridge} from './lib/desktop';
import {dismissSplash} from './lib/splash';
import App from './App.tsx';
import './index.css';
import './highlight.css';

// Must run before the first render: useFileSystem checks `'electronAPI' in
// window` to pick the desktop backend over the Web File System Access API.
installDesktopBridge();

// App's mount effect is what normally swaps the splash for the real window;
// this is the backstop for a render that throws — better a broken window than
// no window at all.
setTimeout(() => { void dismissSplash(); }, 8000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
