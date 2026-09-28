const accountModel = require("../models/account.model")
const ledgerModel = require("../models/ledger.model")
const mongoose = require("mongoose")

async function createAccountController(req, res) {
  try {
    const user = req.user;

    const account = await accountModel.create({
      user: user._id
    })

    const balance = await account.getBalance();

    res.status(201).json({
      account: {
        ...account.toObject(),
        accountNumber: account._id.toString(),
        balance
      }
    })
  } catch (error) {
    console.error("createAccountController error:", error)
    res.status(500).json({ message: "Failed to create account" })
  }
}

async function getUserAccountsController(req, res) {
  try {
    let accounts = await accountModel.find({ user: req.user._id });

    // Auto-create primary account if user doesn't have one yet
    if (accounts.length === 0) {
      const newAccount = await accountModel.create({ user: req.user._id });
      accounts = [newAccount];
    }

    const accountIds = accounts.map(a => a._id);
    const balanceAgg = await ledgerModel.aggregate([
      { $match: { account: { $in: accountIds } } },
      {
        $group: {
          _id: "$account",
          totalDebit: {
            $sum: { $cond: [{ $eq: ["$type", "DEBIT"] }, "$amount", 0] }
          },
          totalCredit: {
            $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", 0] }
          }
        }
      }
    ]);

    const balanceMap = {};
    for (const b of balanceAgg) {
      balanceMap[b._id.toString()] = (b.totalCredit || 0) - (b.totalDebit || 0);
    }

    const accountsWithBalance = accounts.map((account) => ({
      ...account.toObject(),
      accountNumber: account._id.toString(),
      name: req.user.name,
      balance: balanceMap[account._id.toString()] || 0
    }));

    res.status(200).json({
      accounts: accountsWithBalance
    });
  } catch (error) {
    console.error("getUserAccountsController error:", error)
    res.status(500).json({ message: "Failed to fetch accounts" })
  }
}

async function getAccountBalanceController(req, res) {
  try {
    const { accountId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({
        message: "Invalid account ID format"
      })
    }

    const account = await accountModel.findOne({
      _id: accountId,
      user: req.user._id
    })

    if (!account) {
      return res.status(404).json({
        message: "Account not found"
      })
    }
    const balance = await account.getBalance();

    res.status(200).json({
      accountId: account._id,
      accountNumber: account._id.toString(),
      balance: balance
    })
  } catch (error) {
    console.error("getAccountBalanceController error:", error)
    res.status(500).json({ message: "Failed to fetch account balance" })
  }
}

module.exports = {
  createAccountController,
  getUserAccountsController,
  getAccountBalanceController
}