import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Story from './pages/Story';
import Founders from './pages/Founders';
import Approach from './pages/Approach';
import Ingredients from './pages/Ingredients';
import Quality from './pages/Quality';
import Journal from './pages/Journal';
import JournalArticle from './pages/JournalArticle';
import ProductDevelopment from './pages/ProductDevelopment';
import Contact from './pages/Contact';
import Privacy from './pages/Privacy';
import Legal from './pages/Legal';
import NotFound from './pages/NotFound';
import Login from './pages/Login';
import Account from './pages/Account';
import ForgotPassword from './pages/ForgotPassword';
import SetPassword from './pages/SetPassword';
import Collection from './pages/Collection';
import ProductDetail from './pages/ProductDetail';
import MedicalDisclaimer from './pages/MedicalDisclaimer';
import ReportProblem from './pages/ReportProblem';
import Subscription from './pages/Subscription';
import Bag from './pages/Bag';
import Wishlist from './pages/Wishlist';
import Bundles from './pages/Bundles';
import TrackOrder from './pages/TrackOrder';
import Checkout from './pages/Checkout';

// Admin is code-split so it never adds weight to the public site.
const Admin = lazy(() => import('./pages/Admin'));

export default function App() {
  return (
    <Routes>
      <Route
        path="admin"
        element={
          <Suspense fallback={<p className="pad-2">Loading…</p>}>
            <Admin />
          </Suspense>
        }
      />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="our-story" element={<Story />} />
        <Route path="founders" element={<Founders />} />
        <Route path="our-approach" element={<Approach />} />
        <Route path="ingredients" element={<Ingredients />} />
        <Route path="quality-and-transparency" element={<Quality />} />
        <Route path="journal" element={<Journal />} />
        <Route path="journal/:slug" element={<JournalArticle />} />
        <Route path="collection" element={<Collection />} />
        <Route path="collection/:slug" element={<ProductDetail />} />
        <Route path="medical-disclaimer" element={<MedicalDisclaimer />} />
        <Route path="product-development" element={<ProductDevelopment />} />
        <Route path="contact" element={<Contact />} />
        <Route path="login" element={<Login mode="signin" />} />
        <Route path="signup" element={<Login mode="signup" />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="set-password" element={<SetPassword />} />
        <Route path="account" element={<Account />} />
        <Route path="report-a-problem" element={<ReportProblem />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="bag" element={<Bag />} />
        <Route path="wishlist" element={<Wishlist />} />
        <Route path="bundles" element={<Bundles />} />
        <Route path="track-order" element={<TrackOrder />} />
        <Route path="track-order/:id" element={<TrackOrder />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="legal" element={<Legal />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
