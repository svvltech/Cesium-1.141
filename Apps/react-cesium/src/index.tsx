// CESIUM_BASE_URL must be set BEFORE any Cesium import
(window as any).CESIUM_BASE_URL = './';

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// @ts-ignore
import "cesium/Source/Widgets/widgets.css";
// @ts-ignore
import "./index.css";

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');
const root = createRoot(rootElement);
root.render(<App />);
