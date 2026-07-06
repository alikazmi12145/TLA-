const asyncHandler = require('express-async-handler');
const Announcement = require('../models/Announcement');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { ROLES } = require('../config/constants');
const logger = require('../utils/logger');

const isAdminRole = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.HR_MANAGER;

// Filter that returns announcements currently visible to a specific user.
const audienceFilterFor = (user) => {
  const now = new Date();
  const base = {
    active: true,
    publishAt: { $lte: now },
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
      {
        $or: [
          { audience: 'ALL' },
          { audience: 'ROLES', roles: user.role },
          ...(user.department ? [{ audience: 'DEPARTMENTS', departments: user.department }] : []),
        ],
      },
    ],
  };
  return base;
};

/** GET /announcements — admin management view (all rows). */
exports.listAll = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const filter = {};
  if (req.query.priority) filter.priority = req.query.priority;
  if (req.query.active === 'true') filter.active = true;
  if (req.query.active === 'false') filter.active = false;
  if (req.query.search) {
    const rx = new RegExp(String(req.query.search).trim(), 'i');
    filter.$or = [{ title: rx }, { message: rx }];
  }
  const [items, total] = await Promise.all([
    Announcement.find(filter)
      .populate('createdBy', 'fullName')
      .populate('departments', 'name')
      .sort({ pinned: -1, publishAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Announcement.countDocuments(filter),
  ]);
  return success(res, items, 'Announcements', 200, {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  });
});

/** GET /announcements/feed — active announcements for the caller's dashboard. */
exports.feed = asyncHandler(async (req, res) => {
  const limit = Math.min(20, Number(req.query.limit) || 10);
  const filter = audienceFilterFor(req.user);
  const items = await Announcement.find(filter)
    .populate('createdBy', 'fullName')
    .sort({ pinned: -1, priority: 1, publishAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  return success(res, items, 'Announcement feed');
});

exports.getOne = asyncHandler(async (req, res) => {
  const item = await Announcement.findById(req.params.id)
    .populate('createdBy', 'fullName')
    .populate('departments', 'name');
  if (!item) throw new ApiError(404, 'Announcement not found');
  return success(res, item, 'Announcement');
});

// Fan out one notification per recipient so it also shows up in the bell.
// Super Admins are excluded — they author announcements and don't need a
// notification bell entry for their own broadcast.
const fanoutNotifications = async (announcement) => {
  const filter = {
    isActive: { $ne: false },
    role: { $ne: ROLES.SUPER_ADMIN },
  };
  if (announcement.audience === 'ROLES' && announcement.roles?.length) {
    const roles = announcement.roles.filter((r) => r !== ROLES.SUPER_ADMIN);
    if (!roles.length) return 0;
    filter.role = { $in: roles };
  } else if (announcement.audience === 'DEPARTMENTS' && announcement.departments?.length) {
    filter.department = { $in: announcement.departments };
  }
  const recipients = await User.find(filter).select('_id').lean();
  if (!recipients.length) return 0;
  const docs = recipients.map((u) => ({
    user: u._id,
    type: 'ANNOUNCEMENT',
    title: announcement.title,
    message: announcement.message,
    link: '/my/announcements',
    meta: {
      announcementId: announcement._id,
      priority: announcement.priority,
      pinned: announcement.pinned,
    },
  }));
  try {
    await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    logger.warn(`[announcement.fanout] partial failure: ${err.message}`);
  }
  return recipients.length;
};

exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body, createdBy: req.user._id };
  if (body.audience === 'ROLES' && !Array.isArray(body.roles)) body.roles = [];
  if (body.audience === 'DEPARTMENTS' && !Array.isArray(body.departments)) body.departments = [];
  if (body.publishAt) body.publishAt = new Date(body.publishAt);
  if (body.expiresAt) body.expiresAt = new Date(body.expiresAt);
  if (body.expiresAt === '' || body.expiresAt === null) body.expiresAt = null;
  const item = await Announcement.create(body);
  const notifiedCount = await fanoutNotifications(item);
  return success(res, { announcement: item, notified: notifiedCount }, 'Announcement created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.publishAt) body.publishAt = new Date(body.publishAt);
  if (body.expiresAt === '' || body.expiresAt === null) body.expiresAt = null;
  else if (body.expiresAt) body.expiresAt = new Date(body.expiresAt);
  const item = await Announcement.findByIdAndUpdate(req.params.id, body, {
    new: true,
    runValidators: true,
  });
  if (!item) throw new ApiError(404, 'Announcement not found');
  return success(res, item, 'Announcement updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const item = await Announcement.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Announcement not found');
  return success(res, {}, 'Announcement deleted');
});

exports.togglePin = asyncHandler(async (req, res) => {
  const item = await Announcement.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Announcement not found');
  item.pinned = !item.pinned;
  await item.save();
  return success(res, item, `Announcement ${item.pinned ? 'pinned' : 'unpinned'}`);
});

exports.toggleActive = asyncHandler(async (req, res) => {
  const item = await Announcement.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Announcement not found');
  item.active = !item.active;
  await item.save();
  return success(res, item, `Announcement ${item.active ? 'activated' : 'deactivated'}`);
});

exports._audienceFilterFor = audienceFilterFor; // exported for tests
exports._isAdminRole = isAdminRole;
