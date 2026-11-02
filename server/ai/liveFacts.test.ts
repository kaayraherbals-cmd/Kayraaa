import { describe, expect, it } from 'vitest';
import { contactFacts, pinsIn } from './liveFacts.js';

describe('Kaayra AI: live facts', () => {
  it('finds a 6-digit PIN code in a message, ignoring phone numbers and longer numbers', () => {
    expect(pinsIn('Do you deliver to 221001?')).toEqual(['221001']);
    expect(pinsIn('call 9876543210 or ship to 110001 and 400001')).toEqual(['110001', '400001']);
    expect(pinsIn('order number 12345678')).toEqual([]);
    expect(pinsIn('pin 012345')).toEqual([]);
  });
  it('gives contact details only when the owner has set them', () => {
    expect(contactFacts({})).toEqual({});
    expect(contactFacts({ VITE_CONTACT_EMAIL: ' hello@kaayra.in ', VITE_CONTACT_PHONE: '', VITE_CONTACT_ADDRESS: 'Varanasi' })).toEqual({ email: 'hello@kaayra.in', address: 'Varanasi' });
  });
});
