// Lightweight body validator: pass a function (data) => ({ error?: string, value })
// or a schema object: { field: { required, type, enum, min, max } }
const ApiError = require('../utils/ApiError');

const validateSchema = (schema) => (req, _res, next) => {
  const errors = [];
  for (const [field, rule] of Object.entries(schema)) {
    const v = req.body[field];
    if (rule.required && (v === undefined || v === null || v === '')) {
      errors.push({ field, message: `${field} is required` });
      continue;
    }
    if (v === undefined) continue;
    if (rule.type === 'number' && typeof v !== 'number' && isNaN(Number(v))) {
      errors.push({ field, message: `${field} must be a number` });
    }
    if (rule.enum && !rule.enum.includes(v)) {
      errors.push({ field, message: `${field} must be one of ${rule.enum.join(', ')}` });
    }
    if (rule.min !== undefined && Number(v) < rule.min) errors.push({ field, message: `${field} must be >= ${rule.min}` });
    if (rule.max !== undefined && Number(v) > rule.max) errors.push({ field, message: `${field} must be <= ${rule.max}` });
  }
  if (errors.length) throw new ApiError(400, 'Validation failed', errors);
  next();
};

module.exports = { validateSchema };
