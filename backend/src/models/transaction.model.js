const mongoose = require("mongoose")

const transactionSchema = new mongoose.Schema({
  fromAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "account",
    required: [true,"Transaction must be associated with a from account "],
    index: true
  },
  toAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "account",
    required: [true,"Transaction must be associated with a to account"],
    index: true
  },
  status:{
    type: String,
    enum: {
      values: ["PENDING","COMPLETED","FAILED","REVERSED"],
      message: "Status can be either PENDING,COMPLETED,FAILED or REVERSED",
    },
    default: "PENDING"
  },
  amount: {
    type: Number,
    required: [true,"Amount is required for creating a transaction"],
    min: [0,"Transaction amount cannot be negative"]
  },
  idempotencyKey: {
    type: String,
    required: [true,"Idempotency key is required for creating a transaction"],
    index: true,
    unique: true
  },
  riskScore: {
    type: Number,
    min: [0, "Risk score cannot be less than 0"],
    max: [100, "Risk score cannot exceed 100"],
    default: 0,
    index: true
  },
  riskStatus: {
    type: String,
    enum: {
      values: ["APPROVED", "FLAGGED", "MANUAL_REVIEW", "BLOCKED"],
      message: "Status can be either APPROVED, FLAGGED, MANUAL_REVIEW or BLOCKED"
    },
    default: "APPROVED",
    index: true
  },
  riskReasons: {
    type: [String],
    default: []
  },
  isFirstTimeBeneficiary: {
    type: Boolean,
    default: false
  },
  clientIp: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  }
},{
  timestamps: true
})

transactionSchema.index({ fromAccount: 1, toAccount: 1, status: 1 });
transactionSchema.index({ fromAccount: 1, status: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ riskStatus: 1, createdAt: -1 });
transactionSchema.index({ createdAt: -1 });

const transactionModel = mongoose.model("transaction",transactionSchema)

module.exports = transactionModel