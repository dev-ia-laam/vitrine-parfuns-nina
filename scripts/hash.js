// Génère ADMIN_PASSWORD_HASH : node scripts/hash.js "mot-de-passe"
const crypto = require('crypto');
const pwd = process.argv[2];
if (!pwd) { console.error('Usage: node scripts/hash.js "mot-de-passe"'); process.exit(1); }
const h = crypto.createHash('sha256').update(pwd, 'utf8').digest('hex');
console.log('ADMIN_EMAIL=votre@email.com');
console.log(`ADMIN_PASSWORD_HASH=sha256:${h}`);
