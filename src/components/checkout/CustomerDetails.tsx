import type { AddressErrors } from '../../../shared/checkout';

export interface DetailsValue {
  name: string;
  phone: string;
}

/** Who receives the order. The email is the signed-in account's and is shown, not edited here. */
export default function CustomerDetails({ email, value, errors, onChange }: { email: string; value: DetailsValue; errors: AddressErrors; onChange: (v: DetailsValue) => void }) {
  return (
    <fieldset className="co-fieldset">
      <legend className="co-legend">Contact</legend>
      <p className="co-note">Order updates go to <strong>{email}</strong>.</p>
      <div className="field">
        <label htmlFor="co-name">Full name</label>
        <input id="co-name" name="name" type="text" autoComplete="name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} aria-invalid={errors.name ? 'true' : undefined} aria-describedby={errors.name ? 'co-name-err' : undefined} maxLength={80} />
        {errors.name && <p id="co-name-err" className="field-error">{errors.name}</p>}
      </div>
      <div className="field">
        <label htmlFor="co-phone">Mobile number</label>
        <input id="co-phone" name="phone" type="text" inputMode="tel" autoComplete="tel-national" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} aria-invalid={errors.phone ? 'true' : undefined} aria-describedby={errors.phone ? 'co-phone-err' : 'co-phone-hint'} maxLength={20} />
        <p id="co-phone-hint" className="field-hint">10-digit Indian mobile, for the courier.</p>
        {errors.phone && <p id="co-phone-err" className="field-error">{errors.phone}</p>}
      </div>
    </fieldset>
  );
}
