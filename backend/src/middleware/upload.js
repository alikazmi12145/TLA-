const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ApiError = require('../utils/ApiError');

// Resolve UPLOAD_DIR against the backend/ root (two levels above this file),
// not process.cwd(). Under PM2, CWD depends on where `pm2 start` was invoked
// or where PM2 respawns on reboot, so a relative path can drift between
// process starts. Multer would then save files into one folder while
// express.static reads from another, producing "uploads succeed but images
// 404" bugs in production. Anchoring to __dirname eliminates that.
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const rawUploadDir = process.env.UPLOAD_DIR || 'uploads';
const uploadDir = path.isAbsolute(rawUploadDir)
  ? rawUploadDir
  : path.join(BACKEND_ROOT, rawUploadDir);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sub = req.uploadSubdir || 'misc';
    const dir = path.join(uploadDir, sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp|gif|pdf/;
  if (allowed.test(file.mimetype)) return cb(null, true);
  cb(new ApiError(400, 'Unsupported file type'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
});

const withSubdir = (sub) => (req, _res, next) => {
  req.uploadSubdir = sub;
  next();
};

module.exports = { upload, withSubdir, uploadDir };
