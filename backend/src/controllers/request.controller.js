const asyncHandler = require('express-async-handler');
const Request = require('../models/Request');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { ROLES } = require('../config/constants');
const logger = require('../utils/logger');

// Create a request and fan-out notifications to the selected roles.
exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body, sender: req.user._id };
  if (!Array.isArray(body.toRoles)) body.toRoles = [];
  const item = await Request.create(body);

  // Fan-out notifications to users matching the roles (exclude sender).
  if (item.toRoles.length) {
    const recipients = await User.find({ role: { $in: item.toRoles }, _id: { $ne: req.user._id } }).select('_id').lean();
    if (recipients.length) {
      const docs = recipients.map((u) => ({
        user: u._id,
        type: 'REQUEST',
        title: `New request: ${item.subject}`,
        message: item.message || '',
        link: '/requests',
        meta: { requestId: item._id },
      }));
      try {
        await Notification.insertMany(docs, { ordered: false });
      } catch (err) {
        logger.warn(`[request.fanout] partial failure: ${err.message}`);
      }
    }
    return success(res, { request: item, notified: recipients.length }, 'Request created', 201);
  }

  return success(res, { request: item, notified: 0 }, 'Request created', 201);
});

// GET /requests — admin/manager listing
exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const filter = {};
  if (req.query.search) {
    const rx = new RegExp(String(req.query.search).trim(), 'i');
    filter.$or = [{ subject: rx }, { message: rx }];
  }
  const [items, total] = await Promise.all([
    Request.find(filter).populate('sender', 'fullName role').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Request.countDocuments(filter),
  ]);
  return success(res, items, 'Requests', 200, { page, limit, total, pages: Math.ceil(total / limit) });
});

// GET /requests/me — requests created by the caller
exports.myRequests = asyncHandler(async (req, res) => {
  const items = await Request.find({ sender: req.user._id }).sort({ createdAt: -1 });
  return success(res, items, 'My requests');
});

// GET /requests/:id
exports.get = asyncHandler(async (req, res) => {
  const item = await Request.findById(req.params.id).populate('sender', 'fullName role');
  if (!item) throw new ApiError(404, 'Request not found');
  return success(res, item, 'Request');
});

// Approve a request (manager action)
exports.approve = asyncHandler(async (req, res) => {
  const item = await Request.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Request not found');
  item.status = 'APPROVED';
  if (req.body.remarks) item.remarks = req.body.remarks;
  await item.save();

  // Notify the sender
  try {
    await Notification.create({
      user: item.sender,
      type: 'REQUEST_APPROVED',
      title: `Your request was approved: ${item.subject}`,
      message: req.body.remarks || '',
      link: '/my/requests',
      meta: { requestId: item._id },
    });
  } catch (err) {
    logger.warn(`[request.approve] notification failed: ${err.message}`);
  }

  return success(res, item, 'Request approved');
});

// Reject a request (manager action)
exports.reject = asyncHandler(async (req, res) => {
  const item = await Request.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Request not found');
  item.status = 'REJECTED';
  if (req.body.remarks) item.remarks = req.body.remarks;
  await item.save();

  // Notify the sender
  try {
    await Notification.create({
      user: item.sender,
      type: 'REQUEST_REJECTED',
      title: `Your request was rejected: ${item.subject}`,
      message: req.body.remarks || '',
      link: '/my/requests',
      meta: { requestId: item._id },
    });
  } catch (err) {
    logger.warn(`[request.reject] notification failed: ${err.message}`);
  }

  return success(res, item, 'Request rejected');
});

// Simple status update endpoints could be added here (approve/reject),
// but keep minimal for initial implementation.
