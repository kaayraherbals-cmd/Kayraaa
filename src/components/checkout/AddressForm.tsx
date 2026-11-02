import { INDIAN_STATES, type AddressErrors } from '../../../shared/checkout';

export interface AddressValue {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

/** Delivery address. Shape is checked here for convenience and again, authoritatively, on the server. */
export default function AddressForm({ value, errors, onChange }: { value: AddressValue; errors: AddressErrors; onChange: (v: AddressValue) => void }) {
  const set = (k: keyof AddressValue) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const bad = (k: keyof AddressValue) => (errors[k] ? ({ 'aria-invalid': 'true', 'aria-describedby': `co-${k}-err` } as const) : {});
  const err = (k: keyof AddressValue) => (errors[k] ? <p id={`co-${k}-err`} className="field-error">{errors[k]}</p> : null);
  return (
    <fieldset className="co-fieldset">
      <legend className="co-legend">Delivery address</legend>
      <div className="field">
        <label htmlFor="co-line1">House, flat and street</label>
        <input id="co-line1" name="line1" type="text" autoComplete="address-line1" value={value.line1} onChange={set('line1')} maxLength={120} {...bad('line1')} />
        {err('line1')}
      </div>
      <div className="field">
        <label htmlFor="co-line2">Area or landmark <span className="co-opt">(optional)</span></label>
        <input id="co-line2" name="line2" type="text" autoComplete="address-line2" value={value.line2} onChange={set('line2')} maxLength={120} {...bad('line2')} />
        {err('line2')}
      </div>
      <div className="co-row">
        <div className="field">
          <label htmlFor="co-pincode">PIN code</label>
          <input id="co-pincode" name="pincode" type="text" inputMode="numeric" autoComplete="postal-code" value={value.pincode} onChange={set('pincode')} maxLength={6} {...bad('pincode')} />
          {err('pincode')}
        </div>
        <div className="field">
          <label htmlFor="co-city">Town or city</label>
          <input id="co-city" name="city" type="text" autoComplete="address-level2" value={value.city} onChange={set('city')} maxLength={60} {...bad('city')} />
          {err('city')}
        </div>
      </div>
      <div className="field">
        <label htmlFor="co-state">State or union territory</label>
        <select id="co-state" name="state" autoComplete="address-level1" value={value.state} onChange={set('state')} {...bad('state')}>
          <option value="">Choose…</option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {err('state')}
      </div>
    </fieldset>
  );
}
