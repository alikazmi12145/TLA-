/* Usage:
 *   node src/scripts/set-logo.js <filename-inside-uploads/logo>
 * Example:
 *   node src/scripts/set-logo.js tla-logo.png
 *
 * Sets Setting.logoUrl to /uploads/logo/<filename>.
 * After this, regenerate any payslip (e.g.
 *   node src/scripts/generate-zain-may-2026.js
 * ) and the new logo will appear in the header band.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Setting = require('../models/Setting');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Pass the logo filename, e.g. node src/scripts/set-logo.js tla-logo.png');
    process.exit(1);
  }
  const abs = path.join(process.cwd(), 'uploads', 'logo', file);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const logoUrl = `/uploads/logo/${file}`;
  const setting = await Setting.findOneAndUpdate({}, { logoUrl }, { new: true, upsert: true });
  console.log('Updated Setting.logoUrl =', setting.logoUrl);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
