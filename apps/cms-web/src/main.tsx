import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

const container = document.getElementById('root');
/*
 * A named failure rather than `!`.
 *
 * The non-null assertion turns a missing mount point into "Cannot read
 * properties of null", which sends whoever sees it looking for a bug in React.
 * The only way this happens is index.html losing the element, and saying so
 * costs one line.
 */
if (container === null) {
  throw new Error('No #root element in index.html — the application has nowhere to mount.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
