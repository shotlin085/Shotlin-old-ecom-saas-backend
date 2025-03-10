import { Router } from "express";
import {verifyJWT} from "../middlewares/auth.middleware.js";
import {createOrder,ordervarify, getOrders, getOrderById ,getDiscountPrice} from "../controllers/OrderList.controllers.js";


const router = Router();

router.route("/create-order").post(verifyJWT,createOrder);
router.route("/order-varify").post(verifyJWT,ordervarify);
router.route("/get-orders").get(verifyJWT,getOrders);
router.route("/get-order/:id").get(verifyJWT,getOrderById);

router.route("/get-discount-price").post(verifyJWT,getDiscountPrice);

export default router;