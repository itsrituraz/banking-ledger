const userModel = require("../models/user.model")
const jwt = require("jsonwebtoken")
const tokenBlackListModel = require("../models/blacklist.model")

async function authMiddleware(req,res,next){
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1]
  if(!token) {
    return res.status(401).json({
      message:"Unauthorized access,token is missing"
    })
  }

  const isBlacklisted = await tokenBlackListModel.findOne({ token })

  if(isBlacklisted) {
    return res.status(401).json({
      message: "Unauthorized access,token is invalid"
    })
  }
  try{
    const decoded = jwt.verify(token,process.env.JWT_SECRET)

    const user = await userModel.findById(decoded.userId)
    if (!user) {
      return res.status(401).json({
        message: "Unauthorized access, user not found"
      })
    }

    req.user = user
    next()

  }catch(err) {
    return res.status(401).json({
      message:"Unauthorized access,token is invalid"
    })
  }
}

async function authSystemUserMiddleware(req,res,next){
  const token =req.cookies.token || req.headers.authorization?.split(" ")[1]

  if(!token){
    return res.status(401).json({
      message:"Unauthorized access,token is missing"
    })
  }
  const isBlacklisted=await tokenBlackListModel.findOne({ token })

  if(isBlacklisted) {
    return res.status(401).json({
      message: "Unauthorized access,token is invalid"
    })
  }

  try {
    const decoded = jwt.verify(token,process.env.JWT_SECRET)

    const user = await userModel.findById(decoded.userId).select("+systemUser")
    if(!user || !user.systemUser){
      return res.status(403).json({
        message:"Forbidden access,not a system user"
      })
    }
    req.user = user
    return next()
  }

  catch(err) {
    return res.status(401).json({
      message: "Unauthorized access,token is invalid"
    })
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({
      message: "Forbidden: Admin access required"
    });
  }
  return next();
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  authSystemUserMiddleware
}