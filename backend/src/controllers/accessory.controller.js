const asyncHandler = require('express-async-handler');
const Accessory = require('../models/Accessory');
const AccessoryRequest = require('../models/AccessoryRequest');
const { ACCESSORY_REQUEST_STATUS } = require('../models/AccessoryRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { ROLES } = require('../config/constants');
const { hasModuleAccess } = require('../config/permissions');
const Setting = require('../models/Setting');

// ------------------------------ Catalog ------------------------------

// GET /accessories
// Query: q (search), category, status (active|inactive), page, limit
// Available to any authenticated user so employees can browse the
// catalog when creating a request. Soft-deleted rows are always hidden.
exports.list = asyncHandler(async (req, res) => {
  const { q, category, status } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = { isDeleted: false };
  if (category) filter.category = category;
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { category: rx }];
  }
  const [items, total] = await Promise.all([
    Accessory.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Accessory.countDocuments(filter),
  ]);
  return success(res, items, 'Accessories', 200, { page, limit, total });
});

// GET /accessories/available — lightweight list used by the employee
// request form (only active accessories with stock > 0).
exports.available = asyncHandler(async (_req, res) => {
  const items = await Accessory.find({
    isDeleted: false,
    isActive: true,
    availableQuantity: { $gt: 0 },
  })
    .select('name code category availableQuantity totalQuantity description')
    .sort({ name: 1 });
  return success(res, items, 'Available accessories');
});

exports.get = asyncHandler(async (req, res) => {
  const item = await Accessory.findOne({ _id: req.params.id, isDeleted: false });
  if (!item) throw new ApiError(404, 'Accessory not found');
  return success(res, item, 'Accessory');
});

exports.create = asyncHandler(async (req, res) => {
  const { name, code, category, totalQuantity, description, isActive } = req.body;
  if (!name || !code) throw new ApiError(400, 'Name and code are required');
  const total = Number(totalQuantity);
  if (!Number.isFinite(total) || total < 0) throw new ApiError(400, 'Total quantity must be a non-negative number');

  const normalizedCode = String(code).trim().toUpperCase();
  const existing = await Accessory.findOne({ code: normalizedCode });
  if (existing) throw new ApiError(409, 'An accessory with this code already exists');

  const item = await Accessory.create({
    name: String(name).trim(),
    code: normalizedCode,
    category: category ? String(category).trim() : undefined,
    totalQuantity: total,
    availableQuantity: total,
    description: description ? String(description).trim() : undefined,
    isActive: isActive !== undefined ? !!isActive : true,
  });
  return success(res, item, 'Accessory created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const item = await Accessory.findOne({ _id: req.params.id, isDeleted: false });
  if (!item) throw new ApiError(404, 'Accessory not found');

  const { name, code, category, totalQuantity, description, isActive } = req.body;

  if (code !== undefined) {
    const normalized = String(code).trim().toUpperCase();
    if (!normalized) throw new ApiError(400, 'Code cannot be empty');
    if (normalized !== item.code) {
      const dupe = await Accessory.findOne({ code: normalized, _id: { $ne: item._id } });
      if (dupe) throw new ApiError(409, 'An accessory with this code already exists');
      item.code = normalized;
    }
  }
  if (name !== undefined) item.name = String(name).trim();
  if (category !== undefined) item.category = category ? String(category).trim() : undefined;
  if (description !== undefined) item.description = description ? String(description).trim() : undefined;
  if (isActive !== undefined) item.isActive = !!isActive;

  if (totalQuantity !== undefined) {
    const total = Number(totalQuantity);
    if (!Number.isFinite(total) || total < 0) throw new ApiError(400, 'Total quantity must be a non-negative number');
    // When total changes, adjust available by the same delta so already
    // issued stock is preserved (available = total - issuedOut).
    const issuedOut = item.totalQuantity - item.availableQuantity;
    if (total < issuedOut) {
      throw new ApiError(400, `Total quantity cannot be less than currently issued (${issuedOut})`);
    }
    item.totalQuantity = total;
    item.availableQuantity = total - issuedOut;
  }

  await item.save();
  return success(res, item, 'Accessory updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const item = await Accessory.findOne({ _id: req.params.id, isDeleted: false });
  if (!item) throw new ApiError(404, 'Accessory not found');
  const openReq = await AccessoryRequest.exists({
    accessory: item._id,
    status: { $in: [ACCESSORY_REQUEST_STATUS.PENDING, ACCESSORY_REQUEST_STATUS.APPROVED, ACCESSORY_REQUEST_STATUS.ISSUED] },
  });
  if (openReq) throw new ApiError(400, 'Cannot delete: accessory has open or issued requests');
  item.isDeleted = true;
  item.isActive = false;
  await item.save();
  return success(res, {}, 'Accessory deleted');
});

// --------------------------- Requests --------------------------------

const populateRequest = (q) =>
  q
    .populate('employee', 'fullName employeeId email department')
    .populate('department', 'name')
    .populate('accessory', 'name code category')
    .populate('approvedBy', 'fullName')
    .populate('rejectedBy', 'fullName')
    .populate('issuedBy', 'fullName')
    .populate('completedBy', 'fullName');

// POST /accessories/requests — any authenticated employee.
exports.createRequest = asyncHandler(async (req, res) => {
  const { accessory: accessoryId, quantity, note } = req.body;
  if (!accessoryId) throw new ApiError(400, 'Accessory is required');
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1) throw new ApiError(400, 'Quantity must be at least 1');

  const accessory = await Accessory.findOne({ _id: accessoryId, isDeleted: false, isActive: true });
  if (!accessory) throw new ApiError(404, 'Accessory not found or inactive');
  if (qty > accessory.availableQuantity) {
    throw new ApiError(400, `Only ${accessory.availableQuantity} unit(s) available`);
  }

  const employee = await User.findById(req.user._id).select('department fullName');
  const doc = await AccessoryRequest.create({
    employee: req.user._id,
    department: employee?.department,
    accessory: accessory._id,
    quantity: qty,
    note: note ? String(note).trim() : undefined,
  });
  const populated = await populateRequest(AccessoryRequest.findById(doc._id));

  // Notify every user who can manage accessory requests: Super Admins
  // (implicit) plus any role granted `accessories: manage` in Settings.
  // We compute the list of "manager" roles from the live permissions
  // document so newly-granted access takes effect immediately.
  try {
    const setting = await Setting.findOne().select('permissions').lean();
    const managerRoles = new Set([ROLES.SUPER_ADMIN]);
    Object.values(ROLES).forEach((r) => {
      if (r !== ROLES.SUPER_ADMIN && hasModuleAccess(setting?.permissions, r, 'accessories', 'manage')) {
        managerRoles.add(r);
      }
    });
    const managers = await User.find({ role: { $in: Array.from(managerRoles) }, isActive: true })
      .select('_id')
      .lean();
    if (managers.length) {
      const title = 'New accessory request';
      const message = `${employee?.fullName || 'An employee'} requested ${qty} × ${accessory.name} (${accessory.code}).`;
      await Notification.insertMany(
        managers.map((m) => ({
          user: m._id,
          type: 'ACCESSORY_REQUEST',
          title,
          message,
          link: '/accessories/requests',
          meta: { requestId: doc._id },
        }))
      );
    }
  } catch { /* notifications must never block request creation */ }

  return success(res, populated, 'Request submitted', 201);
});

// GET /accessories/requests/me — current user's own history.
exports.myRequests = asyncHandler(async (req, res) => {
  const filter = { employee: req.user._id };
  if (req.query.status) filter.status = req.query.status;
  const items = await populateRequest(AccessoryRequest.find(filter).sort({ createdAt: -1 }));
  return success(res, items, 'My requests');
});

// GET /accessories/requests — admin/administration.
exports.listRequests = asyncHandler(async (req, res) => {
  const { status, employee, accessory, department, q } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = {};
  if (status) filter.status = status;
  if (employee) filter.employee = employee;
  if (accessory) filter.accessory = accessory;
  if (department) filter.department = department;

  let query = AccessoryRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  query = populateRequest(query);
  let items = await query;
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    items = items.filter(
      (r) =>
        rx.test(r.employee?.fullName || '') ||
        rx.test(r.employee?.employeeId || '') ||
        rx.test(r.accessory?.name || '') ||
        rx.test(r.accessory?.code || '')
    );
  }
  const total = await AccessoryRequest.countDocuments(filter);
  return success(res, items, 'Accessory requests', 200, { page, limit, total });
});

exports.getRequest = asyncHandler(async (req, res) => {
  const item = await populateRequest(AccessoryRequest.findById(req.params.id));
  if (!item) throw new ApiError(404, 'Request not found');
  const isOwner = String(item.employee?._id || item.employee) === String(req.user._id);
  const isAdmin = req.user.role === ROLES.SUPER_ADMIN || req._accessoryManage === true;
  if (!isOwner && !isAdmin) throw new ApiError(403, 'Forbidden');
  return success(res, item, 'Request');
});

const notifyEmployee = async (request, title, message) => {
  try {
    await Notification.create({
      user: request.employee?._id || request.employee,
      type: 'ACCESSORY_UPDATE',
      title,
      message,
      link: '/my/accessories',
    });
  } catch { /* notifications must never block the state transition */ }
};

// PATCH /accessories/requests/:id/approve
exports.approveRequest = asyncHandler(async (req, res) => {
  const request = await populateRequest(AccessoryRequest.findById(req.params.id));
  if (!request) throw new ApiError(404, 'Request not found');
  if (request.status !== ACCESSORY_REQUEST_STATUS.PENDING) {
    throw new ApiError(400, `Only PENDING requests can be approved (current: ${request.status})`);
  }
  request.status = ACCESSORY_REQUEST_STATUS.APPROVED;
  request.approvedBy = req.user._id;
  request.approvedAt = new Date();
  if (req.body?.remarks) request.remarks = String(req.body.remarks).trim();
  await request.save();
  await notifyEmployee(request, 'Accessory request approved', `Your request for ${request.accessory?.name} was approved.`);
  return success(res, request, 'Request approved');
});

// PATCH /accessories/requests/:id/reject
exports.rejectRequest = asyncHandler(async (req, res) => {
  const request = await populateRequest(AccessoryRequest.findById(req.params.id));
  if (!request) throw new ApiError(404, 'Request not found');
  if (![ACCESSORY_REQUEST_STATUS.PENDING, ACCESSORY_REQUEST_STATUS.APPROVED].includes(request.status)) {
    throw new ApiError(400, `Cannot reject a request in status ${request.status}`);
  }
  request.status = ACCESSORY_REQUEST_STATUS.REJECTED;
  request.rejectedBy = req.user._id;
  request.rejectedAt = new Date();
  if (req.body?.remarks) request.remarks = String(req.body.remarks).trim();
  await request.save();
  await notifyEmployee(request, 'Accessory request rejected', `Your request for ${request.accessory?.name} was rejected.${request.remarks ? ' Remarks: ' + request.remarks : ''}`);
  return success(res, request, 'Request rejected');
});

// PATCH /accessories/requests/:id/issue
// Atomically decrements available stock. If the accessory does not have
// enough units left at the moment of the update the operation fails
// without side effects — this is the single guard against race conditions
// when multiple administrators issue requests concurrently.
exports.issueRequest = asyncHandler(async (req, res) => {
  const request = await AccessoryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Request not found');
  if (![ACCESSORY_REQUEST_STATUS.APPROVED, ACCESSORY_REQUEST_STATUS.PENDING].includes(request.status)) {
    throw new ApiError(400, `Only PENDING or APPROVED requests can be issued (current: ${request.status})`);
  }

  const updatedAccessory = await Accessory.findOneAndUpdate(
    {
      _id: request.accessory,
      isDeleted: false,
      isActive: true,
      availableQuantity: { $gte: request.quantity },
    },
    { $inc: { availableQuantity: -request.quantity } },
    { new: true }
  );
  if (!updatedAccessory) throw new ApiError(409, 'Insufficient stock to issue this request');

  request.status = ACCESSORY_REQUEST_STATUS.ISSUED;
  request.issuedBy = req.user._id;
  request.issuedAt = new Date();
  if (!request.approvedBy) {
    request.approvedBy = req.user._id;
    request.approvedAt = new Date();
  }
  if (req.body?.remarks) request.remarks = String(req.body.remarks).trim();
  try {
    await request.save();
  } catch (e) {
    // Roll back the stock change if the request save fails.
    await Accessory.updateOne(
      { _id: updatedAccessory._id },
      { $inc: { availableQuantity: request.quantity } }
    );
    throw e;
  }
  const populated = await populateRequest(AccessoryRequest.findById(request._id));
  await notifyEmployee(populated, 'Accessory issued', `Your ${populated.accessory?.name} (x${populated.quantity}) has been issued.`);
  return success(res, populated, 'Request issued');
});

// PATCH /accessories/requests/:id/complete
// Marks the workflow finished. Does NOT return stock — completion means
// the employee has taken permanent ownership of the item.
exports.completeRequest = asyncHandler(async (req, res) => {
  const request = await AccessoryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Request not found');
  if (request.status !== ACCESSORY_REQUEST_STATUS.ISSUED) {
    throw new ApiError(400, `Only ISSUED requests can be completed (current: ${request.status})`);
  }
  request.status = ACCESSORY_REQUEST_STATUS.COMPLETED;
  request.completedBy = req.user._id;
  request.completedAt = new Date();
  if (req.body?.remarks) request.remarks = String(req.body.remarks).trim();
  await request.save();
  const populated = await populateRequest(AccessoryRequest.findById(request._id));
  return success(res, populated, 'Request completed');
});

// PATCH /accessories/requests/:id/remarks — free-form remark update.
exports.updateRemarks = asyncHandler(async (req, res) => {
  const request = await AccessoryRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Request not found');
  request.remarks = req.body?.remarks ? String(req.body.remarks).trim() : '';
  await request.save();
  return success(res, request, 'Remarks updated');
});
