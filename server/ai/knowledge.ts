/**
 * Facts the customer assistant may state about the shop, each true of the code as it stands. It has NO invented policy text: anything not
 * listed here (return windows, delivery times, refund timelines) is answered with "that is not published, please contact the team".
 * When the owner publishes a policy, add its approved wording here, word for word.
 */
export const SITE_FACTS: readonly string[] = [
  'Whether Kaayra can deliver to a PIN code is checked at checkout (and by the assistant when a customer types a PIN code).',
  'Orders are paid online at checkout through Razorpay; the payment options on offer are shown at checkout.',
  'A customer can create an account or sign in from the Your account link, and reset a forgotten password from the Forgot password link on the sign-in page.',
  'A problem with an order or product can be reported on the Report a problem page, and order progress is shown under Track order.',
  'Prices, pack sizes and stock for each product are shown on its product page.',
  'Signed-in customers can see their orders and track shipments under Track order.',
  'Refund requests are reviewed by the Kaayra team; the customer is told the decision.',
  'Kaayra products are described using approved information only; the Medical disclaimer page explains that products are not a substitute for medical advice.',
];

export const SITE_LINKS: readonly { label: string; path: string }[] = [
  { label: 'Shop', path: '/collection' },
  { label: 'Track order', path: '/track-order' },
  { label: 'Your account', path: '/account' },
  { label: 'Contact', path: '/contact' },
  { label: 'Report a problem', path: '/report-a-problem' },
  { label: 'Medical disclaimer', path: '/medical-disclaimer' },
  { label: 'Quality and transparency', path: '/quality-and-transparency' },
];
