import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// No StrictMode on purpose: its dev double-mount would create (and tear down)
// a second WebGL context + full terrain board on every load.
createRoot(document.getElementById('root')).render(<App />);
