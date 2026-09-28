const express = require("express");
const {
  userRegisterController,
  userLoginController,
  userLogoutController,
  currentUserController
} = require("../controllers/auth.controller");
const { authMiddleware } = require("../middleware/auth.middleware");
const { authLimiter } = require("../middleware/rateLimiter.middleware");

const router = express.Router();

/* POST /api/auth/register & POST /api/auth/signup */
router.post("/register", authLimiter, userRegisterController);
router.post("/signup", authLimiter, userRegisterController);

/* POST /api/auth/login */
router.post("/login", authLimiter, userLoginController);

/**
 * - POST /api/auth/logout
 */
router.post("/logout", userLogoutController);

/**
 * - GET /api/auth/me & GET /api/auth/profile
 */
router.get("/me", authMiddleware, currentUserController);
router.get("/profile", authMiddleware, currentUserController);

module.exports = router;