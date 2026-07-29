import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {installDesktopBridge} from './lib/desktop';
import {installInsetSync} from './lib/insets';
import {dismissSplash} from './lib/splash';
import App from './App.tsx';
import './index.css';
import './highlight.css';

// Must run before the first render: useFileSystem checks `'electronAPI' in
// window` to pick the desktop backend over the Web File System Access API.
installDesktopBridge();

// Also before the first render: --vx-inset-* decides how much of the screen
// the app root may use, and setting it afterwards would land the first paint
// under the status bar and then jump.
installInsetSync();

// App's mount effect is what normally swaps the splash for the real window;
// this is the backstop for a render that throws — better a broken window than
// no window at all.
setTimeout(() => { void dismissSplash(); }, 8000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
