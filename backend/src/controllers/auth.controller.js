const userModel = require("../models/user.model")
const accountModel = require("../models/account.model")
const jwt = require("jsonwebtoken")
const emailService = require("../services/email.service")
const tokenBlackListModel = require("../models/blacklist.model")
const auditService = require("../services/audit.service")
const logger = require("../utils/logger")

/**
 * Standardized hardened cookie configuration
 */
function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 3 * 24 * 60 * 60 * 1000 // 3 days in milliseconds
  };
}

/** 
 * - user register controller
 * - POST /api/auth/register (also /api/auth/signup)
 */
async function userRegisterController(req, res) {
  try {
    const { email, password, name } = req.body

    if (!email || !password || !name) {
      return res.status(400).json({
        message: "Name, email and password are required"
      })
    }

    const normalizedEmail = email.toLowerCase().trim()

    const isExists = await userModel.findOne({
      email: normalizedEmail
    })
    if (isExists) {
      return res.status(422).json({
        message: "user already exists with email",
        status: "failed"
      })
    }

    const user = await userModel.create({
      email: normalizedEmail,
      password,
      name: name.trim(),
      role: "USER"
    })

    // Automatically create primary bank account for new user
    const account = await accountModel.create({
      user: user._id
    })

    const token = jwt.sign(
      { userId: user._id, role: user.role || "USER" },
      process.env.JWT_SECRET,
      { expiresIn: "3d" }
    )

    res.cookie("token", token, getCookieOptions())

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || null;
    const userAgent = req.headers['user-agent'] || null;

    try {
      await auditService.logAuditEvent({
        actorUser: user._id,
        action: "USER_REGISTERED",
        resourceType: "USER",
        resourceId: user._id.toString(),
        targetUserId: user._id,
        requestId: req.requestId,
        ipAddress: clientIp,
        userAgent,
        metadata: { email: user.email, name: user.name, role: user.role }
      });
    } catch (auditErr) {
      console.error("Audit log error (USER_REGISTERED):", auditErr.message);
    }

    res.status(201).json({
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role || "USER"
      },
      account: {
        _id: account._id,
        accountNumber: account._id.toString(),
        currency: account.currency,
        status: account.status,
        balance: 0
      },
      token
    })

    // Non-blocking best-effort email notification
    emailService.sendRegistrationEmail(user.email, user.name).catch(err => {
      console.error("sendRegistrationEmail background error:", err?.message || err)
    })
  } catch (error) {
    console.error("userRegisterController error:", error)
    return res.status(400).json({
      message: error.message || "Registration failed"
    })
  }
}

/** 
 * - User Login Controller
 * - POST /api/auth/login
 */ 
async function userLoginController(req, res) {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      })
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || null;
    const userAgent = req.headers['user-agent'] || null;

    const normalizedEmail = email.toLowerCase().trim()
    const user = await userModel.findOne({ email: normalizedEmail }).select("+password")

    if (!user) {
      logger.warn("AUTH_LOGIN_FAILED", {
        requestId: req.requestId || "UNKNOWN",
        attemptedEmail: normalizedEmail,
        reason: "USER_NOT_FOUND"
      });

      try {
        await auditService.logAuditEvent({
          actorUser: null,
          action: "LOGIN_FAILED",
          resourceType: "AUTH",
          requestId: req.requestId,
          ipAddress: clientIp,
          userAgent,
          metadata: { attemptedEmail: normalizedEmail, reason: "USER_NOT_FOUND" }
        });
      } catch (auditErr) {
        console.error("Audit log error (LOGIN_FAILED):", auditErr.message);
      }

      return res.status(401).json({
        message: "Email or password is INVALID"
      })
    }

    const isValidPassword = await user.comparePassword(password)

    if (!isValidPassword) {
      logger.warn("AUTH_LOGIN_FAILED", {
        requestId: req.requestId || "UNKNOWN",
        userId: user._id.toString(),
        attemptedEmail: normalizedEmail,
        reason: "INVALID_PASSWORD"
      });

      try {
        await auditService.logAuditEvent({
          actorUser: user._id,
          action: "LOGIN_FAILED",
          resourceType: "AUTH",
          resourceId: user._id.toString(),
          requestId: req.requestId,
          ipAddress: clientIp,
          userAgent,
          metadata: { attemptedEmail: normalizedEmail, reason: "INVALID_PASSWORD" }
        });
      } catch (auditErr) {
        console.error("Audit log error (LOGIN_FAILED):", auditErr.message);
      }

      return res.status(401).json({
        message: "Email or password is INVALID"
      })
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role || "USER" },
      process.env.JWT_SECRET,
      { expiresIn: "3d" }
    )

    res.cookie("token", token, getCookieOptions())

    logger.info("AUTH_LOGIN_SUCCESS", {
      requestId: req.requestId || "UNKNOWN",
      userId: user._id.toString(),
      role: user.role
    });

    try {
      await auditService.logAuditEvent({
        actorUser: user._id,
        action: "LOGIN_SUCCESS",
        resourceType: "AUTH",
        resourceId: user._id.toString(),
        requestId: req.requestId,
        ipAddress: clientIp,
        userAgent,
        metadata: { email: user.email, role: user.role }
      });
    } catch (auditErr) {
      console.error("Audit log error (LOGIN_SUCCESS):", auditErr.message);
    }

    res.status(200).json({
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role || "USER"
      },
      token
    })
  } catch (error) {
    console.error("userLoginController error:", error)
    return res.status(500).json({
      message: error.message || "Login failed"
    })
  }
}

/** 
 * - User Logout Controller
 * - POST /api/auth/logout
 */
async function userLogoutController(req, res) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(" ")[1]
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || null;
    const userAgent = req.headers['user-agent'] || null;

    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/"
    })

    if (token) {
      try {
        await tokenBlackListModel.create({ token })
      } catch (err) {
        // If already blacklisted, ignore code 11000
        if (err.code !== 11000) {
          console.error("Failed to blacklist token:", err)
        }
      }
    }

    logger.info("AUTH_LOGOUT", {
      requestId: req.requestId || "UNKNOWN",
      userId: req.user?._id?.toString() || "ANONYMOUS"
    });

    try {
      await auditService.logAuditEvent({
        actorUser: req.user?._id || null,
        action: "LOGOUT",
        resourceType: "AUTH",
        requestId: req.requestId,
        ipAddress: clientIp,
        userAgent,
        metadata: { status: "SUCCESS" }
      });
    } catch (auditErr) {
      console.error("Audit log error (LOGOUT):", auditErr.message);
    }

    res.status(200).json({
      message: "User logged out successfully"
    })
  } catch (error) {
    console.error("userLogoutController error:", error)
    res.status(200).json({
      message: "User logged out successfully"
    })
  }
}

/**
 * - Current User Profile Controller
 * - GET /api/auth/me, GET /api/auth/profile
 */
async function currentUserController(req, res) {
  res.status(200).json({
    user: {
      _id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role || "USER",
      systemUser: !!req.user.systemUser
    }
  })
}

module.exports = {
  userRegisterController,
  userLoginController,
  userLogoutController,
  currentUserController
}