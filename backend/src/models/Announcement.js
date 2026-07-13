const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const ANNOUNCEMENT_PRIORITY = ['INFO', 'SUCCESS', 'WARNING', 'URGENT'];
const AUDIENCE_TYPES = ['ALL', 'ROLES', 'DEPARTMENTS'];

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    priority: { type: String, enum: ANNOUNCEMENT_PRIORITY, default: 'INFO', index: true },
    // Audience routing — default ALL means every logged-in user.
    audience: { type: String, enum: AUDIENCE_TYPES, default: 'ALL' },
    roles: [{ type: String, enum: Object.values(ROLES) }],
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    // Optional scheduling window (both fields optional).
    publishAt: { type: Date, default: () => new Date(), index: true },
    expiresAt: { type: Date, default: null, index: true },
    pinned: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

announcementSchema.statics.PRIORITIES = ANNOUNCEMENT_PRIORITY;
announcementSchema.statics.AUDIENCE_TYPES = AUDIENCE_TYPES;

// Feed query: active + publishAt <= now + expiresAt null|>=now, sorted by
// pinned desc + publishAt desc. Compound covers filter + sort.
announcementSchema.index({ active: 1, publishAt: -1 });
announcementSchema.index({ active: 1, pinned: -1, publishAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
