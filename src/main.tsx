// Self-hosted fonts (bundled by Vite, no third-party requests; the CSP only allows 'self').
// Three voices, each with one job:
//   Fraunces (variable, weight axis + italic): headlines, wordmark, product names, prices
//   Instrument Sans (variable, weights 400-700): body, interface, navigation, buttons and small labels
//   Noto Serif Devanagari (variable): Sanskrit and Hindi accents
import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/noto-serif-devanagari';
import './styles/tokens.css';
import './styles/legacy.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/home.css';
import './styles/founders-showcase.css';
import './styles/shop.css';
import './styles/bag.css';
import './styles/account.css';
import './styles/pages.css';
import './styles/reviews.css';
import './styles/ai.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './lib/session';
import { CartProvider } from './lib/cart';

const container = document.getElementById('root')!;
const tree = (
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>
);

if (container.firstElementChild) hydrateRoot(container, tree);
else createRoot(container).render(tree);

document.documentElement.dataset.ready = '1';
