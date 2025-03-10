import { Router } from "express";
import { registerUser,loginUser,logoutUser , refreshAccessToken,profileData ,profileEdit,verifyEmail,resendotp,forgotPassword,currentuser } from "../controllers/User.controllers.js";
import {addrescreate,useralladdress ,updateUserAddress,deleteUserAddress} from "../controllers/Address.controllers.js";
import {verifyJWT} from "../middlewares/auth.middleware.js";
import upload from "../middlewares/multer.middleware.js";


const router = Router();


router.route("/register").post(registerUser)
router.route("/verify-email").post(verifyEmail)
router.route("/forgot-password").post(forgotPassword)
router.route("/resend-otp").post(resendotp)
router.route("/login").post(loginUser)
router.route("/logout").get(verifyJWT,logoutUser)
router.route("/refresh-accessToken").get(refreshAccessToken)
router.route("/profile").get(verifyJWT,profileData)
router.route("/profile").put(verifyJWT,upload.single("avatar"),profileEdit)
router.route("/currentuser").get(verifyJWT,currentuser)

router.route("/address").post(verifyJWT,addrescreate)
router.route("/useraddress").get(verifyJWT,useralladdress)
router.route("/updateaddress/:addressId").put(verifyJWT,updateUserAddress)
router.route("/deleteaddress/:addressId").delete(verifyJWT,deleteUserAddress)



export default router;