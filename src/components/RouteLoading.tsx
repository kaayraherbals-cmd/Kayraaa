import Logo from './Logo';

/** Branded loading state for code-split screens (the back office). A thin progress line and quiet placeholder blocks, no spinner. */
export default function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-bar" aria-hidden="true" />
      <div className="route-loading-body" aria-hidden="true">
        <span className="route-loading-mark"><Logo kind="stacked" decorative priority /></span>
        <span className="route-loading-line" />
        <span className="route-loading-line route-loading-line--short" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
