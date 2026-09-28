const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")



const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true,"Email is required for creating a user"],
    trim: true,
    lowercase: true,
    match:[/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,"Invalid Email address"],
    unique:[true,"Email already exist"]
  },

  name:{
    type: String,
    required:[true,"Name is required for creating an account"]

  },
  password:{
    type: String,
    required:[true,"Password is  required for creating an account"],
    minLength:[6,"password should contain more than 6 character"],
    select:false
  },
  role: {
    type: String,
    enum: {
      values: ["USER", "ADMIN"],
      message: "Role can be either USER or ADMIN"
    },
    default: "USER"
  },
  systemUser: {
    type: Boolean,
    default: false,
    immutable: true,
    select: false
  }
},{
  timestamps: true
})

// Index for sorted user listings in admin monitoring
userSchema.index({ createdAt: -1 });

userSchema.pre("save",async function(){

  if(!this.isModified("password")) {
    return ;
  }

  const hash = await bcrypt.hash(this.password,10)
  this.password=hash;

  return 

})

userSchema.methods.comparePassword=async function(password) {
  return await bcrypt.compare(password,this.password)
}

const userModel = mongoose.model("user",userSchema)

module.exports=userModel