import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './advanced.css';
import './dialogs.css';
// Inter (SIL OFL) stands in for San Francisco, which Apple licenses only for its own platforms.
import '@fontsource-variable/inter/opsz.css';
import './macos.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
