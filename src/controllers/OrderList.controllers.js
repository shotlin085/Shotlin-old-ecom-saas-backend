import {asyncHandler} from '../utils/asyncHandler.js';
import {ApiResponse} from '../utils/ApiResponse.js';
import Razorpay from 'razorpay';
import User from '../models/User.model.js';
import Order from '../models/Order.model.js';
import Product from '../models/Product.js';
import Coupon from '../models/DiscountCoupon.model.js';
import crypto from 'crypto';
import mailsend from "../utils/nodemailer.utils.js";
import {RAZORPAY_KEY_ID,RAZORPAY_KEY_SECRET} from '../constants.js'
import { console } from 'inspector';


const razorpay = new Razorpay({
    key_id:RAZORPAY_KEY_ID,
    key_secret:RAZORPAY_KEY_SECRET
});


const createOrder = asyncHandler(async (req, res) => {

  const { products, DiscountCoupon, paymentType, shippingAddress } = req.body;
  const userId = req.user?._id; // Use optional chaining if req.user might not exist


// Parallelize user and product validation
    const [userExist, productsExist] = await Promise.all([
        User.findById(userId).select('_id').lean(),
        Product.find({ _id: { $in: products.map(({ product }) => product) } })
            .select('_id price stock name totalOrders')
            .lean(),
    ]);

    if (!userExist) {
        res.status(404);
        throw new Error('User not found');
    }

    if (productsExist.length !== products.length) {
        res.status(404);
        throw new Error('Some products were not found');
    }

    // Prepare a map for quick lookup
    const productMap = new Map(productsExist.map(p => [p._id.toString(), p]));
    let totalAmount = 0;
    const bulkUpdates = [];

    for (const { product, quantity } of products) {
        const productDetail = productMap.get(product);
        if (!productDetail || productDetail.stock < quantity) {
            throw new Error(`${productDetail?.name || 'Unknown product'} is out of stock`);
        }

        // Update stock and totalOrders in bulk
        bulkUpdates.push({
            updateOne: {
                filter: { _id: product },
                update: { $inc: { stock: -quantity, totalOrders: quantity } },
            },
        });

        totalAmount += quantity * productDetail.price.inr;
    }

    // Perform bulk product updates
    await Product.bulkWrite(bulkUpdates);

    // Handle coupon validation (if provided)
    let finalAmount = totalAmount;
    let discount = 0;

    if (DiscountCoupon) {
        const couponExist = await Coupon.findOne({
            code: DiscountCoupon,
            isActive: true,
            expiryDate: { $gt: Date.now() },
        }).select('discountType discountValue minimumPurchase maximumDiscount usageLimit usageCount').lean();

        if (!couponExist) {
            res.status(404);
            throw new Error('Coupon not found or not valid');
        }

        if (couponExist.minimumPurchase > totalAmount || 
            (couponExist.usageLimit && couponExist.usageCount >= couponExist.usageLimit)) {
            res.status(400);
            throw new Error('Coupon is not applicable for this order');
        }

        discount =
            couponExist.discountType === 'percentage'
                ? Math.min((couponExist.discountValue / 100) * totalAmount, couponExist.maximumDiscount || Infinity)
                : couponExist.discountValue;

        finalAmount -= discount;

        // Increment coupon usage in background
        Coupon.updateOne({ code: DiscountCoupon }, { $inc: { usageCount: 1 } }).exec();
    }

    // Create Razorpay order and database order in parallel
    const GST_TEX = (finalAmount * 18) / 100; // GST calculation
    const amountWithGST = finalAmount + GST_TEX; // Final amount after adding GST

    const [razorpayOrder, order] = await Promise.all([
        razorpay.orders.create({
            amount: amountWithGST * 100, // Convert to paise
            currency: 'INR',
            receipt: `order_rcptid_${Date.now()}`,
            payment_capture: 0,
        }),
        Order.create({
            user: userId,
            products,
            totalAmount: amountWithGST,
            coupon: DiscountCoupon || null,
            paymentType,
            shippingAddress,
            orderId: `order_rcptid_${Date.now()}`,
        }),
    ]);

    // Background updates (non-blocking)
    Promise.all([
        User.updateOne({ _id: userId }, { $push: { orders: order._id } }).exec(),
        Product.updateMany(
            { _id: { $in: products.map(({ product }) => product) } },
            { $push: { orderby: userId } }
        ).exec(),
    ]);

    // Respond with minimal payload for faster delivery
    res.status(201).json(
        new ApiResponse(201, {razorpayOrder, orderId: order.orderId}, 'Order created successfully')
    );


});


// the order varify by razorpay
const ordervarify = asyncHandler(async (req, res) => {
// Code to verify the order
const {razorpay_payment_id, razorpay_order_id, razorpay_signature,orderId} = req.body;

// const data ={
//     razorpay_order_id: razorpay_order_id,
//     razorpay_payment_id: razorpay_payment_id,
//     razorpay_signature: razorpay_signature,
//     orderId: orderId
// }

// res.status(200).json(new ApiResponse(200, data, 'Order verified successfully'));

const order = await Order.findOne({orderId: orderId});
if(!order) {
    res.status(404);
    throw new Error('Order not found');
}

const key_secret = RAZORPAY_KEY_SECRET;
const generated_signature = crypto.createHmac('sha256', key_secret)
.update(razorpay_order_id + '|' + razorpay_payment_id)
.digest('hex');

if(generated_signature !== razorpay_signature) {
    order.paymentStatus = 'Failed';
    order.paymentResult = {
        id: razorpay_payment_id,
        status: 'failed'
    };
    await order.save();
    return res.status(400).json(new ApiResponse(400, order ,'Payment verification failed'));
}

order.paymentStatus= 'Completed';
order.paidAt = Date.now();
order.paymentResult = {
    id: razorpay_payment_id,
    status: 'success'
};

await order.save();
res.status(200).json(new ApiResponse(200, order, 'Order verified successfully' ));

    // mail send to user for order confirmation and order details 

    const user = await User.findById(order.user).lean();
    const products = await Product.find({ _id: { $in: order.products.map(({ product }) => product) } }).lean();

    const html = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Confirmation</title>

    <style>
        body {
            font-family: 'Arial', sans-serif;
            background: linear-gradient(to bottom right, #e3f2fd, #ffffff);
            margin: 0;
            padding: 0;
            color: #333;
        }

        .container {
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 8px 15px rgba(0, 0, 0, 0.1);
            border: 1px solid #e0e0e0;
        }

        h1 {
            font-size: 24px;
            text-align: center;
            color: #007bff;
            margin-bottom: 20px;
        }

        p {
            font-size: 16px;
            line-height: 1.6;
            margin: 10px 0;
        }

        .details {
            background: #f9fbff;
            padding: 20px;
            border-left: 5px solid #007bff;
            border-radius: 5px;
            margin: 20px 0;
        }

        .details p {
            font-size: 15px;
            margin: 8px 0;
        }

        .details p strong {
            color: #333;
        }

        .btn {
            display: inline-block;
            background: #007bff;
            color: #ffffff;
            text-decoration: none;
            padding: 12px 20px;
            border-radius: 5px;
            font-size: 16px;
            text-align: center;
            margin-top: 20px;
            transition: background 0.3s ease;
        }

        .btn:hover {
            background: #0056b3;
        }

        .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 14px;
            color: #555;
        }

        .footer strong {
            color: #007bff;
        }

        @media (max-width: 600px) {
            .container {
                margin: 20px;
                padding: 20px;
            }

            h1 {
                font-size: 20px;
            }

            .btn {
                width: 100%;
                text-align: center;
            }
        }
    </style>
</head>

<body>
    <div class="container">
        <h1>Order Confirmed!</h1>
        <p>Hello, <strong>${user.fullName}</strong>,</p>
        <p>Thank you for shopping with us! Your order has been confirmed and will be shipped shortly. Below are the details of your order:</p>

        <div class="details">
            <p><strong>Order ID:</strong> ${order.orderId}</p>
            <p><strong>Payment Type:</strong> ${order.paymentType}</p>
            <p><strong>Payment Status:</strong> ${order.paymentStatus}</p>
            <p><strong>Payment ID:</strong> ${order.paymentResult.id}</p>
            <p><strong>Shipping Address:</strong> ${order.shippingAddress}</p>
            <p><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
        </div>

        <a href="#" class="btn">Track Your Order</a>

        <div class="footer">
            Regards,<br>
            <strong>Shotlin Team</strong>
        </div>
    </div>
</body>

</html>
`;

 await mailsend(user.email, 'Order Confirmation',html,);



   


    

});

// Get all orders for user only
const getOrders = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 6, filter } = req.query;
  
    // Build the query: by default, fetch orders of the logged in user
    let query = { user: userId };
  
    // Additional filtering based on provided filter option
    if (filter) {
      switch (filter) {
        case 'lastThreeMonths': {
          // Filter orders from the last three months using 'orderedAt'
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
          query.orderedAt = { $gte: threeMonthsAgo };
          break;
        }
        case 'returnedProducts': {
          // Assuming returned products are represented by 'Cancelled' status
          query.orderStatus = 'Cancelled';
          break;
        }
        case 'lastYearDelivered': {
          // Filter for orders delivered last year
          const currentYear = new Date().getFullYear();
          const startOfLastYear = new Date(currentYear - 1, 0, 1);
          const endOfLastYear = new Date(currentYear - 1, 11, 31);
          query.orderedAt = { $gte: startOfLastYear, $lte: endOfLastYear };
          query.orderStatus = 'Delivered'; // ensure only delivered orders are returned
          break;
        }
        // Add other filter cases as needed
        default:
          break;
      }
    }
  
    // Set pagination options, sort orders in descending order by 'orderedAt',
    // exclude any sensitive fields, use lean for performance, and populate product details.
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { orderedAt: -1 },
      lean: true,
      select: '-sensitiveField',
      populate: {
        path: 'products.product',
        select: 'image title name'
      }
    };
  
    // Using the paginate method provided by mongoose-paginate-v2
    const orders = await Order.paginate(query, options);
  
    if (!orders.docs.length) {
      return res.status(404).json(new ApiResponse(404, [], 'No orders found'));
    }
  
    res.status(200).json(new ApiResponse(200, orders, 'Orders fetched successfully'));
  });

// Get order by id for user only  
const getOrderById = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const orderId = req.params.id;
  
    // Fetch order directly while ensuring it belongs to the user
    const order = await Order.findOne({ _id: orderId, user: userId }).lean();
  
    if (!order) {
      return res.status(404).json(new ApiResponse(404, null, 'Order not found'));
    }
  
    // Send response immediately
    res.status(200).json(new ApiResponse(200, order, 'Order fetched successfully'));
});



// Instant discount price calculation for order summary page

const getDiscountPrice = asyncHandler(async (req, res) => {
    const { ProductsPrice, DiscountCoupon } = req.body;
    // const userId = req.user._id;

    console.log(ProductsPrice, DiscountCoupon);

    // check DiscountCoupon exist or not 
    const couponExist = await Coupon.findOne({
        code: DiscountCoupon,
        isActive: true,
        expiryDate: { $gt: Date.now() },
    }).select('discountType discountValue minimumPurchase maximumDiscount usageLimit usageCount').lean();

    if (!couponExist) {
        res.status(404);
        throw new Error('Coupon not found or not valid');
    }

    if (couponExist.minimumPurchase > ProductsPrice) {
        res.status(400);
        throw new Error('Coupon is not applicable for this order');
    }

    let discount =
        couponExist.discountType === 'percentage'
            ? Math.min((couponExist.discountValue / 100) * ProductsPrice, couponExist.maximumDiscount || Infinity) 
            : couponExist.discountValue;

    let discountAmount = ProductsPrice - discount;

    let GST_TEX = (discountAmount * 18) / 100; // gst calculation

    let finalAmount = discountAmount + GST_TEX; // final amount after discount and gst

    let discountPrice = {
        discount: {
            discountType : `${couponExist.discountType === 'flat' ? '₹' : ''}${couponExist.discountValue}${couponExist.discountType === 'percentage' ? '%' : ''} off discount`,

            discountValue: discount,

        },
        GST_TEX:{
            GST:"Taxes include 18% GST",
            GSTAmount: GST_TEX
        },
        finalAmount: finalAmount
    };

  
    
    res.status(200).json(new ApiResponse(200, discountPrice, 'Discount calculated successfully'));
});


  


export {createOrder,ordervarify, getOrders, getOrderById ,getDiscountPrice} ;