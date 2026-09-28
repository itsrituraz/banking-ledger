const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  actorUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    default: null,
    index: true,
    immutable: true
  },
  action: {
    type: String,
    required: [true, "Action is required for an audit log"],
    index: true,
    immutable: true
  },
  resourceType: {
    type: String,
    required: [true, "ResourceType is required for an audit log"],
    enum: {
      values: ["TRANSACTION", "USER", "ACCOUNT", "AUTH", "ADMIN", "RISK", "SYSTEM"],
      message: "Invalid resourceType"
    },
    index: true,
    immutable: true
  },
  resourceId: {
    type: String,
    default: null,
    immutable: true
  },
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "transaction",
    default: null,
    index: true,
    immutable: true
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    default: null,
    immutable: true
  },
  requestId: {
    type: String,
    default: null,
    immutable: true
  },
  ipAddress: {
    type: String,
    default: null,
    immutable: true
  },
  userAgent: {
    type: String,
    default: null,
    immutable: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    immutable: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  }
}, {
  timestamps: false,
  versionKey: false
});

// Immutability enforcement: block all mutation, replacement, and deletion queries
function preventAuditModification() {
  throw new Error("Audit log entries are immutable and cannot be modified or deleted");
}

auditLogSchema.pre("findOneAndUpdate", preventAuditModification);
auditLogSchema.pre("updateOne", preventAuditModification);
auditLogSchema.pre("updateMany", preventAuditModification);
auditLogSchema.pre("deleteOne", preventAuditModification);
auditLogSchema.pre("deleteMany", preventAuditModification);
auditLogSchema.pre("remove", preventAuditModification);
auditLogSchema.pre("findOneAndDelete", preventAuditModification);
auditLogSchema.pre("findOneAndReplace", preventAuditModification);
auditLogSchema.pre("replaceOne", preventAuditModification);

auditLogSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error("Audit log entries are immutable and cannot be modified or deleted");
  }
});

// Compound indexes optimized for administrative query patterns
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, createdAt: -1 });
auditLogSchema.index({ actorUser: 1, createdAt: -1 });
auditLogSchema.index({ requestId: 1 });

const auditLogModel = mongoose.model("audit_log", auditLogSchema);

module.exports = auditLogModel;
