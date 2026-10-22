/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The one probe corpus (T-012 / T-013): about 60 fixtures, each with a single verdict that must hold at
 * every entry point (capture, export, chat, filing, Reporter, .eml). LEAKS carry the substring that must
 * be gone; KEEPS must come back byte for byte; NAMES are field names (capture side).
 */
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const pat = 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz\n-----END RSA PRIVATE KEY-----';

/** [id, text, the substring that must not survive] */
export const LEAKS = [
  ['card-ascii', 'paid with 4111111111111111 today', '4111111111111111'],
  ['card-spaced', 'card 4111 1111 1111 1111 declined', '4111 1111 1111 1111'],
  ['card-hyphen', 'card 5500-0055-5555-5559 declined', '5500-0055-5555-5559'],
  ['card-amex', 'amex 378734493671000 on file', '378734493671000'],
  ['card-arabic-indic', 'البطاقة ٤١١١ ١١١١ ١١١١ ١١١١ رُفضت', '٤١١١ ١١١١ ١١١١ ١١١١'],
  ['card-persian', 'کارت ۴۱۱۱۱۱۱۱۱۱۱۱۱۱۱۱', '۴۱۱۱۱۱۱۱۱۱۱۱۱۱۱۱'],
  ['card-fullwidth', 'card ４１１１１１１１１１１１１１１１ ok', '４１１１１１１１１１１１１１１１'],
  ['card-mixed-script', 'card ٥٥٠٠٠٠٥٥٥٥٥٥٥٥٥٩ declined', '٥٥٠٠٠٠٥٥٥٥٥٥٥٥٥٩'],
  ['card-in-har', JSON.stringify({ request: { postData: { text: 'pan=4111111111111111&exp=12/30' } } }), '4111111111111111'],
  ['iban-spaced', 'IBAN GB82 WEST 1234 5698 7654 32 saved', 'GB82 WEST 1234 5698 7654 32'],
  ['iban-de', 'IBAN DE89 3704 0044 0532 0130 00 saved', 'DE89 3704 0044 0532 0130 00'],
  ['iban-hyphen', 'IBAN DE89-3704-0044-0532-0130-00 saved', 'DE89-3704-0044-0532-0130-00'],
  ['iban-nbsp', 'IBAN GB82 WEST 1234 5698 7654 32 saved', 'GB82 WEST 1234 5698 7654 32'],
  ['iban-sa', 'IBAN SA03 8000 0000 6080 1016 7519 saved', 'SA03 8000 0000 6080 1016 7519'],
  ['iban-arabic-digits', 'IBAN GB٨٢ WEST ١٢٣٤ ٥٦٩٨ ٧٦٥٤ ٣٢ saved', '٨٢ WEST'],
  ['url-access-token', 'GET https://api.test/v1/me?access_token=ya29.a0AfH6SMBx1234abcd&x=1', 'ya29.a0AfH6SMBx1234abcd'],
  ['url-refresh-token', 'https://api.test/cb?refresh_token=1//0gAbCdEfGhIjK', '1//0gAbCdEfGhIjK'],
  ['url-id-token', 'https://app.test/#x?id_token=abcDEF123456', 'abcDEF123456'],
  ['url-api-key', 'https://maps.test/js?apikey=Zk93hd72HfQ0pLm1', 'Zk93hd72HfQ0pLm1'],
  ['url-api-underscore', 'https://maps.test/js?api_key=Zk93hd72HfQ0pLm1&v=3', 'Zk93hd72HfQ0pLm1'],
  ['url-aws-signature', 'https://b.s3.amazonaws.com/o?X-Amz-Signature=3f1a9c8b7d6e5f4a3b2c1d0e9f8a7b6c', '3f1a9c8b7d6e5f4a3b2c1d0e9f8a7b6c'],
  ['url-aws-credential', 'https://b.s3.amazonaws.com/o?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260930', 'AKIAIOSFODNN7EXAMPLE'],
  ['url-sig', 'https://cdn.test/f.png?sig=Ab12Cd34Ef56', 'Ab12Cd34Ef56'],
  ['har-url-token', JSON.stringify({ log: { entries: [{ request: { url: 'https://a.test/x?access_token=tok_8f7a6b5c4d3e' } }] } }), 'tok_8f7a6b5c4d3e'],
  ['postman-url-token', JSON.stringify({ item: [{ request: { url: { raw: 'https://a.test/x?access_token=tok_8f7a6b5c4d3e' } } }] }), 'tok_8f7a6b5c4d3e'],
  ['yaml-url-token', 'url: "https://a.test/x?refresh_token=tok_8f7a6b5c4d3e"', 'tok_8f7a6b5c4d3e'],
  ['aws-key', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['aws-temp-key', 'key ASIAIOSFODNN7EXAMPLE in env', 'ASIAIOSFODNN7EXAMPLE'],
  ['github-pat-classic', `git clone https://x:${pat}@github.com/o/r`, pat],
  ['github-pat-bare', `token is ${pat} sorry`, pat],
  ['github-pat-fine', 'github_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz0123456789ABCDEFGHIJ', 'github_pat_11ABCDEFG0abcdefghij'],
  ['gitlab-pat', 'use glpat-abcdefghij1234567890 here', 'glpat-abcdefghij1234567890'],
  ['slack-token', 'xoxb-123456789012-abcdefghijklmnop', 'xoxb-123456789012-abcdefghijklmnop'],
  ['google-key', 'key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q', 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
  ['basic-header', 'Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==', 'dXNlcjpwYXNzd29yZDEyMw'],
  ['basic-bare', 'curl -H "Basic dXNlcjpwYXNzd29yZDEyMw=="', 'dXNlcjpwYXNzd29yZDEyMw'],
  ['basic-postman', JSON.stringify({ header: [{ key: 'Authorization', value: 'Basic dXNlcjpwYXNzd29yZDEyMw==' }] }), 'dXNlcjpwYXNzd29yZDEyMw'],
  ['basic-yaml', 'authorization: Basic dXNlcjpwYXNzd29yZDEyMw==', 'dXNlcjpwYXNzd29yZDEyMw'],
  ['jwt-bare', `session ${jwt}`, jwt],
  ['jwt-har', JSON.stringify({ headers: [{ name: 'x-custom', value: jwt }] }), jwt],
  ['bearer-header', 'Authorization: Bearer abcdef0123456789ABCDEF', 'abcdef0123456789ABCDEF'],
  ['private-key', `here:\n${pem}`, 'MIIEowIBAAKCAQEAxyz'],
  ['stripe-live-key', 'Bearer sk-live_51H8xQ2eZvKYlo2C0abcdef', 'sk-live_51H8xQ2eZvKYlo2C0abcdef'],
  // sdlc-1014 S-03: vendor shapes the first scan missed (values built in each vendor's documented shape)
  ['mailgun-key', 'mailgun key-0123456789abcdef0123456789abcdef sent', 'key-0123456789abcdef0123456789abcdef'],
  ['dropbox-sl', 'dropbox sl.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIj failed', 'sl.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIj'],
  ['discord-bot', 'bot MTAxMjM0NTY3ODkwMTIzNDU2.GhIjKl.AbCdEfGhIjKlMnOpQrStUvWxYz0 failed', 'MTAxMjM0NTY3ODkwMTIzNDU2.GhIjKl.AbCdEfGhIjKlMnOpQrStUvWxYz0'],
  ['firebase-server-key', `fcm AAAAabcdEFG:APA91b${'x'.repeat(40)}${'Y'.repeat(70)} failed`, 'APA91b'],
  ['redis-empty-user', 'REDIS_URL redis://:Pa55w0rdValue@cache:6379', 'Pa55w0rdValue'],
];

/** [id, text]: returned unchanged. */
export const KEEPS = [
  ['stripe-test-4242', 'paid with 4242 4242 4242 4242 (test)'],
  ['stripe-test-visa-debit', 'card 4000056655665556 accepted'],
  ['stripe-test-mc', 'card 5555-5555-5555-4444 accepted'],
  ['stripe-test-amex', 'amex 378282246310005 accepted'],
  ['stripe-test-arabic-indic', 'البطاقة التجريبية ٤٢٤٢ ٤٢٤٢ ٤٢٤٢ ٤٢٤٢'],
  ['order-number', 'order 38202600015 was rejected'],
  ['timestamp', 'started at 1788019200000 ms'],
  ['http-status', 'HTTP 500 on /api/applications'],
  ['version', 'version 3.1.0 build 20260904'],
  ['not-luhn-16', 'reference 2026090412345678 not found'],
  ['plain-url', 'https://shop.test/cart?page=2&sort=price'],
  ['url-key-param', 'https://maps.test/embed?key=maps&zoom=4'],
  ['url-signup-param', 'https://app.test/?signup=1&sigma=2'],
  ['url-code-param', 'https://app.test/cb?code=200&state=ok'],
  ['word-token', 'refresh the token list and retry'],
  ['word-basic', 'Basic information form, Basic plan'],
  ['word-author', 'author=Smith and authorName=Lee'],
  ['arabic-prose', 'فشل إرسال الطلب بعد الضغط على زر التقديم'],
  ['arabic-digits-short', 'الصفحة ٣ من ١٢'],
  ['iban-lookalike', 'ref GB12 ABCD not an account'],
  ['hex-sha', 'commit 3f1a9c8b7d6e5f4a3b2c1d0e9f8a7b6c'],
  ['data-url-payload', '@font-face{src:url(data:font/woff2;base64,d09GMgABAAAAAAmwAA4AAAAAFhwAAAlXAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbHhwcNgZgAIEeCoIQbIEiATYCJAOBFAQGBYcZByAbVxRRlHJOASD8fwj5H0gTkdJ7P9L+X3eC);}'],
  // R-01 (sdlc-1014): the failing request's URL is the product's evidence; words and joined hex are not keys.
  ['url-path-long-id', '| 500 | GET | https://api.example.com/v1/checkout/sessions/cs_test_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV | 312 ms |'],
  ['url-path-slug', 'GET https://shop.example.com/products/category/electronics/laptops/gaming/high-end-models/2026-edition?page=2 -> 404'],
  ['url-path-camel', 'POST https://app.example.com/api/v2/organisations/Acme-Holdings-International/projects/Roadmap2026Q4/tasks -> 422'],
  ['camel-identifier', 'at ThisIsAVeryLongComponentNameForTheCheckoutWidgetV2 (app.js:1)'],
  ['snake-constant', 'QAWRAP_SESSION_ID_FOR_CHECKOUT_FLOW_TEST_2026 is not set'],
  ['joined-uuids', 'ids 9b2f6a3e-1c4d-4e8a-9f7b-2d5c8e1a3b4c-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'],
  ['iso-date', 'Failed on 2026-10-14 in checkout'],
  ['dotted-date', 'Due 14.10.2026 reached'],
  ['ipv4', 'connect ECONNREFUSED 192.168.100.200:8080'],
  ['browser-version', 'chrome 130.0.6723.92 build'],
  ['email-default', 'signed in as layla@example.com'],
  ['json-plain', JSON.stringify({ log: { entries: [{ request: { url: 'https://a.test/x?page=2' } }] } })],
  ['placeholder', 'password=«redacted» token=••••••••'],
  ['yaml-plain', 'url: "https://a.test/x?sort=asc"'],
];

/** Field names: [name, isSecret]. The capture side (page-hooks and recorder) shares this. */
export const NAMES = [
  ['password', true], ['userPassword', true], ['access_token', true], ['Authorization', true], ['x-api-key', true],
  ['session_id', true], ['Set-Cookie', true], ['cardNumber', true], ['CVV', true], ['iban', true], ['client_secret', true],
  ['otp', true], ['pin', true], ['ssn', true], ['authToken', true], ['APIKey', true],
  // the twelve that were redacted for no reason
  ['author', false], ['authorName', false], ['typing', false], ['spinner', false], ['shippingAddress', false], ['discard', false],
  ['passenger', false], ['compass', false], ['cardinality', false], ['pinned', false], ['opinion', false], ['tokenizer', false],
];
