import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { safeReturnPath } from '../../shared/returnPath';
import AuthShell from '../components/AuthShell';
import OAuthPanel from '../components/OAuthPanel';
import SignInForm from '../components/SignInForm';
import CreateAccountForm from '../components/CreateAccountForm';
import { authApi, useNoIndex, type SessionUser } from '../lib/auth';

export default function Login({ mode }: { mode: 'signin' | 'signup' }) {
  const signup = mode === 'signup';
  useNoIndex(signup ? 'Create an account | Kaayra Herbals' : 'Sign in | Kaayra Herbals');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const back = safeReturnPath(params.get('return'));
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let live = true;
    void authApi<SessionUser>('session').then((r) => {
      if (live && r.ok && r.data) setUser(r.data);
    });
    return () => {
      live = false;
    };
  }, []);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : (back ?? '/account')} replace />;

  return (
    <AuthShell>
      <div className="auth-card auth-surface">
        <nav className="seg" data-mode={mode} aria-label="Sign in or create an account" data-auth="1">
          <span className="seg-thumb" aria-hidden="true" />
          <Link to="/login" aria-current={signup ? undefined : 'page'} replace>
            Sign in
          </Link>
          <Link to="/signup" aria-current={signup ? 'page' : undefined} replace>
            Create account
          </Link>
        </nav>
        <div key={mode} className="swap" data-auth="2">
          <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">{signup ? 'Use your email, or continue with Google.' : 'Sign in with your email and password, or with Google.'}</p>
        </div>
        <div data-auth="3">
          <OAuthPanel intent="member" />
          <p className="auth-or" aria-hidden="true">
            <span>or with email</span>
          </p>
          {signup ? <CreateAccountForm onSignIn={() => navigate('/login')} /> : <SignInForm />}
          {signup && (
            <p className="field-hint auth-google-note">Signing up with Google? We will ask for your name and a password, so you can also sign in with your email later.</p>
          )}
          <p className="auth-switch">
            {signup ? (
              <>
                Already have an account? <Link to="/login">Sign in</Link>
              </>
            ) : (
              <>
                New here? <Link to="/signup">Create an account</Link>
              </>
            )}
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
