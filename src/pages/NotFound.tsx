import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="section">
      <div className="wrap measure">
        <h1>Page not found.</h1>
        <p className="lede my-15-2">The page you are looking for does not exist or has moved.</p>
        <Link className="btn" to="/">Back to home</Link>
      </div>
    </section>
  );
}
