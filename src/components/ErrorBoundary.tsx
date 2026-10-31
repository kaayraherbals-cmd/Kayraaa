import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; resetKey?: string }
interface State { failed: boolean; key?: string }

/**
 * One safety net for the whole site: if any component throws while rendering, the visitor sees a calm message and a way home
 * instead of a blank page. It resets when the route changes (resetKey), so one broken page never blocks the rest of the site.
 * Nothing is sent anywhere; the error goes to the browser console only.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="pad-2" role="alert">
        <h1>Something went wrong on this page</h1>
        <p>Please try again. If it keeps happening, go back to the home page or contact us.</p>
        <p>
          <a href="/">Back to the home page</a>
        </p>
      </main>
    );
  }
}
