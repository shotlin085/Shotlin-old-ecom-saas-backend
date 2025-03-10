// Importing required modules
import mongoose from "mongoose";
import mongoosePaginate from 'mongoose-paginate-v2';

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  products: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      default: 1,
      required: true
    }
  }],
  currency: {
    type: String,
    default: 'INR'
  },
  coupon: {
    type: String
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paymentStatus: {
    type: String,
    default: 'Pending',
    enum: ['Pending', 'Completed', 'Failed']
  },
  paymentsid: {
    type: String
  },
  paymentResult: {
    id: {
      type: String
    },
    status: {
      type: String
    }
  },
  paymentType: {
    type: String,
    default: 'razorpay',
    enum: ['Cash on Delivery', 'Card Payment', 'UPI Payment', 'Net Banking', 'razorpay', 'Bank Transfer']
  },
  paidAt: {
    type: Date
  },
  orderStatus: {
    type: String,
    default: 'Pending',
    enum: ['Pending', 'Processing', 'Delivered', 'Cancelled']
  },
  shippingAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address',
  },
  orderId: {
    type: String
  },
  orderedAt: {
    type: Date,
    default: Date.now
  }
});

// Add pagination plugin to the order schema
orderSchema.plugin(mongoosePaginate);

const Order = mongoose.model('Order', orderSchema);
export default Order;
