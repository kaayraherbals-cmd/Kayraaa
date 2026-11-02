import { company } from '../config/site';

/** Company registration facts for the Legal page. Kept out of the page file on purpose: the AI site-knowledge builder reads page files only,
 *  and these facts are already given to it, with their values, from src/config/site.ts (scripts/build-site-knowledge.mjs). */
export default function BusinessDetails() {
  return (
    <>
      <h2>Business details</h2>
      <dl className="prose-facts">
        <dt>Legal name</dt><dd>{company.displayName}</dd>
        <dt>Corporate Identity Number (CIN)</dt><dd>{company.cin}</dd>
        <dt>GSTIN</dt><dd>{company.gstin}</dd>
        <dt>Registered in</dt><dd>{company.registeredLocation}</dd>
      </dl>
    </>
  );
}
