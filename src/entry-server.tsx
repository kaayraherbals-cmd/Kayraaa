import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import App from './App';
import { SessionProvider } from './lib/session';

export function render(url: string): string {
  return renderToString(
    <StaticRouter location={url}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </StaticRouter>,
  );
}
