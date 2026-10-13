import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { installScrollbarActivity } from './lib/scrollbars';
import '@fontsource-variable/inter';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource-variable/noto-sans-mono';
import './index.css';

installScrollbarActivity();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
