const success = (res, data = {}, message = 'OK', status = 200, meta) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

const fail = (res, message = 'Error', status = 400, details) =>
  res.status(status).json({ success: false, message, details });

module.exports = { success, fail };
