const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true },
    message: { type: String },
    toRoles: [{ type: String }],
    toEmployees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    status: { type: String, default: 'PENDING' },
    remarks: { type: String },
    replyMessage: { type: String },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    repliedAt: { type: Date },
    attachments: [{ type: String }],
  },
  { timestamps: true }
);

requestSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.model('Request', requestSchema);
