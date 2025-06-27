import { createRoot } from 'react-dom/client';
import initLogger from './logger';
import App from './app';
initLogger();

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<App />);

// // calling IPC exposed from preload script
// window.electron?.ipcRenderer.once('ipc-example', (arg) => {
//   // eslint-disable-next-line no-console
//   console.log(arg);
// });
// window.electron?.ipcRenderer.sendMessage('ipc-example', ['ping']);
